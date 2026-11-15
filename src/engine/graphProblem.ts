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
  readonly labels?: readonly (string | null | undefined)[] | null;
  readonly defaultLabels?: readonly (string | null | undefined)[] | null;
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

function normalizeLabelText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactLabelArray(
  arr: readonly (string | null)[] | null,
): readonly (string | null)[] | null {
  return arr && arr.some((item) => item !== null) ? arr : null;
}

function resolveDefaultLabel(
  node: NodeId,
  start: NodeId,
  goal: NodeId,
  defaultLabels: readonly (string | null)[] | null,
  prefixId = false,
): string {
  if (node === start) return 'S';
  if (node === goal) return 'G';
  const base = defaultLabels?.[node] ?? String(node);
  return prefixId ? `#${base}` : base;
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

function normalizeLabelArray(
  nodeCount: number,
  rawList: readonly (string | null | undefined)[] | null | undefined,
): readonly (string | null)[] | null {
  if (!rawList) return null;
  return compactLabelArray(
    Array.from({ length: nodeCount }, (_, i) => normalizeLabelText(rawList[i])),
  );
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
  readonly labels: readonly (string | null)[] | null;
  readonly defaultLabels: readonly (string | null)[] | null;

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
    this.labels = normalizeLabelArray(this.nodeCount, options.labels);
    this.defaultLabels = normalizeLabelArray(this.nodeCount, options.defaultLabels);
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
      labels: 'labels' in overrides ? overrides.labels : this.labels,
      defaultLabels:
        'defaultLabels' in overrides ? overrides.defaultLabels : this.defaultLabels,
    });
  }

  customLabel(node: NodeId): string | null {
    if (node < 0 || node >= this.nodeCount) return null;
    return this.labels?.[node] ?? null;
  }

  defaultLabel(node: NodeId, prefixId = false): string {
    return resolveDefaultLabel(node, this.start, this.goal, this.defaultLabels, prefixId);
  }

  displayLabel(node: NodeId, prefixId = false): string {
    return this.customLabel(node) ?? this.defaultLabel(node, prefixId);
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

  withRenamedVertex(node: NodeId, label: string): AdjacencyGraphProblem {
    if (node < 0 || node >= this.nodeCount) return this;
    const nextVal = normalizeLabelText(label);
    if (nextVal === this.customLabel(node)) return this;

    const nextLabels = Array.from({ length: this.nodeCount }, (_, idx) =>
      idx === node ? nextVal : this.customLabel(idx),
    );
    return this.cloneWith({ labels: compactLabelArray(nextLabels) });
  }

  private nextNumberedLabel(
    startId: NodeId,
    goalId: NodeId,
    excludeNode = -1,
  ): string {
    const used = new Set<string>();
    for (let u = 0; u < this.nodeCount; u += 1) {
      if (u === startId || u === goalId || u === excludeNode) continue;
      used.add(this.displayLabel(u));
    }
    let candidate = 1;
    while (used.has(String(candidate))) {
      candidate += 1;
    }
    return String(candidate);
  }

  withAddedVertex(pos: Point2D): AdjacencyGraphProblem {
    const nextPositions = [...(this.positions ?? []), pos];
    const nextAdjacency = [...cloneAdjacency(this.rawAdjacency), []];
    const nextLabels = this.labels ? [...this.labels, null] : null;
    const assignedDefault = this.nextNumberedLabel(this.start, this.goal);
    const nextDefaults = this.defaultLabels
      ? [...this.defaultLabels, assignedDefault]
      : [...new Array<string | null>(this.nodeCount).fill(null), assignedDefault];
    return this.cloneWith({
      nodeCount: this.nodeCount + 1,
      adjacency: nextAdjacency,
      positions: nextPositions,
      labels: nextLabels,
      defaultLabels: nextDefaults,
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
    const nextLabels = this.labels
      ? this.labels.filter((_, idx) => idx !== node)
      : null;
    const nextDefaults = this.defaultLabels
      ? this.defaultLabels.filter((_, idx) => idx !== node)
      : null;

    return this.cloneWith({
      nodeCount: this.nodeCount - 1,
      start: remapId(this.start),
      goal: remapId(this.goal),
      adjacency: nextAdjacency,
      positions: nextPositions,
      labels: compactLabelArray(nextLabels),
      defaultLabels: compactLabelArray(nextDefaults),
    });
  }

  private withSpecialNode(kind: 'start' | 'goal', node: NodeId): AdjacencyGraphProblem {
    const prev = kind === 'start' ? this.start : this.goal;
    const other = kind === 'start' ? this.goal : this.start;
    if (node < 0 || node >= this.nodeCount || node === other || node === prev) {
      return this;
    }

    const nextStart = kind === 'start' ? node : this.start;
    const nextGoal = kind === 'goal' ? node : this.goal;
    let nextDefaults = this.defaultLabels;

    if (!this.customLabel(prev)) {
      const prevFallback = this.defaultLabels?.[prev] ?? String(prev);
      let collides = false;
      for (let u = 0; u < this.nodeCount; u += 1) {
        if (u === nextStart || u === nextGoal || u === prev) continue;
        if (this.displayLabel(u) === prevFallback) {
          collides = true;
          break;
        }
      }
      if (collides) {
        const replacement = this.nextNumberedLabel(nextStart, nextGoal, prev);
        const arr = this.defaultLabels
          ? [...this.defaultLabels]
          : new Array<string | null>(this.nodeCount).fill(null);
        arr[prev] = replacement;
        nextDefaults = arr;
      }
    }

    return this.cloneWith({
      start: nextStart,
      goal: nextGoal,
      defaultLabels: nextDefaults,
    });
  }

  withStart(node: NodeId): AdjacencyGraphProblem {
    return this.withSpecialNode('start', node);
  }

  withGoal(node: NodeId): AdjacencyGraphProblem {
    return this.withSpecialNode('goal', node);
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
