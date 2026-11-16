import { AdjacencyGraphProblem } from './graphProblem';
import { Grid2DProblem } from './gridProblem';
import type { PresetId } from './presets';
import type { Edge, NodeId, Point2D } from './types';

export const MIN_RANDOM_GRID_NODES = 2;
export const MAX_RANDOM_GRID_NODES = 2500;
export const MIN_RANDOM_GRAPH_NODES = 2;
export const MAX_RANDOM_GRAPH_NODES = 120;

const GRID_TARGET_ASPECT = 35 / 21;

export interface RandomizeGridOptions {
  readonly nodeCount: number;
  readonly allowDiagonal?: boolean;
  readonly presetId?: PresetId;
  readonly rng?: () => number;
}

export interface RandomizeGraphOptions {
  readonly nodeCount: number;
  readonly directed?: boolean;
  readonly weighted?: boolean;
  readonly presetId?: PresetId;
  readonly rng?: () => number;
}

export function clampRandomNodeCount(
  kind: 'grid' | 'graph',
  rawCount: number,
  fallback = kind === 'grid' ? 735 : 10,
): number {
  const min = kind === 'grid' ? MIN_RANDOM_GRID_NODES : MIN_RANDOM_GRAPH_NODES;
  const max = kind === 'grid' ? MAX_RANDOM_GRID_NODES : MAX_RANDOM_GRAPH_NODES;
  if (!Number.isFinite(rawCount)) {
    return Math.max(min, Math.min(max, Math.round(fallback)));
  }
  return Math.max(min, Math.min(max, Math.round(rawCount)));
}

export function gridDimensionsForNodeCount(targetNodes: number): {
  readonly cols: number;
  readonly rows: number;
} {
  const n = clampRandomNodeCount('grid', targetNodes);
  if (n <= 3) {
    return { cols: n, rows: 1 };
  }

  let bestCols = 0;
  let bestRows = 0;
  let bestAspectDiff = Infinity;

  for (let rows = 2; rows * rows <= n; rows += 1) {
    if (n % rows !== 0) continue;
    const cols = n / rows;
    const aspect = cols / rows;
    if (aspect < 1 || aspect > 2.5) continue;
    const diff = Math.abs(aspect - GRID_TARGET_ASPECT);
    if (diff < bestAspectDiff) {
      bestAspectDiff = diff;
      bestCols = cols;
      bestRows = rows;
    }
  }

  if (bestCols > 0 && bestRows > 0) {
    return { cols: bestCols, rows: bestRows };
  }

  const idealRows = Math.sqrt(n / GRID_TARGET_ASPECT);
  const minR = Math.max(2, Math.floor(idealRows) - 1);
  const maxR = Math.max(minR, Math.ceil(idealRows) + 1);

  let bestCountDiff = Infinity;
  bestAspectDiff = Infinity;

  for (let rows = minR; rows <= maxR; rows += 1) {
    const lowCols = Math.max(2, Math.floor(n / rows));
    const highCols = Math.max(2, Math.ceil(n / rows));
    for (const cols of lowCols === highCols ? [lowCols] : [lowCols, highCols]) {
      const countDiff = Math.abs(cols * rows - n);
      const aspectDiff = Math.abs(cols / rows - GRID_TARGET_ASPECT);
      if (
        countDiff < bestCountDiff ||
        (countDiff === bestCountDiff && aspectDiff < bestAspectDiff)
      ) {
        bestCountDiff = countDiff;
        bestAspectDiff = aspectDiff;
        bestCols = cols;
        bestRows = rows;
      }
    }
  }

  return { cols: bestCols, rows: bestRows };
}

function hasCardinalPath(
  cols: number,
  rows: number,
  walls: Uint8Array,
  start: NodeId,
  goal: NodeId,
): boolean {
  if (start === goal) return true;
  const total = cols * rows;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  visited[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const cur = queue[head++]!;
    if (cur === goal) return true;
    const cx = cur % cols;
    const cy = (cur - cx) / cols;

    if (cx > 0) {
      const next = cur - 1;
      if (walls[next] === 0 && visited[next] === 0) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (cx + 1 < cols) {
      const next = cur + 1;
      if (walls[next] === 0 && visited[next] === 0) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (cy > 0) {
      const next = cur - cols;
      if (walls[next] === 0 && visited[next] === 0) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (cy + 1 < rows) {
      const next = cur + cols;
      if (walls[next] === 0 && visited[next] === 0) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  return false;
}

function carveCorridor(
  cols: number,
  walls: Uint8Array,
  start: NodeId,
  goal: NodeId,
): void {
  let x = start % cols;
  let y = (start - x) / cols;
  const gx = goal % cols;
  const gy = (goal - gx) / cols;

  walls[y * cols + x] = 0;
  while (x !== gx) {
    x += x < gx ? 1 : -1;
    walls[y * cols + x] = 0;
  }
  while (y !== gy) {
    y += y < gy ? 1 : -1;
    walls[y * cols + x] = 0;
  }
}

function pickStartAndGoal(
  cols: number,
  rows: number,
  rng: () => number,
): { readonly start: NodeId; readonly goal: NodeId } {
  const total = cols * rows;
  const start = Math.floor(rng() * total);
  const sx = start % cols;
  const sy = (start - sx) / cols;

  const minGoalDist = Math.max(1, Math.floor((cols + rows) * 0.45));
  let goal = (start + 1) % total;
  let bestDist = -1;
  const sampleCount = Math.min(24, total);

  for (let i = 0; i < sampleCount; i += 1) {
    const candidate = Math.floor(rng() * total);
    if (candidate === start) continue;
    const cx = candidate % cols;
    const cy = (candidate - cx) / cols;
    const dist = Math.abs(cx - sx) + Math.abs(cy - sy);
    if (dist > bestDist) {
      bestDist = dist;
      goal = candidate;
    }
    if (dist >= minGoalDist) break;
  }

  return { start, goal };
}

function ensureReachableWithRetries(
  cols: number,
  rows: number,
  walls: Uint8Array,
  start: NodeId,
  goal: NodeId,
  populateAttempt: (attempt: number) => void,
): void {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    populateAttempt(attempt);
    walls[start] = 0;
    walls[goal] = 0;
    if (hasCardinalPath(cols, rows, walls, start, goal)) {
      return;
    }
  }
  carveCorridor(cols, walls, start, goal);
}

function randomizeMazeGrid(
  cols: number,
  rows: number,
  rng: () => number,
  allowDiagonal: boolean,
): Grid2DProblem {
  const total = cols * rows;
  const walls = new Uint8Array(total);
  const weights = new Float32Array(total);
  weights.fill(1);

  if (cols < 5 || rows < 5) {
    const { start, goal } = pickStartAndGoal(cols, rows, rng);
    if (total >= 4) {
      ensureReachableWithRetries(cols, rows, walls, start, goal, (attempt) => {
        walls.fill(0);
        const density = attempt < 5 ? 0.22 : 0.12;
        for (let id = 0; id < total; id += 1) {
          if (id !== start && id !== goal && rng() < density) {
            walls[id] = 1;
          }
        }
      });
    }
    return new Grid2DProblem({
      cols,
      rows,
      start: { x: start % cols, y: Math.floor(start / cols) },
      goal: { x: goal % cols, y: Math.floor(goal / cols) },
      walls,
      weights,
      allowDiagonal,
    });
  }

  walls.fill(1);
  const dirs = [
    [0, -2],
    [2, 0],
    [0, 2],
    [-2, 0],
  ] as const;

  const stack: [number, number][] = [[1, 1]];
  walls[1 * cols + 1] = 0;

  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1]!;
    const candidates: [number, number, number, number][] = [];

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && walls[ny * cols + nx] === 1) {
        candidates.push([nx, ny, cx + dx / 2, cy + dy / 2]);
      }
    }

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    const pick = candidates[Math.floor(rng() * candidates.length)]!;
    walls[pick[3] * cols + pick[2]] = 0;
    walls[pick[1] * cols + pick[0]] = 0;
    stack.push([pick[0], pick[1]]);
  }

  const extraLoops = Math.max(1, Math.floor(total / 40));
  for (let i = 0; i < extraLoops; i += 1) {
    const rx = 1 + Math.floor(rng() * (cols - 2));
    const ry = 1 + Math.floor(rng() * (rows - 2));
    walls[ry * cols + rx] = 0;
  }

  const openCells: NodeId[] = [];
  for (let id = 0; id < total; id += 1) {
    if (walls[id] === 0) openCells.push(id);
  }
  const start = openCells[Math.floor(rng() * openCells.length)] ?? cols + 1;

  const dist = new Int32Array(total);
  dist.fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  let farthest = start;
  let maxDist = 0;

  while (head < tail) {
    const cur = queue[head++]!;
    const d = dist[cur]!;
    if (d > maxDist) {
      maxDist = d;
      farthest = cur;
    }
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    const adj = [
      cx > 0 ? cur - 1 : -1,
      cx + 1 < cols ? cur + 1 : -1,
      cy > 0 ? cur - cols : -1,
      cy + 1 < rows ? cur + cols : -1,
    ];
    for (const next of adj) {
      if (next >= 0 && walls[next] === 0 && dist[next] === -1) {
        dist[next] = d + 1;
        queue[tail++] = next;
      }
    }
  }

  const goal = farthest !== start ? farthest : openCells[openCells.length - 1] ?? start + 1;
  return new Grid2DProblem({
    cols,
    rows,
    start: { x: start % cols, y: Math.floor(start / cols) },
    goal: { x: goal % cols, y: Math.floor(goal / cols) },
    walls,
    weights,
    allowDiagonal,
  });
}

function stampConcavePocket(
  cols: number,
  rows: number,
  walls: Uint8Array,
  start: NodeId,
  goal: NodeId,
  rng: () => number,
): void {
  const sx = start % cols;
  const sy = (start - sx) / cols;
  const gx = goal % cols;
  const gy = (goal - gx) / cols;

  const midX = Math.round((sx + gx) * 0.5);
  const midY = Math.round((sy + gy) * 0.5);
  const halfH = Math.max(
    2,
    Math.min(Math.floor(rows * 0.34), Math.floor(2 + rng() * (rows * 0.2))),
  );
  const armLen = Math.max(
    2,
    Math.min(Math.floor(cols * 0.28), Math.floor(2 + rng() * (cols * 0.16))),
  );
  const dirTowardStart = sx <= gx ? -1 : 1;

  const top = Math.max(1, midY - halfH);
  const bottom = Math.min(rows - 2, midY + halfH);
  const spineX = Math.max(1, Math.min(cols - 2, midX));

  for (let r = top; r <= bottom; r += 1) {
    walls[r * cols + spineX] = 1;
  }
  for (let step = 1; step <= armLen; step += 1) {
    const cx = spineX + dirTowardStart * step;
    if (cx <= 0 || cx >= cols - 1) break;
    walls[top * cols + cx] = 1;
    walls[bottom * cols + cx] = 1;
  }
  walls[start] = 0;
  walls[goal] = 0;
}

export function randomizeGrid(options: RandomizeGridOptions): Grid2DProblem {
  const rng = options.rng ?? Math.random;
  const allowDiagonal = options.allowDiagonal ?? false;
  const presetId = options.presetId;
  const { cols, rows } = gridDimensionsForNodeCount(options.nodeCount);
  const total = cols * rows;

  if (presetId === 'random-maze') {
    return randomizeMazeGrid(cols, rows, rng, allowDiagonal);
  }

  const { start, goal } = pickStartAndGoal(cols, rows, rng);
  const sx = start % cols;
  const sy = (start - sx) / cols;
  const gx = goal % cols;
  const gy = (goal - gx) / cols;

  const walls = new Uint8Array(total);
  const weights = new Float32Array(total);
  weights.fill(1);

  if (presetId === 'open-field' || total < 4) {
    return new Grid2DProblem({
      cols,
      rows,
      start: { x: sx, y: sy },
      goal: { x: gx, y: gy },
      walls,
      weights,
      allowDiagonal,
    });
  }

  if (presetId === 'weighted-swamp') {
    ensureReachableWithRetries(cols, rows, walls, start, goal, (attempt) => {
      walls.fill(0);
      weights.fill(1);

      const patchCount = Math.max(1, Math.min(3, Math.floor(1 + rng() * 3)));
      for (let p = 0; p < patchCount; p += 1) {
        const cx = Math.floor(rng() * cols);
        const cy = Math.floor(rng() * rows);
        const rx = Math.max(1, Math.floor(cols * (0.12 + rng() * 0.14)));
        const ry = Math.max(1, Math.floor(rows * (0.15 + rng() * 0.18)));
        const coreWeight = rng() < 0.75 ? 5 : 10;

        for (let r = Math.max(0, cy - ry); r <= Math.min(rows - 1, cy + ry); r += 1) {
          for (let c = Math.max(0, cx - rx); c <= Math.min(cols - 1, cx + rx); c += 1) {
            const id = r * cols + c;
            if (id === start || id === goal) continue;
            const normDist = Math.hypot((c - cx) / (rx + 0.5), (r - cy) / (ry + 0.5));
            if (normDist <= 0.72) {
              weights[id] = coreWeight;
            } else if (normDist <= 1.05 && weights[id] === 1) {
              weights[id] = 2;
            }
          }
        }
      }

      let hasWeighted = false;
      for (let id = 0; id < total; id += 1) {
        if (id !== start && id !== goal && weights[id]! > 1) {
          hasWeighted = true;
          break;
        }
      }
      if (!hasWeighted) {
        for (let id = 0; id < total; id += 1) {
          if (id !== start && id !== goal) {
            weights[id] = 5;
            break;
          }
        }
      }

      const wallDensity = attempt < 5 ? 0.08 : 0.04;
      for (let id = 0; id < total; id += 1) {
        if (id === start || id === goal) continue;
        if (rng() < wallDensity) {
          walls[id] = 1;
          weights[id] = 1;
        }
      }
    });
  } else if (presetId === 'concave-trap') {
    ensureReachableWithRetries(cols, rows, walls, start, goal, (attempt) => {
      walls.fill(0);
      if (cols >= 7 && rows >= 5 && attempt < 5) {
        stampConcavePocket(cols, rows, walls, start, goal, rng);
      }
      const scatterDensity = cols >= 7 && rows >= 5 ? (attempt < 5 ? 0.09 : 0.05) : 0.22;
      for (let id = 0; id < total; id += 1) {
        if (id !== start && id !== goal && rng() < scatterDensity) {
          walls[id] = 1;
        }
      }
    });
  } else {
    ensureReachableWithRetries(cols, rows, walls, start, goal, (attempt) => {
      const wallDensity = attempt < 5 ? 0.24 : 0.14;
      walls.fill(0);
      weights.fill(1);
      for (let id = 0; id < total; id += 1) {
        if (id === start || id === goal) continue;
        const r = rng();
        if (r < wallDensity) {
          walls[id] = 1;
        } else if (r < wallDensity + 0.12) {
          weights[id] = rng() < 0.65 ? 2 : 5;
        }
      }
    });
  }

  return new Grid2DProblem({
    cols,
    rows,
    start: { x: sx, y: sy },
    goal: { x: gx, y: gy },
    walls,
    weights,
    allowDiagonal,
  });
}

export function randomizeGraph(options: RandomizeGraphOptions): AdjacencyGraphProblem {
  const rng = options.rng ?? Math.random;
  const n = clampRandomNodeCount('graph', options.nodeCount);
  const directed = options.directed ?? false;
  const weighted = options.weighted ?? true;
  const presetId = options.presetId;

  const start = 0;
  const goal = n - 1;
  const positions: Point2D[] = new Array<Point2D>(n);

  positions[start] = {
    x: 8 + rng() * 10,
    y: 20 + rng() * 60,
  };
  positions[goal] = {
    x: 82 + rng() * 10,
    y: 20 + rng() * 60,
  };

  const placed: Point2D[] = [positions[start]!, positions[goal]!];
  const candidateTries = 16;

  for (let i = 1; i < n - 1; i += 1) {
    let bestPt: Point2D = { x: 16 + rng() * 68, y: 10 + rng() * 80 };
    let bestMinDistSq = -1;

    for (let t = 0; t < candidateTries; t += 1) {
      const cand: Point2D = {
        x: 15 + rng() * 70,
        y: 10 + rng() * 80,
      };
      let minDistSq = Infinity;
      for (const other of placed) {
        const dx = cand.x - other.x;
        const dy = cand.y - other.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < minDistSq) minDistSq = dSq;
      }
      if (minDistSq > bestMinDistSq) {
        bestMinDistSq = minDistSq;
        bestPt = cand;
      }
    }

    positions[i] = bestPt;
    placed.push(bestPt);
  }

  const adjacency: Edge[][] = Array.from({ length: n }, () => []);

  if (presetId === 'blank-graph') {
    return new AdjacencyGraphProblem({
      nodeCount: n,
      start,
      goal,
      adjacency,
      positions,
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
      directed,
      weighted,
    });
  }

  const edgeKeys = new Set<string>();

  const computeCost = (u: NodeId, v: NodeId): number => {
    const pu = positions[u]!;
    const pv = positions[v]!;
    const dist = Math.hypot(pu.x - pv.x, pu.y - pv.y);
    return Math.max(1, Math.ceil(dist) + Math.floor(rng() * Math.max(2, dist * 0.45)));
  };

  const linkEdge = (u: NodeId, v: NodeId, explicitCost?: number): boolean => {
    if (u === v) return false;
    const key = directed ? `${u}->${v}` : u < v ? `${u}-${v}` : `${v}-${u}`;
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);

    const cost = explicitCost ?? computeCost(u, v);
    adjacency[u]!.push({ node: v, cost });
    if (!directed) {
      adjacency[v]!.push({ node: u, cost });
    }
    return true;
  };

  if (n === 2) {
    const dist = Math.hypot(
      positions[0]!.x - positions[1]!.x,
      positions[0]!.y - positions[1]!.y,
    );
    const cost =
      presetId === 'negative-edge-graph'
        ? -Math.max(5, Math.round(dist * 0.35))
        : presetId === 'heuristic-trap-graph'
          ? Math.max(1, Math.floor(dist * 0.35))
          : undefined;
    linkEdge(start, goal, cost);
  } else {
    const isNegativeDag = presetId === 'negative-edge-graph' && directed;

    // Build a proximity-biased spanning tree rooted at Start so every vertex is reachable.
    const inTree: NodeId[] = [start];
    const inTreeMask = new Uint8Array(n);
    inTreeMask[start] = 1;
    const treeChildren: NodeId[][] = Array.from({ length: n }, () => []);

    while (inTree.length < n) {
      const candidates: { u: NodeId; v: NodeId; distSq: number }[] = [];
      for (const u of inTree) {
        const pu = positions[u]!;
        for (let v = 0; v < n; v += 1) {
          if (inTreeMask[v] === 1) continue;
          const pv = positions[v]!;
          const dx = pu.x - pv.x;
          const dy = pu.y - pv.y;
          candidates.push({ u, v, distSq: dx * dx + dy * dy });
        }
      }

      candidates.sort((a, b) => a.distSq - b.distSq);
      const nonDirectPool =
        n >= 4
          ? candidates.filter((c) => !(c.u === start && c.v === goal))
          : candidates;
      const pool = nonDirectPool.length > 0 ? nonDirectPool : candidates;
      const topK = Math.min(3, pool.length);
      const picked = pool[Math.floor(rng() * topK)]!;

      linkEdge(picked.u, picked.v);
      treeChildren[picked.u]!.push(picked.v);
      inTreeMask[picked.v] = 1;
      inTree.push(picked.v);
    }

    const rank = new Int32Array(n);
    if (isNegativeDag) {
      const bfsOrder: NodeId[] = [start];
      let head = 0;
      while (head < bfsOrder.length) {
        const u = bfsOrder[head++]!;
        const children = [...treeChildren[u]!].sort((a, b) => {
          if (a === goal) return 1;
          if (b === goal) return -1;
          return positions[a]!.x - positions[b]!.x;
        });
        for (const child of children) {
          bfsOrder.push(child);
        }
      }
      for (let idx = 0; idx < bfsOrder.length; idx += 1) {
        rank[bfsOrder[idx]!] = idx;
      }
    }

    // Add local shortcut/cycle edges between nearby vertices.
    const nearestCount = Math.min(4, n - 1);
    const extraProb = n <= 16 ? 0.42 : n <= 45 ? 0.3 : 0.22;

    for (let u = 0; u < n; u += 1) {
      const pu = positions[u]!;
      const neighborsByDist: { v: NodeId; distSq: number }[] = [];
      for (let v = 0; v < n; v += 1) {
        if (u === v) continue;
        if (n >= 4 && ((u === start && v === goal) || (u === goal && v === start))) {
          continue;
        }
        const pv = positions[v]!;
        const dx = pu.x - pv.x;
        const dy = pu.y - pv.y;
        neighborsByDist.push({ v, distSq: dx * dx + dy * dy });
      }

      neighborsByDist.sort((a, b) => a.distSq - b.distSq);
      for (let k = 0; k < Math.min(nearestCount, neighborsByDist.length); k += 1) {
        if (rng() > extraProb) continue;
        const v = neighborsByDist[k]!.v;
        if (!directed) {
          linkEdge(u, v);
        } else if (isNegativeDag) {
          const from = rank[u]! < rank[v]! ? u : v;
          const to = rank[u]! < rank[v]! ? v : u;
          linkEdge(from, to);
        } else {
          const forward = positions[u]!.x <= positions[v]!.x;
          const useForward = rng() < 0.78 ? forward : !forward;
          const from = useForward ? u : v;
          const to = useForward ? v : u;
          if (!edgeKeys.has(`${to}->${from}`) || rng() < 0.2) {
            linkEdge(from, to);
          }
        }
      }
    }

    if (isNegativeDag) {
      const inDegree = new Int32Array(n);
      for (let u = 0; u < n; u += 1) {
        for (const e of adjacency[u]!) {
          inDegree[e.node]! += 1;
        }
      }

      const negPool: { u: NodeId; edgeIdx: number; dist: number }[] = [];
      for (let u = 0; u < n; u += 1) {
        const list = adjacency[u]!;
        for (let idx = 0; idx < list.length; idx += 1) {
          const v = list[idx]!.node;
          if (inDegree[v]! >= 2) {
            const dist = Math.hypot(positions[u]!.x - positions[v]!.x, positions[u]!.y - positions[v]!.y);
            negPool.push({ u, edgeIdx: idx, dist });
          }
        }
      }

      if (negPool.length === 0) {
        for (let u = 0; u < n; u += 1) {
          const list = adjacency[u]!;
          for (let idx = 0; idx < list.length; idx += 1) {
            const v = list[idx]!.node;
            const dist = Math.hypot(positions[u]!.x - positions[v]!.x, positions[u]!.y - positions[v]!.y);
            negPool.push({ u, edgeIdx: idx, dist });
          }
        }
      }

      const negTargetCount = Math.max(1, Math.min(negPool.length, Math.floor(n / 4)));
      for (let i = 0; i < negTargetCount && negPool.length > 0; i += 1) {
        const pickIdx = Math.floor(rng() * negPool.length);
        const chosen = negPool.splice(pickIdx, 1)[0]!;
        const edge = adjacency[chosen.u]![chosen.edgeIdx]!;
        adjacency[chosen.u]![chosen.edgeIdx] = {
          node: edge.node,
          cost: -Math.max(4, Math.round(chosen.dist * (0.3 + rng() * 0.25))),
        };
      }
    } else if (presetId === 'heuristic-trap-graph') {
      let targetU = -1;
      let targetV = -1;
      let bestDist = -1;
      for (let u = 0; u < n; u += 1) {
        for (const e of adjacency[u]!) {
          const d = Math.hypot(
            positions[u]!.x - positions[e.node]!.x,
            positions[u]!.y - positions[e.node]!.y,
          );
          if (e.node === goal || d > bestDist) {
            bestDist = d;
            targetU = u;
            targetV = e.node;
            if (e.node === goal && d >= 6) break;
          }
        }
        if (targetV === goal && bestDist >= 6) break;
      }

      if (targetU >= 0 && targetV >= 0) {
        const trapCost = Math.max(1, Math.floor(bestDist * 0.35));
        for (let i = 0; i < adjacency[targetU]!.length; i += 1) {
          if (adjacency[targetU]![i]!.node === targetV) {
            adjacency[targetU]![i] = { node: targetV, cost: trapCost };
          }
        }
        if (!directed) {
          for (let i = 0; i < adjacency[targetV]!.length; i += 1) {
            if (adjacency[targetV]![i]!.node === targetU) {
              adjacency[targetV]![i] = { node: targetU, cost: trapCost };
            }
          }
        }
      }
    } else if (presetId === 'negative-edge-graph' && !directed) {
      for (let u = 0; u < n; u += 1) {
        const e = adjacency[u]![0];
        if (!e) continue;
        const v = e.node;
        const d = Math.hypot(positions[u]!.x - positions[v]!.x, positions[u]!.y - positions[v]!.y);
        const negCost = -Math.max(4, Math.round(d * 0.35));
        adjacency[u]![0] = { node: v, cost: negCost };
        for (let i = 0; i < adjacency[v]!.length; i += 1) {
          if (adjacency[v]![i]!.node === u) {
            adjacency[v]![i] = { node: u, cost: negCost };
          }
        }
        break;
      }
    }
  }

  return new AdjacencyGraphProblem({
    nodeCount: n,
    start,
    goal,
    adjacency,
    positions,
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    directed,
    weighted,
  });
}
