import type { TraceRecorder } from './trace';
import type {
  NodeId,
  PriorityQueue,
  Queue,
  SearchContext,
  SearchProblem,
  Stack,
  TrackedMap,
  TrackedSet,
} from './types';

function isNodeId(value: unknown): value is NodeId {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

class InstrumentedQueue<T> implements Queue<T> {
  private items: T[] = [];
  private head = 0;
  private readonly recorder: TraceRecorder;
  private readonly containerId: number;

  constructor(recorder: TraceRecorder, label: string) {
    this.recorder = recorder;
    this.containerId = recorder.registerContainer('queue', label);
  }

  push(item: T): void {
    this.items.push(item);
    this.recorder.recordPush(this.containerId, item);
  }

  pop(): T | undefined {
    if (this.head >= this.items.length) {
      this.recorder.tick();
      return undefined;
    }
    const item = this.items[this.head]!;
    this.head += 1;
    if (this.head > 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    this.recorder.recordPop(this.containerId, item);
    return item;
  }

  peek(): T | undefined {
    return this.items[this.head];
  }

  isEmpty(): boolean {
    return this.head >= this.items.length;
  }

  get size(): number {
    return this.items.length - this.head;
  }
}

class InstrumentedStack<T> implements Stack<T> {
  private readonly items: T[] = [];
  private readonly recorder: TraceRecorder;
  private readonly containerId: number;

  constructor(recorder: TraceRecorder, label: string) {
    this.recorder = recorder;
    this.containerId = recorder.registerContainer('stack', label);
  }

  push(item: T): void {
    this.items.push(item);
    this.recorder.recordPush(this.containerId, item);
  }

  pop(): T | undefined {
    if (this.items.length === 0) {
      this.recorder.tick();
      return undefined;
    }
    const item = this.items.pop()!;
    this.recorder.recordPop(this.containerId, item);
    return item;
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  get size(): number {
    return this.items.length;
  }
}

interface HeapNode<T> {
  readonly item: T;
  readonly priority: number;
  readonly seq: number;
}

class InstrumentedPriorityQueue<T> implements PriorityQueue<T> {
  private readonly heap: HeapNode<T>[] = [];
  private readonly recorder: TraceRecorder;
  private readonly containerId: number;
  private nextSeq = 0;

  constructor(recorder: TraceRecorder, label: string) {
    this.recorder = recorder;
    this.containerId = recorder.registerContainer('priority-queue', label);
  }

  push(item: T, priority: number): void {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.heap.push({ item, priority, seq });
    this.siftUp(this.heap.length - 1);
    this.recorder.recordPush(this.containerId, item, priority, seq);
  }

  pop(): T | undefined {
    const count = this.heap.length;
    if (count === 0) {
      this.recorder.tick();
      return undefined;
    }
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (count > 1) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    this.recorder.recordPop(this.containerId, top.item, top.priority, top.seq);
    return top.item;
  }

  peek(): T | undefined {
    return this.heap[0]?.item;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  get size(): number {
    return this.heap.length;
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const cur = this.heap[i]!;
      const par = this.heap[parent]!;
      if (
        cur.priority > par.priority ||
        (cur.priority === par.priority && cur.seq >= par.seq)
      ) {
        break;
      }
      this.heap[i] = par;
      this.heap[parent] = cur;
      i = parent;
    }
  }

  private siftDown(index: number): void {
    let i = index;
    const len = this.heap.length;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < len && this.less(left, smallest)) {
        smallest = left;
      }
      if (right < len && this.less(right, smallest)) {
        smallest = right;
      }
      if (smallest === i) break;
      const tmp = this.heap[i]!;
      this.heap[i] = this.heap[smallest]!;
      this.heap[smallest] = tmp;
      i = smallest;
    }
  }

  private less(aIdx: number, bIdx: number): boolean {
    const a = this.heap[aIdx]!;
    const b = this.heap[bIdx]!;
    return a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq);
  }
}

class InstrumentedSet<T> implements TrackedSet<T> {
  private readonly inner = new Set<T>();
  private readonly recorder: TraceRecorder;
  private readonly containerId: number;

  constructor(recorder: TraceRecorder, label: string) {
    this.recorder = recorder;
    this.containerId = recorder.registerContainer('set', label);
  }

  add(item: T): this {
    const mutated = !this.inner.has(item);
    this.inner.add(item);
    this.recorder.recordSetAdd(this.containerId, item, mutated);
    return this;
  }

  has(item: T): boolean {
    return this.inner.has(item);
  }

  delete(item: T): boolean {
    const mutated = this.inner.delete(item);
    this.recorder.recordSetDelete(this.containerId, item, mutated);
    return mutated;
  }

  clear(): void {
    const prevValues = Array.from(this.inner);
    this.inner.clear();
    this.recorder.recordSetClear(this.containerId, prevValues);
  }

  get size(): number {
    return this.inner.size;
  }
}

class InstrumentedMap<K, V> implements TrackedMap<K, V> {
  private readonly inner = new Map<K, V>();
  private readonly recorder: TraceRecorder;
  private readonly trackParents: boolean;

  constructor(recorder: TraceRecorder, trackParents: boolean) {
    this.recorder = recorder;
    this.trackParents = trackParents;
  }

  set(key: K, value: V): this {
    this.inner.set(key, value);
    if (this.trackParents && isNodeId(key) && isNodeId(value)) {
      this.recorder.recordParent(key, value);
    } else {
      this.recorder.tick();
    }
    return this;
  }

  get(key: K): V | undefined {
    return this.inner.get(key);
  }

  has(key: K): boolean {
    return this.inner.has(key);
  }

  delete(key: K): boolean {
    return this.inner.delete(key);
  }

  clear(): void {
    this.inner.clear();
  }

  get size(): number {
    return this.inner.size;
  }
}

export function createSearchContext(
  problem: SearchProblem,
  recorder: TraceRecorder,
): SearchContext {
  return {
    queue: (label = 'Queue') => new InstrumentedQueue(recorder, label),
    stack: (label = 'Stack') => new InstrumentedStack(recorder, label),
    priorityQueue: (label = 'Priority Queue') =>
      new InstrumentedPriorityQueue(recorder, label),
    set: (label = 'Visited') => new InstrumentedSet(recorder, label),
    map: (label) =>
      new InstrumentedMap(
        recorder,
        label ? label.toLowerCase().includes('parent') : false,
      ),
    parentMap: () => new InstrumentedMap(recorder, true),
    reconstructPath(parent, target) {
      const path: NodeId[] = [];
      const seen = new Set<NodeId>();
      let curr: NodeId | undefined = target;
      while (curr !== undefined && !seen.has(curr)) {
        seen.add(curr);
        path.push(curr);
        if (curr === problem.start) break;
        curr = parent.get(curr);
      }
      path.reverse();
      return path;
    },
    mark(node, state) {
      recorder.recordExplicitMark(node, state);
    },
  };
}

/**
 * Wraps SearchProblem so even algorithms using plain JS arrays/Sets still
 * produce a live visualization trace and obey the step limit.
 */
export function instrumentProblem(
  problem: SearchProblem,
  recorder: TraceRecorder,
): SearchProblem {
  return {
    kind: problem.kind,
    nodeCount: problem.nodeCount,
    start: problem.start,
    goal: problem.goal,
    isGoal(node) {
      recorder.ensureCurrent(node);
      return problem.isGoal(node);
    },
    neighbors(node) {
      recorder.ensureCurrent(node);
      return problem.neighbors(node);
    },
    heuristic(node, target) {
      return problem.heuristic(node, target);
    },
    position(node) {
      return problem.position(node);
    },
    initialStates() {
      return problem.initialStates();
    },
  };
}
