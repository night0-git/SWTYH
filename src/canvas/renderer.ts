import type { AdjacencyGraphProblem } from '../engine/graphProblem';
import type { Grid2DProblem } from '../engine/gridProblem';
import {
  NodeState,
  type Bounds2D,
  type NodeId,
  type Point2D,
  type SearchProblem,
} from '../engine/types';

interface Palette {
  readonly states: readonly string[];
  readonly weightLow: string;
  readonly weight: string;
  readonly weightHigh: string;
  readonly weightInk: string;
  readonly pathLine: string;
  readonly gridLine: string;
  readonly ink: string;
  readonly inkSecondary: string;
  readonly borderStrong: string;
  readonly accent: string;
  readonly surface: string;
  readonly monoFont: string;
}

interface GridLayout {
  readonly kind: 'grid';
  readonly cellSize: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly cols: number;
  readonly rows: number;
}

interface GraphNodeScreen {
  readonly x: number;
  readonly y: number;
}

interface GraphEdgeGeometry {
  readonly u: NodeId;
  readonly v: NodeId;
  readonly cost: number;
  readonly pu: GraphNodeScreen;
  readonly pv: GraphNodeScreen;
  readonly ctrlX: number;
  readonly ctrlY: number;
  readonly midX: number;
  readonly midY: number;
  readonly curved: boolean;
}

interface GraphLayout {
  readonly kind: 'graph';
  readonly radius: number;
  readonly pad: number;
  readonly spanX: number;
  readonly spanY: number;
  readonly bounds: Bounds2D;
  readonly coords: readonly GraphNodeScreen[];
  readonly edges: readonly GraphEdgeGeometry[];
}

export interface EdgeHitResult {
  readonly u: NodeId;
  readonly v: NodeId;
  readonly cost: number;
  readonly canvasX: number;
  readonly canvasY: number;
}

export interface RenderOptions {
  readonly path?: readonly NodeId[] | null;
  readonly showPathLine?: boolean;
  readonly parents?: Int32Array | null;
  readonly currentNode?: NodeId;
  readonly activeEdgeFrom?: NodeId;
  readonly activeEdgeTo?: NodeId;
  readonly showGridTree?: boolean;
  readonly hoverNode?: NodeId | null;
  readonly dragNode?: NodeId | null;
  readonly selectedEdge?: { readonly u: NodeId; readonly v: NodeId } | null;
  readonly draftEdge?: { readonly from: NodeId; readonly toX: number; readonly toY: number } | null;
}

function readPalette(el: HTMLElement): Palette {
  const s = getComputedStyle(el);
  const get = (name: string, fallback: string) =>
    s.getPropertyValue(name).trim() || fallback;

  const states: string[] = [];
  states[NodeState.Unvisited] = get('--state-unvisited', '#fcfbf8');
  states[NodeState.Wall] = get('--state-wall', '#1f1f1c');
  states[NodeState.Start] = get('--state-start', '#167a3e');
  states[NodeState.Goal] = get('--state-goal', '#b82121');
  states[NodeState.Frontier] = get('--state-frontier', '#9dc3f7');
  states[NodeState.Visited] = get('--state-visited', '#dde4ed');
  states[NodeState.Current] = get('--state-current', '#e69100');
  states[NodeState.Path] = get('--state-path', '#2563eb');

  return {
    states,
    weightLow: get('--state-weight-low', '#f6eed9'),
    weight: get('--state-weight', '#efe3c2'),
    weightHigh: get('--state-weight-high', '#e2cc92'),
    weightInk: get('--state-weight-ink', '#7d6118'),
    pathLine: get('--state-path-line', '#0f2c80'),
    gridLine: get('--grid-line', '#e2dfd5'),
    ink: get('--ink-primary', '#141413'),
    inkSecondary: get('--ink-secondary', '#4e4d48'),
    borderStrong: get('--border-strong', '#8d8a80'),
    accent: get('--accent', '#1d4ed8'),
    surface: get('--bg-surface', '#fcfbf8'),
    monoFont: get('--font-mono', 'ui-monospace, monospace'),
  };
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radiusOffset: number,
  headSize: number,
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len <= radiusOffset + headSize) return;

  const ux = dx / len;
  const uy = dy / len;
  const tipX = toX - ux * radiusOffset;
  const tipY = toY - uy * radiusOffset;
  const baseX = tipX - ux * headSize;
  const baseY = tipY - uy * headSize;
  const perpX = -uy * (headSize * 0.55);
  const perpY = ux * (headSize * 0.55);

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + perpX, baseY + perpY);
  ctx.lineTo(baseX - perpX, baseY - perpY);
  ctx.closePath();
  ctx.fill();
}

function buildGraphEdgeGeometry(
  graph: AdjacencyGraphProblem,
  coords: readonly GraphNodeScreen[],
): GraphEdgeGeometry[] {
  const result: GraphEdgeGeometry[] = [];
  const drawnUndirected = new Set<string>();

  for (let u = 0; u < graph.nodeCount; u += 1) {
    const pu = coords[u]!;
    for (const edge of graph.neighbors(u)) {
      const v = edge.node;
      if (!graph.directed) {
        const pairKey = u < v ? `${u}-${v}` : `${v}-${u}`;
        if (drawnUndirected.has(pairKey)) continue;
        drawnUndirected.add(pairKey);
      }

      const pv = coords[v]!;
      const hasReverse =
        graph.directed && graph.neighbors(v).some((rev) => rev.node === u);

      const mx = (pu.x + pv.x) * 0.5;
      const my = (pu.y + pv.y) * 0.5;

      if (hasReverse) {
        const dx = pv.x - pu.x;
        const dy = pv.y - pu.y;
        const len = Math.hypot(dx, dy) || 1;
        // Offset perpendicular to direction u -> v so reverse edges separate cleanly.
        const nx = -dy / len;
        const ny = dx / len;
        const ctrlOffset = 22;
        const ctrlX = mx + nx * ctrlOffset;
        const ctrlY = my + ny * ctrlOffset;
        result.push({
          u,
          v,
          cost: edge.cost,
          pu,
          pv,
          ctrlX,
          ctrlY,
          midX: 0.25 * pu.x + 0.5 * ctrlX + 0.25 * pv.x,
          midY: 0.25 * pu.y + 0.5 * ctrlY + 0.25 * pv.y,
          curved: true,
        });
      } else {
        result.push({
          u,
          v,
          cost: edge.cost,
          pu,
          pv,
          ctrlX: mx,
          ctrlY: my,
          midX: mx,
          midY: my,
          curved: false,
        });
      }
    }
  }

  return result;
}

function distanceToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - ax) * (px - ax) + (py - ay) * (py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return (px - projX) * (px - projX) + (py - projY) * (py - projY);
}

function distanceToEdgeSq(px: number, py: number, e: GraphEdgeGeometry): number {
  if (!e.curved) {
    return distanceToSegmentSq(px, py, e.pu.x, e.pu.y, e.pv.x, e.pv.y);
  }
  let best = Infinity;
  let prevX = e.pu.x;
  let prevY = e.pu.y;
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * e.pu.x + 2 * mt * t * e.ctrlX + t * t * e.pv.x;
    const y = mt * mt * e.pu.y + 2 * mt * t * e.ctrlY + t * t * e.pv.y;
    const d = distanceToSegmentSq(px, py, prevX, prevY, x, y);
    if (d < best) best = d;
    prevX = x;
    prevY = y;
  }
  return best;
}

function strokeEdgeCurve(
  ctx: CanvasRenderingContext2D,
  from: GraphNodeScreen,
  to: GraphNodeScreen,
  ctrlX: number,
  ctrlY: number,
  curved: boolean,
): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  if (curved) {
    ctx.quadraticCurveTo(ctrlX, ctrlY, to.x, to.y);
  } else {
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
}

/**
 * React-free Canvas 2D renderer for SearchProblem + Uint8Array node states.
 */
export class SearchCanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private palette: Palette;
  private layout: GridLayout | GraphLayout | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('2D canvas context is unavailable.');
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.palette = readPalette(canvas);
  }

  refreshPalette(): void {
    this.palette = readPalette(this.canvas);
  }

  hitTest(problem: SearchProblem, clientX: number, clientY: number): NodeId | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const layout = this.layout;
    if (!layout) return null;

    if (layout.kind === 'grid' && problem.kind === 'grid') {
      const col = Math.floor((x - layout.offsetX) / layout.cellSize);
      const row = Math.floor((y - layout.offsetY) / layout.cellSize);
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) {
        return null;
      }
      return row * layout.cols + col;
    }

    if (layout.kind === 'graph' && problem.kind === 'graph') {
      const hitR = layout.radius + 6;
      const hitR2 = hitR * hitR;
      for (let i = layout.coords.length - 1; i >= 0; i -= 1) {
        const pt = layout.coords[i]!;
        const dx = x - pt.x;
        const dy = y - pt.y;
        if (dx * dx + dy * dy <= hitR2) return i;
      }
    }

    return null;
  }

  edgeHitTest(
    problem: SearchProblem,
    clientX: number,
    clientY: number,
  ): EdgeHitResult | null {
    const layout = this.layout;
    if (!layout || layout.kind !== 'graph' || problem.kind !== 'graph') {
      return null;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Prioritize midpoint weight badges before general edge curve hits.
    for (let i = layout.edges.length - 1; i >= 0; i -= 1) {
      const e = layout.edges[i]!;
      const label = String(e.cost);
      const halfW = Math.max(12, label.length * 4 + 6);
      if (Math.abs(x - e.midX) <= halfW && Math.abs(y - e.midY) <= 10) {
        return { u: e.u, v: e.v, cost: e.cost, canvasX: e.midX, canvasY: e.midY };
      }
    }

    let bestEdge: GraphEdgeGeometry | null = null;
    let bestDistSq = 9 * 9;
    for (const e of layout.edges) {
      const dSq = distanceToEdgeSq(x, y, e);
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        bestEdge = e;
      }
    }
    if (!bestEdge) return null;
    return {
      u: bestEdge.u,
      v: bestEdge.v,
      cost: bestEdge.cost,
      canvasX: bestEdge.midX,
      canvasY: bestEdge.midY,
    };
  }

  screenToGraphPosition(clientX: number, clientY: number): Point2D | null {
    const layout = this.layout;
    if (!layout || layout.kind !== 'graph') return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;

    const { bounds, pad, spanX, spanY } = layout;
    const rangeX = bounds.maxX - bounds.minX || 1;
    const rangeY = bounds.maxY - bounds.minY || 1;

    const rawX = bounds.minX + ((sx - pad) / spanX) * rangeX;
    const rawY = bounds.minY + ((sy - pad) / spanY) * rangeY;
    const marginX = rangeX * 0.03;
    const marginY = rangeY * 0.03;

    return {
      x: Math.max(bounds.minX + marginX, Math.min(bounds.maxX - marginX, rawX)),
      y: Math.max(bounds.minY + marginY, Math.min(bounds.maxY - marginY, rawY)),
    };
  }

  render(
    problem: SearchProblem,
    states: Uint8Array,
    options: RenderOptions = {},
  ): void {
    if (problem.kind === 'grid') {
      this.renderGrid(problem as Grid2DProblem, states, options);
    } else {
      this.renderGraph(problem as AdjacencyGraphProblem, states, options);
    }
  }

  private syncCanvasSize(): { width: number; height: number; dpr: number } | null {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return null;

    const targetW = Math.floor(width * dpr);
    const targetH = Math.floor(height * dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
    return { width, height, dpr };
  }

  private weightFillFor(w: number): string {
    if (w >= 8) return this.palette.weightHigh;
    if (w <= 2.5) return this.palette.weightLow;
    return this.palette.weight;
  }

  private renderGrid(
    grid: Grid2DProblem,
    states: Uint8Array,
    options: RenderOptions,
  ): void {
    const dims = this.syncCanvasSize();
    if (!dims) return;
    const { width, height, dpr } = dims;

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.palette.surface;
    ctx.fillRect(0, 0, width, height);

    const pad = 12;
    const cellSize = Math.min(
      (width - pad * 2) / grid.cols,
      (height - pad * 2) / grid.rows,
    );
    const offsetX = (width - cellSize * grid.cols) * 0.5;
    const offsetY = (height - cellSize * grid.rows) * 0.5;

    this.layout = {
      kind: 'grid',
      cellSize,
      offsetX,
      offsetY,
      cols: grid.cols,
      rows: grid.rows,
    };

    const colors = this.palette.states;
    const showWeightNumbers = cellSize >= 17;
    if (showWeightNumbers) {
      const wFont = Math.max(8, Math.floor(cellSize * 0.36));
      ctx.font = `600 ${wFont}px ${this.palette.monoFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    for (let r = 0; r < grid.rows; r += 1) {
      const y = offsetY + r * cellSize;
      const rowOffset = r * grid.cols;
      for (let c = 0; c < grid.cols; c += 1) {
        const id = rowOffset + c;
        const x = offsetX + c * cellSize;
        const state = states[id] ?? NodeState.Unvisited;
        const w = grid.weightAt(id);

        if (state === NodeState.Unvisited) {
          if (w > 1) {
            ctx.fillStyle = this.weightFillFor(w);
            ctx.fillRect(x, y, cellSize, cellSize);
            if (showWeightNumbers) {
              ctx.fillStyle = this.palette.weightInk;
              ctx.fillText(String(w), x + cellSize * 0.5, y + cellSize * 0.52);
            }
          }
          continue;
        }

        ctx.fillStyle = colors[state] ?? this.palette.surface;
        ctx.fillRect(x, y, cellSize, cellSize);

        if (
          w > 1 &&
          state !== NodeState.Wall &&
          state !== NodeState.Start &&
          state !== NodeState.Goal
        ) {
          const mark = Math.max(3, cellSize * 0.28);
          ctx.fillStyle = this.palette.weightInk;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + mark, y);
          ctx.lineTo(x, y + mark);
          ctx.closePath();
          ctx.fill();

          if (showWeightNumbers && state !== NodeState.Path) {
            ctx.fillText(String(w), x + cellSize * 0.5, y + cellSize * 0.52);
          }
        }
      }
    }

    if (cellSize >= 5) {
      ctx.strokeStyle = this.palette.gridLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const totalW = grid.cols * cellSize;
      const totalH = grid.rows * cellSize;
      for (let c = 0; c <= grid.cols; c += 1) {
        const x = Math.round(offsetX + c * cellSize) + 0.5;
        ctx.moveTo(x, offsetY);
        ctx.lineTo(x, offsetY + totalH);
      }
      for (let r = 0; r <= grid.rows; r += 1) {
        const y = Math.round(offsetY + r * cellSize) + 0.5;
        ctx.moveTo(offsetX, y);
        ctx.lineTo(offsetX + totalW, y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = this.palette.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(offsetX) + 0.5,
      Math.round(offsetY) + 0.5,
      Math.round(grid.cols * cellSize),
      Math.round(grid.rows * cellSize),
    );

    if (options.showGridTree && options.parents) {
      ctx.strokeStyle = this.palette.inkSecondary;
      ctx.lineWidth = Math.max(1, cellSize * 0.07);
      ctx.beginPath();
      for (let node = 0; node < grid.nodeCount; node += 1) {
        const p = options.parents[node]!;
        if (p < 0 || p >= grid.nodeCount) continue;
        const nc = node % grid.cols;
        const nr = (node - nc) / grid.cols;
        const pc = p % grid.cols;
        const pr = (p - pc) / grid.cols;
        ctx.moveTo(offsetX + (pc + 0.5) * cellSize, offsetY + (pr + 0.5) * cellSize);
        ctx.lineTo(offsetX + (nc + 0.5) * cellSize, offsetY + (nr + 0.5) * cellSize);
      }
      ctx.stroke();
    }

    if (options.showPathLine && options.path && options.path.length > 1) {
      ctx.strokeStyle = this.palette.pathLine;
      ctx.lineWidth = Math.max(2, cellSize * 0.16);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < options.path.length; i += 1) {
        const node = options.path[i]!;
        const c = node % grid.cols;
        const r = (node - c) / grid.cols;
        const cx = offsetX + (c + 0.5) * cellSize;
        const cy = offsetY + (r + 0.5) * cellSize;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    if (cellSize >= 12) {
      const fontSize = Math.max(9, Math.floor(cellSize * 0.48));
      ctx.font = `600 ${fontSize}px ${this.palette.monoFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.palette.surface;

      const drawMarker = (node: NodeId, label: string) => {
        const c = node % grid.cols;
        const r = (node - c) / grid.cols;
        ctx.fillText(
          label,
          offsetX + (c + 0.5) * cellSize,
          offsetY + (r + 0.52) * cellSize,
        );
      };
      drawMarker(grid.start, 'S');
      drawMarker(grid.goal, 'G');
    }

    if (
      options.currentNode !== undefined &&
      options.currentNode >= 0 &&
      options.currentNode < grid.nodeCount
    ) {
      const c = options.currentNode % grid.cols;
      const r = (options.currentNode - c) / grid.cols;
      ctx.strokeStyle = this.palette.states[NodeState.Current]!;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        offsetX + c * cellSize + 1,
        offsetY + r * cellSize + 1,
        Math.max(1, cellSize - 2),
        Math.max(1, cellSize - 2),
      );
    }

    if (
      options.hoverNode !== null &&
      options.hoverNode !== undefined &&
      options.hoverNode >= 0 &&
      options.hoverNode < grid.nodeCount
    ) {
      const c = options.hoverNode % grid.cols;
      const r = (options.hoverNode - c) / grid.cols;
      ctx.strokeStyle = this.palette.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        offsetX + c * cellSize + 0.5,
        offsetY + r * cellSize + 0.5,
        cellSize - 1,
        cellSize - 1,
      );
    }
  }

  private renderGraph(
    graph: AdjacencyGraphProblem,
    states: Uint8Array,
    options: RenderOptions,
  ): void {
    const dims = this.syncCanvasSize();
    if (!dims) return;
    const { width, height, dpr } = dims;

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.palette.surface;
    ctx.fillRect(0, 0, width, height);

    if (!graph.positions || graph.positions.length === 0) {
      this.layout = null;
      return;
    }

    const bounds = graph.bounds;
    const rangeX = bounds.maxX - bounds.minX || 1;
    const rangeY = bounds.maxY - bounds.minY || 1;

    const pad = 44;
    const spanX = Math.max(1, width - pad * 2);
    const spanY = Math.max(1, height - pad * 2);
    const coords: GraphNodeScreen[] = graph.positions.map((p) => ({
      x: pad + ((p.x - bounds.minX) / rangeX) * spanX,
      y: pad + ((p.y - bounds.minY) / rangeY) * spanY,
    }));

    const radius = Math.max(12, Math.min(20, 140 / Math.sqrt(graph.nodeCount)));
    const edges = buildGraphEdgeGeometry(graph, coords);
    this.layout = { kind: 'graph', radius, pad, spanX, spanY, bounds, coords, edges };

    const parents = options.parents ?? null;
    const currentNode = options.currentNode ?? -1;
    const activeFrom = options.activeEdgeFrom ?? -1;
    const activeTo = options.activeEdgeTo ?? -1;

    const isValidGraphNode = (n: number | null | undefined): n is NodeId =>
      typeof n === 'number' && n >= 0 && n < graph.nodeCount;
    const neighborFocus = isValidGraphNode(currentNode) ? currentNode : -1;

    const neighborNodes = new Set<NodeId>();
    if (neighborFocus >= 0) {
      for (const edge of graph.neighbors(neighborFocus)) {
        if (edge.node !== neighborFocus && isValidGraphNode(edge.node)) {
          neighborNodes.add(edge.node);
        }
      }
    }

    const pathEdgeDir = new Set<string>();
    const pathEdgePair = new Set<string>();
    if (options.showPathLine && options.path && options.path.length > 1) {
      for (let i = 0; i < options.path.length - 1; i += 1) {
        const a = options.path[i]!;
        const b = options.path[i + 1]!;
        pathEdgeDir.add(`${a}->${b}`);
        pathEdgePair.add(`${a}-${b}`);
        pathEdgePair.add(`${b}-${a}`);
      }
    }

    interface LabelDraw {
      readonly edge: GraphEdgeGeometry;
      readonly highlightColor: string | null;
    }
    const labelDraws: LabelDraw[] = [];

    // Pass 1: Draw edges in layered priority: baseline -> neighbor/tree -> active/path.
    for (const e of edges) {
      const { u, v, pu, pv, ctrlX, ctrlY, curved } = e;
      const isPath = graph.directed
        ? pathEdgeDir.has(`${u}->${v}`)
        : pathEdgePair.has(`${u}-${v}`);
      const isActive = graph.directed
        ? activeFrom === u && activeTo === v
        : (activeFrom === u && activeTo === v) ||
          (activeFrom === v && activeTo === u);
      const isNeighborEdge =
        neighborFocus >= 0 &&
        (graph.directed ? u === neighborFocus : u === neighborFocus || v === neighborFocus);

      let treeFrom = -1;
      let treeTo = -1;
      if (parents) {
        if (parents[v] === u) {
          treeFrom = u;
          treeTo = v;
        } else if (!graph.directed && parents[u] === v) {
          treeFrom = v;
          treeTo = u;
        }
      }

      let highlightColor: string | null = null;

      if (isPath) {
        const from = graph.directed || pathEdgeDir.has(`${u}->${v}`) ? u : v;
        const to = from === u ? v : u;
        const pf = coords[from]!;
        const pt = coords[to]!;
        ctx.strokeStyle = this.palette.pathLine;
        ctx.fillStyle = this.palette.pathLine;
        ctx.lineWidth = 3.5;
        strokeEdgeCurve(ctx, pf, pt, ctrlX, ctrlY, curved);
        drawArrowHead(
          ctx,
          curved ? ctrlX : pf.x,
          curved ? ctrlY : pf.y,
          pt.x,
          pt.y,
          radius + 2,
          9,
        );
        highlightColor = this.palette.pathLine;
      } else if (isActive) {
        const pf = coords[activeFrom]!;
        const pt = coords[activeTo]!;
        ctx.strokeStyle = this.palette.states[NodeState.Current]!;
        ctx.fillStyle = this.palette.states[NodeState.Current]!;
        ctx.lineWidth = 3;
        strokeEdgeCurve(ctx, pf, pt, ctrlX, ctrlY, curved);
        drawArrowHead(
          ctx,
          curved ? ctrlX : pf.x,
          curved ? ctrlY : pf.y,
          pt.x,
          pt.y,
          radius + 2,
          8,
        );
        highlightColor = this.palette.states[NodeState.Current]!;
      } else if (treeFrom >= 0) {
        const pf = coords[treeFrom]!;
        const pt = coords[treeTo]!;
        ctx.strokeStyle = this.palette.inkSecondary;
        ctx.fillStyle = this.palette.inkSecondary;
        ctx.lineWidth = 2;
        strokeEdgeCurve(ctx, pf, pt, ctrlX, ctrlY, curved);
        drawArrowHead(
          ctx,
          curved ? ctrlX : pf.x,
          curved ? ctrlY : pf.y,
          pt.x,
          pt.y,
          radius + 2,
          7.5,
        );
        highlightColor = this.palette.inkSecondary;
      } else if (isNeighborEdge) {
        ctx.strokeStyle = this.palette.borderStrong;
        ctx.fillStyle = this.palette.borderStrong;
        ctx.lineWidth = 1.85;
        strokeEdgeCurve(ctx, pu, pv, ctrlX, ctrlY, curved);
        if (graph.directed) {
          drawArrowHead(
            ctx,
            curved ? ctrlX : pu.x,
            curved ? ctrlY : pu.y,
            pv.x,
            pv.y,
            radius + 2,
            7,
          );
        }
        highlightColor = this.palette.inkSecondary;
      } else {
        ctx.strokeStyle = this.palette.gridLine;
        ctx.fillStyle = this.palette.borderStrong;
        ctx.lineWidth = 1.35;
        strokeEdgeCurve(ctx, pu, pv, ctrlX, ctrlY, curved);
        if (graph.directed) {
          drawArrowHead(
            ctx,
            curved ? ctrlX : pu.x,
            curved ? ctrlY : pu.y,
            pv.x,
            pv.y,
            radius + 2,
            6.5,
          );
        }
      }

      labelDraws.push({ edge: e, highlightColor });
    }

    // Optional rubber-band edge preview while connecting vertices.
    if (
      options.draftEdge &&
      options.draftEdge.from >= 0 &&
      options.draftEdge.from < coords.length
    ) {
      const origin = coords[options.draftEdge.from]!;
      ctx.save();
      ctx.strokeStyle = this.palette.accent;
      ctx.lineWidth = 1.75;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(options.draftEdge.toX, options.draftEdge.toY);
      ctx.stroke();
      ctx.restore();
    }

    // Pass 2: Draw edge weight labels above edges when graph is weighted.
    if (graph.weighted) {
      ctx.font = `500 11px ${this.palette.monoFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const { edge, highlightColor } of labelDraws) {
        const label = String(edge.cost);
        const boxW = ctx.measureText(label).width + 6;
        const isSelected =
          options.selectedEdge &&
          ((options.selectedEdge.u === edge.u && options.selectedEdge.v === edge.v) ||
            (!graph.directed &&
              options.selectedEdge.u === edge.v &&
              options.selectedEdge.v === edge.u));

        ctx.fillStyle = this.palette.surface;
        ctx.fillRect(edge.midX - boxW * 0.5, edge.midY - 7, boxW, 14);
        if (isSelected) {
          ctx.strokeStyle = this.palette.accent;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(edge.midX - boxW * 0.5, edge.midY - 7, boxW, 14);
        }

        const defaultCostColor =
          edge.cost < 0
            ? this.palette.states[NodeState.Goal]!
            : this.palette.inkSecondary;
        ctx.fillStyle = highlightColor ?? defaultCostColor;
        ctx.fillText(label, edge.midX, edge.midY);
      }
    }

    // Pass 3: Draw vertices & labels.
    const colors = this.palette.states;
    ctx.font = `600 12px ${this.palette.monoFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let u = 0; u < graph.nodeCount; u += 1) {
      const pt = coords[u]!;
      const state = states[u] ?? NodeState.Unvisited;
      const isHovered = options.hoverNode === u;
      const isDragged = options.dragNode === u;
      const isNeighbor = neighborNodes.has(u);
      const needsCurrentRing =
        currentNode === u && (state === NodeState.Start || state === NodeState.Goal);

      if (needsCurrentRing) {
        ctx.strokeStyle = this.palette.states[NodeState.Current]!;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (isHovered || isDragged) {
        ctx.strokeStyle = this.palette.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius + (needsCurrentRing ? 6.5 : 4), 0, Math.PI * 2);
        ctx.stroke();
      } else if (isNeighbor) {
        ctx.save();
        ctx.strokeStyle = this.palette.borderStrong;
        ctx.lineWidth = 1.35;
        ctx.setLineDash([3, 2.5]);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius + (needsCurrentRing ? 6.5 : 3.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = colors[state] ?? this.palette.surface;
      ctx.strokeStyle = this.palette.ink;
      ctx.lineWidth = isHovered || isDragged ? 2 : 1.25;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const darkFill =
        state === NodeState.Start ||
        state === NodeState.Goal ||
        state === NodeState.Path ||
        state === NodeState.Wall;
      ctx.fillStyle = darkFill ? this.palette.surface : this.palette.ink;
      const label = u === graph.start ? 'S' : u === graph.goal ? 'G' : String(u);
      ctx.fillText(label, pt.x, pt.y + 0.5);
    }
  }
}
