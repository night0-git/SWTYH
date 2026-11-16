import { AdjacencyGraphProblem } from './graphProblem';
import { Grid2DProblem } from './gridProblem';
import type { Edge, NodeId, Point2D } from './types';

export const MIN_RANDOM_GRID_NODES = 2;
export const MAX_RANDOM_GRID_NODES = 2500;
export const MIN_RANDOM_GRAPH_NODES = 2;
export const MAX_RANDOM_GRAPH_NODES = 120;

const GRID_TARGET_ASPECT = 35 / 21;

export interface RandomizeGridOptions {
  readonly nodeCount: number;
  readonly allowDiagonal?: boolean;
  readonly rng?: () => number;
}

export interface RandomizeGraphOptions {
  readonly nodeCount: number;
  readonly directed?: boolean;
  readonly weighted?: boolean;
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

export function randomizeGrid(options: RandomizeGridOptions): Grid2DProblem {
  const rng = options.rng ?? Math.random;
  const allowDiagonal = options.allowDiagonal ?? false;
  const { cols, rows } = gridDimensionsForNodeCount(options.nodeCount);
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

  const gx = goal % cols;
  const gy = (goal - gx) / cols;
  const walls = new Uint8Array(total);
  const weights = new Float32Array(total);
  weights.fill(1);

  if (total >= 4) {
    let solved = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
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

      if (hasCardinalPath(cols, rows, walls, start, goal)) {
        solved = true;
        break;
      }
    }

    if (!solved) {
      carveCorridor(cols, walls, start, goal);
    }
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
  const edgeKeys = new Set<string>();

  const computeCost = (u: NodeId, v: NodeId): number => {
    const pu = positions[u]!;
    const pv = positions[v]!;
    const dist = Math.hypot(pu.x - pv.x, pu.y - pv.y);
    return Math.max(1, Math.ceil(dist) + Math.floor(rng() * Math.max(2, dist * 0.45)));
  };

  const linkEdge = (u: NodeId, v: NodeId): boolean => {
    if (u === v) return false;
    const key = directed ? `${u}->${v}` : u < v ? `${u}-${v}` : `${v}-${u}`;
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);

    const cost = computeCost(u, v);
    adjacency[u]!.push({ node: v, cost });
    if (!directed) {
      adjacency[v]!.push({ node: u, cost });
    }
    return true;
  };

  if (n === 2) {
    linkEdge(start, goal);
  } else {
    // Build a proximity-biased spanning tree rooted at Start so every vertex is reachable.
    const inTree: NodeId[] = [start];
    const inTreeMask = new Uint8Array(n);
    inTreeMask[start] = 1;

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
      inTreeMask[picked.v] = 1;
      inTree.push(picked.v);
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
