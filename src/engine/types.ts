/** Dense integer node identifier (0 .. problem.nodeCount - 1). */
export type NodeId = number;

export interface Edge {
  readonly node: NodeId;
  readonly cost: number;
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface Bounds2D {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Compact per-node visual states stored in a Uint8Array for zero-allocation
 * Canvas 2D rendering.
 */
export const NodeState = {
  Unvisited: 0,
  Wall: 1,
  Start: 2,
  Goal: 3,
  Frontier: 4,
  Visited: 5,
  Current: 6,
  Path: 7,
} as const;

export type NodeState = (typeof NodeState)[keyof typeof NodeState];

/**
 * Unified problem abstraction shared across 2D grids and general graphs.
 * Algorithms interact exclusively with this interface.
 */
export interface SearchProblem {
  readonly kind: 'grid' | 'graph';
  readonly nodeCount: number;
  readonly start: NodeId;
  readonly goal: NodeId;
  isGoal(node: NodeId): boolean;
  neighbors(node: NodeId): readonly Edge[];
  heuristic(node: NodeId, target?: NodeId): number;
  position(node: NodeId): Point2D | null;
  initialStates(): Uint8Array;
}

export interface Queue<T> {
  push(item: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
  isEmpty(): boolean;
  readonly size: number;
}

export interface Stack<T> {
  push(item: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
  isEmpty(): boolean;
  readonly size: number;
}

export interface PriorityQueue<T> {
  push(item: T, priority: number): void;
  pop(): T | undefined;
  peek(): T | undefined;
  isEmpty(): boolean;
  readonly size: number;
}

export interface TrackedSet<T> {
  add(item: T): this;
  has(item: T): boolean;
  delete(item: T): boolean;
  clear(): void;
  readonly size: number;
}

export interface TrackedMap<K, V> {
  set(key: K, value: V): this;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
}

export type FlagValue = string | number | boolean | null;

export interface FlagEntry {
  readonly name: string;
  readonly value: FlagValue;
}

export interface TrackedFlags {
  set(name: string, value: FlagValue): this;
  get(name: string): FlagValue | undefined;
  delete(name: string): boolean;
  clear(): void;
}

export interface ContainerOptions {
  readonly raw?: boolean;
}

/**
 * Textbook-friendly helpers provided to each algorithm. Calling operations on
 * these collections records trace transitions and live container views
 * automatically without `yield`.
 */
export interface SearchContext {
  queue<T = NodeId>(label?: string, options?: ContainerOptions): Queue<T>;
  stack<T = NodeId>(label?: string, options?: ContainerOptions): Stack<T>;
  priorityQueue<T = NodeId>(label?: string): PriorityQueue<T>;
  set<T = NodeId>(label?: string, options?: ContainerOptions): TrackedSet<T>;
  map<K = NodeId, V = number>(label?: string, options?: ContainerOptions): TrackedMap<K, V>;
  parentMap(label?: string): TrackedMap<NodeId, NodeId>;
  flags(): TrackedFlags;
  reconstructPath(
    parent: Pick<TrackedMap<NodeId, NodeId>, 'get' | 'has'>,
    target: NodeId,
  ): NodeId[];
  /** Explicit visual marker escape hatch for non-standard algorithms. */
  mark(node: NodeId, state: NodeState): void;
}

export type AlgorithmCategory =
  | 'Uninformed'
  | 'Informed'
  | 'Local'
  | 'Custom'
  | (string & {});

export type CompatibilityWarningCode =
  | 'ignores-weights'
  | 'negative-weights'
  | 'negative-cycle'
  | 'no-positions-heuristic'
  | 'inadmissible-heuristic'
  | 'non-optimal-strategy'
  | 'cycle-reexploration'
  | 'step-budget-risk'
  | 'suboptimal-result'
  | 'incomplete-result'
  | 'invalid-path'
  | 'algorithm-incompatibility';

export interface CompatibilityWarning {
  readonly code: CompatibilityWarningCode | (string & {});
  readonly message: string;
}

export interface CompatibilityCheckContext {
  readonly problem: SearchProblem;
  readonly hasNonUnitWeights: boolean;
  readonly hasNegativeWeights: boolean;
  readonly hasCycles: boolean;
  readonly hasPositions: boolean;
  readonly runResult: RunResult | null;
}

export interface AlgorithmMeta {
  readonly id: string;
  readonly name: string;
  readonly category: AlgorithmCategory;
  readonly weighted: boolean;
  readonly usesHeuristic: boolean;
  readonly supportsNegativeWeights?: boolean;
  readonly requiresAdmissibleHeuristic?: boolean;
  readonly guaranteesOptimalUnweighted?: boolean;
  /**
   * Optional custom incompatibility check for constraints that cannot be
   * inferred automatically from standard meta capability flags alone.
   */
  readonly checkCompatibility?: (
    ctx: CompatibilityCheckContext,
  ) => readonly CompatibilityWarning[];
  /**
   * Required two-part textbook summary:
   * 1) How it selects/expands nodes.
   * 2) Its outcome/guarantee (optimality, completeness, or tradeoff).
   */
  readonly description: string;
}

export type AlgorithmSearchFn = (
  problem: SearchProblem,
  ctx: SearchContext,
) => NodeId[] | null;

export interface AlgorithmModule {
  readonly meta?: Partial<AlgorithmMeta>;
  readonly search: AlgorithmSearchFn;
}

export interface AlgorithmEntry {
  readonly meta: AlgorithmMeta;
  readonly search: AlgorithmSearchFn;
  readonly source: string;
  readonly filePath: string;
}

export type ContainerKind = 'queue' | 'stack' | 'priority-queue' | 'set' | 'map';

export interface ContainerInfo {
  readonly id: number;
  readonly kind: ContainerKind;
  readonly label: string;
  readonly rawValues?: boolean;
}

export interface ContainerEntry {
  readonly value: unknown;
  readonly mapValue?: unknown;
  readonly priority?: number;
  readonly seq?: number;
}

export interface ContainerState {
  readonly info: ContainerInfo;
  readonly entries: readonly ContainerEntry[];
  readonly size: number;
}

export type ContainerOp =
  | {
      readonly containerId: number;
      readonly type: 'push';
      readonly entry: ContainerEntry;
    }
  | {
      readonly containerId: number;
      readonly type: 'pop';
      readonly entry: ContainerEntry;
    }
  | {
      readonly containerId: number;
      readonly type: 'set-add';
      readonly value: unknown;
      readonly mutated: boolean;
    }
  | {
      readonly containerId: number;
      readonly type: 'set-delete';
      readonly value: unknown;
      readonly mutated: boolean;
    }
  | {
      readonly containerId: number;
      readonly type: 'set-clear';
      readonly prevValues: readonly unknown[];
    }
  | {
      readonly containerId: number;
      readonly type: 'map-set';
      readonly key: unknown;
      readonly value: unknown;
      readonly hadPrev: boolean;
      readonly prevValue: unknown;
    }
  | {
      readonly containerId: number;
      readonly type: 'map-delete';
      readonly key: unknown;
      readonly prevValue: unknown;
      readonly mutated: boolean;
    }
  | {
      readonly containerId: number;
      readonly type: 'map-clear';
      readonly prevEntries: readonly (readonly [unknown, unknown])[];
    };

export interface FlagDelta {
  readonly name: string;
  readonly hadPrev: boolean;
  readonly prevValue: FlagValue | undefined;
  readonly hasNext: boolean;
  readonly nextValue: FlagValue | undefined;
}

export interface StateDelta {
  readonly node: NodeId;
  readonly prev: NodeState;
  readonly next: NodeState;
}

export interface ParentDelta {
  readonly node: NodeId;
  readonly prevParent: NodeId;
  readonly nextParent: NodeId;
}

export interface TraceStep {
  readonly stateDeltas: readonly StateDelta[];
  readonly parentDeltas: readonly ParentDelta[];
  readonly flagDeltas: readonly FlagDelta[];
  readonly prevCurrent: NodeId;
  readonly nextCurrent: NodeId;
  readonly prevEdgeFrom: NodeId;
  readonly prevEdgeTo: NodeId;
  readonly nextEdgeFrom: NodeId;
  readonly nextEdgeTo: NodeId;
  readonly containerOps: readonly ContainerOp[];
  readonly lines: readonly number[];
}

export interface Trace {
  readonly initial: Uint8Array;
  readonly containers: readonly ContainerInfo[];
  readonly steps: readonly TraceStep[];
  readonly length: number;
}

export interface RunStats {
  readonly steps: number;
  readonly visitedCount: number;
  readonly pathLength: number;
  readonly pathCost: number;
  readonly durationMs: number;
  readonly truncated: boolean;
}

export interface RunResult {
  readonly trace: Trace;
  readonly path: NodeId[] | null;
  readonly stats: RunStats;
  readonly error: string | null;
}
