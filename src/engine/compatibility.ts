import type {
  AlgorithmEntry,
  CompatibilityCheckContext,
  CompatibilityWarning,
  Edge,
  RunResult,
  SearchProblem,
} from './types';

export type { CompatibilityWarning } from './types';

export type OptimalStatus = 'ok' | 'unreachable' | 'negative-cycle' | 'skipped';

export interface CompatibilityReport {
  readonly warnings: readonly CompatibilityWarning[];
  readonly optimalStatus: OptimalStatus;
  readonly optimalCost: number | null;
}

interface ProblemAnalysis {
  readonly hasNonUnitWeights: boolean;
  readonly hasNegativeWeights: boolean;
  readonly hasCycles: boolean;
  readonly hasPositions: boolean;
  readonly hasInadmissibleEdge: boolean;
}

function formatCost(cost: number): string {
  if (Number.isInteger(cost)) return String(cost);
  const rounded = Math.round(cost * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : cost.toFixed(1);
}

function detectReachableCycles(problem: SearchProblem): boolean {
  const n = problem.nodeCount;
  if (problem.start < 0 || problem.start >= n) return false;

  const isDirected =
    problem.kind === 'graph' &&
    Boolean((problem as { readonly directed?: boolean }).directed);
  const color = new Uint8Array(n); // 0 = unvisited, 1 = visiting, 2 = done
  const parent = new Int32Array(n);
  parent.fill(-1);

  const stackNodes: number[] = [problem.start];
  const stackEdgeIdx: number[] = [0];
  const stackEdges: (readonly Edge[])[] = [problem.neighbors(problem.start)];
  color[problem.start] = 1;

  while (stackNodes.length > 0) {
    const top = stackNodes.length - 1;
    const u = stackNodes[top]!;
    const idx = stackEdgeIdx[top]!;
    const edges = stackEdges[top]!;

    if (idx >= edges.length) {
      color[u] = 2;
      stackNodes.pop();
      stackEdgeIdx.pop();
      stackEdges.pop();
      continue;
    }

    stackEdgeIdx[top] = idx + 1;
    const v = edges[idx]!.node;
    if (v < 0 || v >= n) continue;

    if (color[v] === 0) {
      color[v] = 1;
      parent[v] = u;
      stackNodes.push(v);
      stackEdgeIdx.push(0);
      stackEdges.push(problem.neighbors(v));
    } else if (color[v] === 1 && (isDirected || v !== parent[u])) {
      return true;
    }
  }

  return false;
}

function analyzeProblem(problem: SearchProblem): ProblemAnalysis {
  const n = problem.nodeCount;
  const visited = new Uint8Array(n);
  const queue: number[] = [];
  let head = 0;

  if (problem.start >= 0 && problem.start < n) {
    visited[problem.start] = 1;
    queue.push(problem.start);
  }

  const hasPositions = problem.position(problem.start) !== null;
  let hasNonUnitWeights = false;
  let hasNegativeWeights = false;
  let hasInadmissibleEdge = false;

  while (head < queue.length) {
    const u = queue[head++]!;
    for (const edge of problem.neighbors(u)) {
      if (Math.abs(edge.cost - 1) > 1e-6) {
        hasNonUnitWeights = true;
      }
      if (edge.cost < 0) {
        hasNegativeWeights = true;
      }
      if (hasPositions && edge.cost < problem.heuristic(u, edge.node) - 1e-4) {
        hasInadmissibleEdge = true;
      }
      if (edge.node >= 0 && edge.node < n && visited[edge.node] === 0) {
        visited[edge.node] = 1;
        queue.push(edge.node);
      }
    }
  }

  return {
    hasNonUnitWeights,
    hasNegativeWeights,
    hasCycles: detectReachableCycles(problem),
    hasPositions,
    hasInadmissibleEdge,
  };
}

class FloatMinHeap {
  private readonly nodes: number[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, cost: number): void {
    this.nodes.push(node);
    this.costs.push(cost);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.costs[p]! <= this.costs[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number] {
    const topNode = this.nodes[0]!;
    const topCost = this.costs[0]!;
    const lastNode = this.nodes.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.costs[0] = lastCost;
      let i = 0;
      const len = this.nodes.length;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < len && this.costs[l]! < this.costs[smallest]!) smallest = l;
        if (r < len && this.costs[r]! < this.costs[smallest]!) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return [topNode, topCost];
  }

  private swap(a: number, b: number): void {
    const tn = this.nodes[a]!;
    const tc = this.costs[a]!;
    this.nodes[a] = this.nodes[b]!;
    this.costs[a] = this.costs[b]!;
    this.nodes[b] = tn;
    this.costs[b] = tc;
  }
}

function solveWithDijkstra(problem: SearchProblem): {
  status: OptimalStatus;
  optimalCost: number | null;
} {
  const n = problem.nodeCount;
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  const closed = new Uint8Array(n);
  const heap = new FloatMinHeap();

  dist[problem.start] = 0;
  heap.push(problem.start, 0);

  while (heap.size > 0) {
    const [u, d] = heap.pop();
    if (closed[u] === 1) continue;
    closed[u] = 1;

    if (problem.isGoal(u)) {
      return { status: 'ok', optimalCost: d };
    }

    for (const edge of problem.neighbors(u)) {
      if (closed[edge.node] === 1) continue;
      const next = d + edge.cost;
      if (next < dist[edge.node]!) {
        dist[edge.node] = next;
        heap.push(edge.node, next);
      }
    }
  }

  return { status: 'unreachable', optimalCost: null };
}

function solveWithSpfa(problem: SearchProblem): {
  status: OptimalStatus;
  optimalCost: number | null;
} {
  const n = problem.nodeCount;
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  const inQueue = new Uint8Array(n);
  const relaxCount = new Int32Array(n);
  const queue: number[] = [];

  dist[problem.start] = 0;
  inQueue[problem.start] = 1;
  queue.push(problem.start);

  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]!;
    inQueue[u] = 0;
    const base = dist[u]!;

    for (const edge of problem.neighbors(u)) {
      const next = base + edge.cost;
      if (next < dist[edge.node]! - 1e-9) {
        dist[edge.node] = next;
        relaxCount[edge.node]! += 1;
        if (relaxCount[edge.node]! >= n) {
          return { status: 'negative-cycle', optimalCost: null };
        }
        if (inQueue[edge.node] === 0) {
          inQueue[edge.node] = 1;
          queue.push(edge.node);
        }
      }
    }
  }

  const goalCost = dist[problem.goal]!;
  if (!Number.isFinite(goalCost)) {
    return { status: 'unreachable', optimalCost: null };
  }
  return { status: 'ok', optimalCost: goalCost };
}

export function computeOptimalCost(
  problem: SearchProblem,
  hasNegativeWeights: boolean,
): { status: OptimalStatus; optimalCost: number | null } {
  if (problem.nodeCount > 5000 || problem.start < 0 || problem.start >= problem.nodeCount) {
    return { status: 'skipped', optimalCost: null };
  }
  return hasNegativeWeights ? solveWithSpfa(problem) : solveWithDijkstra(problem);
}

export function evaluateCompatibility(
  entry: AlgorithmEntry | undefined,
  problem: SearchProblem,
  runResult: RunResult | null,
): CompatibilityReport {
  if (!entry) {
    return { warnings: [], optimalStatus: 'skipped', optimalCost: null };
  }

  const analysis = analyzeProblem(problem);
  const optimal = computeOptimalCost(problem, analysis.hasNegativeWeights);
  const warnings: CompatibilityWarning[] = [];
  const { meta } = entry;

  if (!meta.weighted && analysis.hasNonUnitWeights) {
    warnings.push({
      code: 'ignores-weights',
      message: `${meta.name} ignores edge weights and optimizes hop count instead of total path cost.`,
    });
  }

  if (optimal.status === 'negative-cycle') {
    warnings.push({
      code: 'negative-cycle',
      message: 'Reachable negative-weight cycle detected — shortest path cost is undefined (-∞).',
    });
  } else if (analysis.hasNegativeWeights && !meta.supportsNegativeWeights) {
    warnings.push({
      code: 'negative-weights',
      message: `Contains negative edge weights: ${meta.name} assumes non-negative costs and may return a suboptimal path or loop.`,
    });
  }

  if (meta.usesHeuristic && !analysis.hasPositions) {
    warnings.push({
      code: 'no-positions-heuristic',
      message: 'Graph has no 2D coordinates: heuristic h(n) evaluates to 0.',
    });
  } else if (
    (meta.requiresAdmissibleHeuristic ?? meta.usesHeuristic) &&
    !analysis.hasNegativeWeights &&
    (analysis.hasInadmissibleEdge ||
      (optimal.status === 'ok' &&
        optimal.optimalCost !== null &&
        problem.heuristic(problem.start) > optimal.optimalCost + 1e-4))
  ) {
    warnings.push({
      code: 'inadmissible-heuristic',
      message: `Heuristic h(n) exceeds true step cost here (inadmissible): ${meta.name} is not guaranteed optimal.`,
    });
  }

  if (meta.guaranteesOptimalUnweighted === false) {
    warnings.push({
      code: 'non-optimal-strategy',
      message: `${meta.name} does not guarantee shortest hops or lowest path cost, even on unweighted graphs.`,
    });
  }

  if (meta.checkCompatibility) {
    const checkCtx: CompatibilityCheckContext = {
      problem,
      hasNonUnitWeights: analysis.hasNonUnitWeights,
      hasNegativeWeights: analysis.hasNegativeWeights,
      hasCycles: analysis.hasCycles,
      hasPositions: analysis.hasPositions,
      runResult,
    };
    for (const custom of meta.checkCompatibility(checkCtx)) {
      warnings.push(custom);
    }
  }

  if (runResult && !runResult.error) {
    if (runResult.path && Number.isNaN(runResult.stats.pathCost)) {
      warnings.push({
        code: 'invalid-path',
        message: 'Invalid path returned: consecutive vertices are not connected by an edge.',
      });
    } else if (!runResult.path && optimal.status === 'ok' && optimal.optimalCost !== null) {
      warnings.push({
        code: 'incomplete-result',
        message: `Returned no path, though Goal is reachable (optimal cost ${formatCost(optimal.optimalCost)}).`,
      });
    } else if (
      runResult.path &&
      optimal.status === 'ok' &&
      optimal.optimalCost !== null &&
      runResult.stats.pathCost > optimal.optimalCost + 1e-4
    ) {
      warnings.push({
        code: 'suboptimal-result',
        message: `Suboptimal path: returned cost ${formatCost(runResult.stats.pathCost)} vs. optimal ${formatCost(optimal.optimalCost)}.`,
      });
    }
  }

  const deduped: CompatibilityWarning[] = [];
  const seenCodes = new Set<string>();
  for (const warning of warnings) {
    if (seenCodes.has(warning.code)) continue;
    seenCodes.add(warning.code);
    deduped.push(warning);
  }

  return {
    warnings: deduped,
    optimalStatus: optimal.status,
    optimalCost: optimal.optimalCost,
  };
}
