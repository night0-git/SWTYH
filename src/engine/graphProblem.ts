import {
  NodeState,
  type Bounds2D,
  type Edge,
  type NodeId,
  type Point2D,
  type SearchProblem,
} from './types';

export interface GraphOptions {
  readonly nodeCount: number;
  readonly start: NodeId;
  readonly goal: NodeId;
  readonly adjacency: readonly (readonly Edge[])[];
  readonly positions?: readonly Point2D[];
  readonly bounds?: Bounds2D;
  readonly directed?: boolean;
  readonly weighted?: boolean;
}

function computeBounds(positions: readonly Point2D[] | null): Bounds2D {
  if (!positions || positions.length === 0) {
    return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    maxX: maxX > minX ? maxX : minX + 1,
    minY,
    maxY: maxY > minY ? maxY : minY + 1,
  };
}

function cloneAdjacency(adjacency: readonly (readonly Edge[])[]): Edge[][] {
  return adjacency.map((list) => list.map((e) => ({ node: e.node, cost: e.cost })));
}

function buildEffectiveAdjacency(
  raw: readonly (readonly Edge[])[],
  weighted: boolean,
): readonly (readonly Edge[])[] {
  if (weighted) return raw;
  return raw.map((list) => list.map((e) => ({ node: e.node, cost: 1 })));
}

export class AdjacencyGraphProblem implements SearchProblem {
  readonly kind = 'graph' as const;
  readonly nodeCount: number;
  readonly start: NodeId;
  readonly goal: NodeId;
  readonly directed: boolean;
  readonly weighted: boolean;
  readonly rawAdjacency: readonly (readonly Edge[])[];
  readonly adjacency: readonly (readonly Edge[])[];
  readonly positions: readonly Point2D[] | null;
  readonly bounds: Bounds2D;

  constructor(options: GraphOptions) {
    this.nodeCount = options.nodeCount;
    this.start = options.start;
    this.goal = options.goal;
    this.directed = options.directed ?? false;
    this.weighted = options.weighted ?? true;
    this.rawAdjacency = options.adjacency;
    this.adjacency = buildEffectiveAdjacency(options.adjacency, this.weighted);
    this.positions = options.positions ?? null;
    this.bounds = options.bounds ?? computeBounds(this.positions);
  }

  private cloneWith(overrides: Partial<GraphOptions>): AdjacencyGraphProblem {
    return new AdjacencyGraphProblem({
      nodeCount: overrides.nodeCount ?? this.nodeCount,
      start: overrides.start ?? this.start,
      goal: overrides.goal ?? this.goal,
      adjacency: overrides.adjacency ?? this.rawAdjacency,
      positions: overrides.positions ?? (this.positions ?? undefined),
      bounds: overrides.bounds ?? this.bounds,
      directed: overrides.directed ?? this.directed,
      weighted: overrides.weighted ?? this.weighted,
    });
  }

  isGoal(node: NodeId): boolean {
    return node === this.goal;
  }

  neighbors(node: NodeId): readonly Edge[] {
    return this.adjacency[node] ?? [];
  }

  rawNeighbors(node: NodeId): readonly Edge[] {
    return this.rawAdjacency[node] ?? [];
  }

  heuristic(node: NodeId, target: NodeId = this.goal): number {
    if (!this.positions) return 0;
    const a = this.positions[node];
    const b = this.positions[target];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  position(node: NodeId): Point2D | null {
    return this.positions?.[node] ?? null;
  }

  initialStates(): Uint8Array {
    const states = new Uint8Array(this.nodeCount);
    states.fill(NodeState.Unvisited);
    states[this.start] = NodeState.Start;
    states[this.goal] = NodeState.Goal;
    return states;
  }

  withMovedVertex(node: NodeId, pos: Point2D): AdjacencyGraphProblem {
    if (!this.positions || node < 0 || node >= this.nodeCount) return this;
    const nextPositions = this.positions.map((p, idx) =>
      idx === node ? pos : p,
    );
    return this.cloneWith({ positions: nextPositions });
  }

  withAddedVertex(pos: Point2D): AdjacencyGraphProblem {
    const nextPositions = [...(this.positions ?? []), pos];
    const nextAdjacency = [...cloneAdjacency(this.rawAdjacency), []];
    return this.cloneWith({
      nodeCount: this.nodeCount + 1,
      adjacency: nextAdjacency,
      positions: nextPositions,
    });
  }

  withRemovedVertex(node: NodeId): AdjacencyGraphProblem {
    if (
      this.nodeCount <= 2 ||
      node < 0 ||
      node >= this.nodeCount ||
      node === this.start ||
      node === this.goal
    ) {
      return this;
    }

    const remapId = (id: NodeId): NodeId => (id > node ? id - 1 : id);
    const nextAdjacency: Edge[][] = [];
    for (let u = 0; u < this.nodeCount; u += 1) {
      if (u === node) continue;
      const list: Edge[] = [];
      for (const edge of this.rawAdjacency[u] ?? []) {
        if (edge.node === node) continue;
        list.push({ node: remapId(edge.node), cost: edge.cost });
      }
      nextAdjacency.push(list);
    }

    const nextPositions = this.positions
      ? this.positions.filter((_, idx) => idx !== node)
      : undefined;

    return this.cloneWith({
      nodeCount: this.nodeCount - 1,
      start: remapId(this.start),
      goal: remapId(this.goal),
      adjacency: nextAdjacency,
      positions: nextPositions,
    });
  }

  withStart(node: NodeId): AdjacencyGraphProblem {
    if (node < 0 || node >= this.nodeCount || node === this.goal || node === this.start) {
      return this;
    }
    return this.cloneWith({ start: node });
  }

  withGoal(node: NodeId): AdjacencyGraphProblem {
    if (node < 0 || node >= this.nodeCount || node === this.start || node === this.goal) {
      return this;
    }
    return this.cloneWith({ goal: node });
  }

  withAddedEdge(u: NodeId, v: NodeId, cost = 10): AdjacencyGraphProblem {
    if (
      u < 0 ||
      u >= this.nodeCount ||
      v < 0 ||
      v >= this.nodeCount ||
      u === v ||
      !Number.isFinite(cost)
    ) {
      return this;
    }

    const existsForward = (this.rawAdjacency[u] ?? []).some((e) => e.node === v);
    if (existsForward) {
      return this;
    }

    const nextAdj = cloneAdjacency(this.rawAdjacency);
    const storedCost = this.weighted ? cost : Math.round(cost) || 1;
    nextAdj[u]!.push({ node: v, cost: storedCost });

    if (!this.directed) {
      const existsBack = nextAdj[v]!.some((e) => e.node === u);
      if (!existsBack) {
        nextAdj[v]!.push({ node: u, cost: storedCost });
      }
    }

    return this.cloneWith({ adjacency: nextAdj });
  }

  withEdgeWeight(u: NodeId, v: NodeId, cost: number): AdjacencyGraphProblem {
    if (
      u < 0 ||
      u >= this.nodeCount ||
      v < 0 ||
      v >= this.nodeCount ||
      !Number.isFinite(cost)
    ) {
      return this;
    }

    let changed = false;
    const nextAdj = cloneAdjacency(this.rawAdjacency);

    for (const edge of nextAdj[u]!) {
      if (edge.node === v) {
        (edge as { cost: number }).cost = cost;
        changed = true;
      }
    }

    if (!this.directed) {
      for (const edge of nextAdj[v]!) {
        if (edge.node === u) {
          (edge as { cost: number }).cost = cost;
          changed = true;
        }
      }
    }

    if (!changed) return this;
    return this.cloneWith({ adjacency: nextAdj, weighted: true });
  }

  withRemovedEdge(u: NodeId, v: NodeId): AdjacencyGraphProblem {
    if (u < 0 || u >= this.nodeCount || v < 0 || v >= this.nodeCount) {
      return this;
    }

    const nextAdj = cloneAdjacency(this.rawAdjacency);
    const beforeU = nextAdj[u]!.length;
    nextAdj[u] = nextAdj[u]!.filter((e) => e.node !== v);
    let changed = nextAdj[u]!.length !== beforeU;

    if (!this.directed) {
      const beforeV = nextAdj[v]!.length;
      nextAdj[v] = nextAdj[v]!.filter((e) => e.node !== u);
      changed = changed || nextAdj[v]!.length !== beforeV;
    }

    if (!changed) return this;
    return this.cloneWith({ adjacency: nextAdj });
  }

  withDirected(directed: boolean): AdjacencyGraphProblem {
    if (directed === this.directed) return this;
    const nextAdj: Edge[][] = Array.from({ length: this.nodeCount }, () => []);

    if (directed) {
      // Collapse undirected pairs into single canonical u -> v edges (u < v).
      const seen = new Set<string>();
      for (let u = 0; u < this.nodeCount; u += 1) {
        for (const edge of this.rawAdjacency[u] ?? []) {
          const v = edge.node;
          const a = Math.min(u, v);
          const b = Math.max(u, v);
          const key = `${a}-${b}`;
          if (seen.has(key)) continue;
          seen.add(key);
          nextAdj[a]!.push({ node: b, cost: edge.cost });
        }
      }
    } else {
      // Symmetrize all directed edges into undirected pairs.
      const seen = new Set<string>();
      for (let u = 0; u < this.nodeCount; u += 1) {
        for (const edge of this.rawAdjacency[u] ?? []) {
          const v = edge.node;
          const a = Math.min(u, v);
          const b = Math.max(u, v);
          const key = `${a}-${b}`;
          if (seen.has(key)) continue;
          seen.add(key);
          nextAdj[a]!.push({ node: b, cost: edge.cost });
          nextAdj[b]!.push({ node: a, cost: edge.cost });
        }
      }
    }

    return this.cloneWith({ directed, adjacency: nextAdj });
  }

  withWeighted(weighted: boolean): AdjacencyGraphProblem {
    if (weighted === this.weighted) return this;
    return this.cloneWith({ weighted });
  }

  clearedEdges(): AdjacencyGraphProblem {
    const emptyAdj: Edge[][] = Array.from({ length: this.nodeCount }, () => []);
    return this.cloneWith({ adjacency: emptyAdj });
  }
}
