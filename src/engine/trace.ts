import {
  NodeState,
  type ContainerEntry,
  type ContainerInfo,
  type ContainerKind,
  type ContainerOp,
  type ContainerState,
  type FlagDelta,
  type FlagEntry,
  type FlagValue,
  type NodeId,
  type ParentDelta,
  type StateDelta,
  type Trace,
  type TraceStep,
} from './types';

export class StepLimitError extends Error {
  constructor(limit: number) {
    super(`Execution stopped after reaching step limit (${limit}).`);
    this.name = 'StepLimitError';
  }
}

function isValidNode(value: unknown, nodeCount: number): value is NodeId {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < nodeCount
  );
}

type BeatKind = 'none' | 'push' | 'pop' | 'set' | 'map' | 'parent' | 'flag' | 'clear' | 'current' | 'other';

interface MutableTraceStep {
  stateDeltas: StateDelta[];
  parentDeltas: ParentDelta[];
  flagDeltas: FlagDelta[];
  prevCurrent: NodeId;
  nextCurrent: NodeId;
  prevEdgeFrom: NodeId;
  prevEdgeTo: NodeId;
  nextEdgeFrom: NodeId;
  nextEdgeTo: NodeId;
  containerOps: ContainerOp[];
  lines: number[];
}

type StepPayload = Omit<MutableTraceStep, 'lines'>;

/**
 * Records node-state deltas, parent tree links, active edges, flags, and container ops,
 * coalescing adjacent bookkeeping ops on the same node into single textbook beats.
 */
export class TraceRecorder {
  private readonly initial: Uint8Array;
  private readonly working: Uint8Array;
  private readonly workingParents: Int32Array;
  private readonly seenExpanded: Uint8Array;
  private readonly maxEvents: number;
  private readonly containers: ContainerInfo[] = [];
  private readonly containerRaw: boolean[] = [];
  private readonly steps: MutableTraceStep[] = [];
  private currentNode: NodeId = -1;
  private activeEdgeFrom: NodeId = -1;
  private activeEdgeTo: NodeId = -1;
  private currentLine = 0;
  private lastBeatKind: BeatKind = 'none';
  private lastBeatNode: NodeId = -1;
  private ops = 0;
  private _visitedCount = 0;
  private _truncated = false;

  constructor(initial: Uint8Array, maxEvents = 120_000) {
    this.initial = new Uint8Array(initial);
    this.working = new Uint8Array(initial);
    this.workingParents = new Int32Array(initial.length).fill(-1);
    this.seenExpanded = new Uint8Array(initial.length);
    this.maxEvents = maxEvents;
  }

  get truncated(): boolean {
    return this._truncated;
  }

  get visitedCount(): number {
    return this._visitedCount;
  }

  setLine(line: number): void {
    this.currentLine = line;
  }

  private appendCurrentLine(lines: number[]): void {
    if (this.currentLine > 0 && !lines.includes(this.currentLine)) {
      lines.push(this.currentLine);
    }
  }

  registerContainer(kind: ContainerKind, label: string, rawValues = false): number {
    const id = this.containers.length;
    this.containers.push(
      rawValues ? { id, kind, label, rawValues: true } : { id, kind, label },
    );
    this.containerRaw.push(rawValues);
    return id;
  }

  tick(): void {
    this.ops += 1;
    if (this.ops > this.maxEvents) {
      this._truncated = true;
      throw new StepLimitError(this.maxEvents);
    }
  }

  private pushStep(
    step: StepPayload,
    beatKind: BeatKind,
    beatNode: NodeId,
  ): void {
    if (this.steps.length >= this.maxEvents) {
      this._truncated = true;
      throw new StepLimitError(this.maxEvents);
    }
    this.steps.push({
      ...step,
      lines: this.currentLine > 0 ? [this.currentLine] : [],
    });
    this.lastBeatKind = beatKind;
    this.lastBeatNode = beatNode;
  }

  private applyStateChange(
    deltas: StateDelta[],
    node: NodeId,
    next: NodeState,
  ): void {
    if (node < 0 || node >= this.working.length) return;
    const prev = this.working[node] as NodeState;

    if (
      prev === NodeState.Wall ||
      prev === NodeState.Start ||
      prev === NodeState.Goal
    ) {
      return;
    }

    if (prev === next) return;

    if (
      (next === NodeState.Visited || next === NodeState.Current) &&
      this.seenExpanded[node] === 0
    ) {
      this.seenExpanded[node] = 1;
      this._visitedCount += 1;
    }

    this.working[node] = next;
    deltas.push({ node, prev, next });
  }

  private markExpanded(node: NodeId): void {
    if (
      node >= 0 &&
      node < this.working.length &&
      this.working[node] !== NodeState.Wall &&
      this.seenExpanded[node] === 0
    ) {
      this.seenExpanded[node] = 1;
      this._visitedCount += 1;
    }
  }

  ensureCurrent(node: NodeId): void {
    this.tick();
    if (this.currentNode === node) return;

    const deltas: StateDelta[] = [];
    const prevCurrent = this.currentNode;
    if (prevCurrent >= 0 && this.working[prevCurrent] === NodeState.Current) {
      this.applyStateChange(deltas, prevCurrent, NodeState.Visited);
    }

    this.markExpanded(node);
    this.applyStateChange(deltas, node, NodeState.Current);

    const prevEdgeFrom = this.activeEdgeFrom;
    const prevEdgeTo = this.activeEdgeTo;
    this.currentNode = node;
    this.activeEdgeFrom = -1;
    this.activeEdgeTo = -1;

    this.pushStep(
      {
        stateDeltas: deltas,
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent,
        nextCurrent: node,
        prevEdgeFrom,
        prevEdgeTo,
        nextEdgeFrom: -1,
        nextEdgeTo: -1,
        containerOps: [],
      },
      'current',
      node,
    );
  }

  recordPush(
    containerId: number,
    value: unknown,
    priority?: number,
    seq?: number,
  ): void {
    this.tick();
    const isRaw = this.containerRaw[containerId] === true;
    const validNode = !isRaw && isValidNode(value, this.working.length);
    const nodeId = validNode ? value : -1;
    const op: ContainerOp = {
      containerId,
      type: 'push',
      entry: { value, priority, seq },
    };

    const last = this.steps[this.steps.length - 1];
    const canMergeNode =
      last !== undefined &&
      validNode &&
      this.lastBeatNode === nodeId &&
      (this.lastBeatKind === 'set' ||
        this.lastBeatKind === 'parent' ||
        this.lastBeatKind === 'map') &&
      !last.containerOps.some((o) => o.type === 'push');

    if (canMergeNode) {
      this.applyStateChange(last.stateDeltas, nodeId, NodeState.Frontier);
      if (this.currentNode >= 0 && this.currentNode !== nodeId) {
        this.activeEdgeFrom = this.currentNode;
        this.activeEdgeTo = nodeId;
        last.nextEdgeFrom = this.currentNode;
        last.nextEdgeTo = nodeId;
      }
      last.containerOps.push(op);
      this.appendCurrentLine(last.lines);
      this.lastBeatKind = 'push';
      return;
    }

    const canMergeRaw =
      isRaw &&
      last !== undefined &&
      this.lastBeatKind === 'push' &&
      !last.containerOps.some((o) => o.containerId === containerId);

    if (canMergeRaw) {
      last.containerOps.push(op);
      this.appendCurrentLine(last.lines);
      return;
    }

    const deltas: StateDelta[] = [];
    let nextEdgeFrom = this.activeEdgeFrom;
    let nextEdgeTo = this.activeEdgeTo;

    if (validNode) {
      this.applyStateChange(deltas, nodeId, NodeState.Frontier);
      if (this.currentNode >= 0 && this.currentNode !== nodeId) {
        nextEdgeFrom = this.currentNode;
        nextEdgeTo = nodeId;
      }
    }

    const prevEdgeFrom = this.activeEdgeFrom;
    const prevEdgeTo = this.activeEdgeTo;
    this.activeEdgeFrom = nextEdgeFrom;
    this.activeEdgeTo = nextEdgeTo;

    this.pushStep(
      {
        stateDeltas: deltas,
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom,
        prevEdgeTo,
        nextEdgeFrom,
        nextEdgeTo,
        containerOps: [op],
      },
      isRaw ? 'other' : 'push',
      nodeId,
    );
  }

  recordPop(
    containerId: number,
    value: unknown,
    priority?: number,
    seq?: number,
  ): void {
    this.tick();
    const isRaw = this.containerRaw[containerId] === true;
    const validNode = !isRaw && isValidNode(value, this.working.length);
    const op: ContainerOp = {
      containerId,
      type: 'pop',
      entry: { value, priority, seq },
    };

    const last = this.steps[this.steps.length - 1];
    const canMergeRaw =
      isRaw &&
      last !== undefined &&
      this.lastBeatKind === 'pop' &&
      !last.containerOps.some((o) => o.containerId === containerId);

    if (canMergeRaw) {
      last.containerOps.push(op);
      this.appendCurrentLine(last.lines);
      return;
    }

    const deltas: StateDelta[] = [];
    const prevCurrent = this.currentNode;
    let nextCurrent = this.currentNode;

    if (validNode) {
      if (
        prevCurrent >= 0 &&
        prevCurrent !== value &&
        this.working[prevCurrent] === NodeState.Current
      ) {
        this.applyStateChange(deltas, prevCurrent, NodeState.Visited);
      }
      this.markExpanded(value);
      this.applyStateChange(deltas, value, NodeState.Current);
      nextCurrent = value;
    }

    const prevEdgeFrom = this.activeEdgeFrom;
    const prevEdgeTo = this.activeEdgeTo;
    this.currentNode = nextCurrent;
    this.activeEdgeFrom = -1;
    this.activeEdgeTo = -1;

    this.pushStep(
      {
        stateDeltas: deltas,
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent,
        nextCurrent,
        prevEdgeFrom,
        prevEdgeTo,
        nextEdgeFrom: -1,
        nextEdgeTo: -1,
        containerOps: [op],
      },
      isRaw ? 'other' : 'pop',
      validNode ? value : -1,
    );
  }

  recordParent(node: NodeId, parent: NodeId): void {
    this.tick();
    if (node < 0 || node >= this.workingParents.length) return;
    const prevParent = this.workingParents[node]!;
    this.workingParents[node] = parent;

    const parentDelta: ParentDelta = {
      node,
      prevParent,
      nextParent: parent,
    };

    const last = this.steps[this.steps.length - 1];
    if (
      last &&
      (this.lastBeatKind === 'set' || this.lastBeatKind === 'map') &&
      this.lastBeatNode === node
    ) {
      last.parentDeltas.push(parentDelta);
      this.activeEdgeFrom = parent;
      this.activeEdgeTo = node;
      last.nextEdgeFrom = parent;
      last.nextEdgeTo = node;
      this.appendCurrentLine(last.lines);
      return;
    }

    const prevEdgeFrom = this.activeEdgeFrom;
    const prevEdgeTo = this.activeEdgeTo;
    this.activeEdgeFrom = parent;
    this.activeEdgeTo = node;

    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [parentDelta],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom,
        prevEdgeTo,
        nextEdgeFrom: parent,
        nextEdgeTo: node,
        containerOps: [],
      },
      'parent',
      node,
    );
  }

  recordSetAdd(containerId: number, value: unknown, mutated: boolean): void {
    this.tick();
    if (!mutated) return;

    const isRaw = this.containerRaw[containerId] === true;
    const validNode = !isRaw && isValidNode(value, this.working.length);
    const nodeId = validNode ? value : -1;
    const op: ContainerOp = {
      containerId,
      type: 'set-add',
      value,
      mutated,
    };

    const last = this.steps[this.steps.length - 1];
    const canMerge =
      last !== undefined &&
      validNode &&
      this.lastBeatNode === nodeId &&
      (this.lastBeatKind === 'pop' || this.lastBeatKind === 'push') &&
      !last.containerOps.some((o) => o.containerId === containerId);

    if (canMerge) {
      last.containerOps.push(op);
      this.appendCurrentLine(last.lines);
      return;
    }

    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [op],
      },
      'set',
      nodeId,
    );
  }

  recordSetDelete(containerId: number, value: unknown, mutated: boolean): void {
    this.tick();
    if (!mutated) return;
    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [
          {
            containerId,
            type: 'set-delete',
            value,
            mutated,
          },
        ],
      },
      'other',
      -1,
    );
  }

  recordSetClear(containerId: number, prevValues: readonly unknown[]): void {
    this.tick();
    if (prevValues.length === 0) return;
    const op: ContainerOp = {
      containerId,
      type: 'set-clear',
      prevValues,
    };
    const last = this.steps[this.steps.length - 1];
    if (
      last !== undefined &&
      this.lastBeatKind === 'clear' &&
      !last.containerOps.some((o) => o.containerId === containerId)
    ) {
      last.containerOps.push(op);
      this.appendCurrentLine(last.lines);
      return;
    }
    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [op],
      },
      'clear',
      -1,
    );
  }

  recordMapSet(
    containerId: number,
    key: unknown,
    value: unknown,
    hadPrev: boolean,
    prevValue: unknown,
  ): void {
    this.tick();
    if (hadPrev && Object.is(prevValue, value)) return;

    const isRaw = this.containerRaw[containerId] === true;
    const validNode = !isRaw && isValidNode(key, this.working.length);
    const nodeId = validNode ? key : -1;
    const op: ContainerOp = {
      containerId,
      type: 'map-set',
      key,
      value,
      hadPrev,
      prevValue,
    };

    const last = this.steps[this.steps.length - 1];
    const canMerge =
      last !== undefined &&
      validNode &&
      this.lastBeatNode === nodeId &&
      (this.lastBeatKind === 'set' || this.lastBeatKind === 'parent') &&
      !last.containerOps.some((o) => o.containerId === containerId);

    if (canMerge) {
      last.containerOps.push(op);
      this.appendCurrentLine(last.lines);
      return;
    }

    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [op],
      },
      'map',
      nodeId,
    );
  }

  recordMapDelete(
    containerId: number,
    key: unknown,
    prevValue: unknown,
    mutated: boolean,
  ): void {
    this.tick();
    if (!mutated) return;
    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [
          {
            containerId,
            type: 'map-delete',
            key,
            prevValue,
            mutated,
          },
        ],
      },
      'other',
      -1,
    );
  }

  recordMapClear(
    containerId: number,
    prevEntries: readonly (readonly [unknown, unknown])[],
  ): void {
    this.tick();
    if (prevEntries.length === 0) return;
    const op: ContainerOp = {
      containerId,
      type: 'map-clear',
      prevEntries,
    };
    const last = this.steps[this.steps.length - 1];
    if (
      last !== undefined &&
      this.lastBeatKind === 'clear' &&
      !last.containerOps.some((o) => o.containerId === containerId)
    ) {
      last.containerOps.push(op);
      this.appendCurrentLine(last.lines);
      return;
    }
    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [op],
      },
      'clear',
      -1,
    );
  }

  recordFlagSet(
    name: string,
    hadPrev: boolean,
    prevValue: FlagValue | undefined,
    nextValue: FlagValue,
  ): void {
    this.tick();
    if (hadPrev && Object.is(prevValue, nextValue)) return;

    const delta: FlagDelta = {
      name,
      hadPrev,
      prevValue,
      hasNext: true,
      nextValue,
    };

    const last = this.steps[this.steps.length - 1];
    if (
      last !== undefined &&
      !last.flagDeltas.some((d) => d.name === name) &&
      (this.lastBeatKind === 'flag' ||
        (this.lastBeatKind === 'pop' &&
          !last.containerOps.some((o) => o.type === 'set-add')))
    ) {
      last.flagDeltas.push(delta);
      this.appendCurrentLine(last.lines);
      return;
    }

    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas: [delta],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [],
      },
      'flag',
      -1,
    );
  }

  recordFlagDelete(
    name: string,
    prevValue: FlagValue | undefined,
    mutated: boolean,
  ): void {
    this.tick();
    if (!mutated) return;

    const delta: FlagDelta = {
      name,
      hadPrev: true,
      prevValue,
      hasNext: false,
      nextValue: undefined,
    };

    const last = this.steps[this.steps.length - 1];
    if (
      last !== undefined &&
      this.lastBeatKind === 'flag' &&
      !last.flagDeltas.some((d) => d.name === name)
    ) {
      last.flagDeltas.push(delta);
      this.appendCurrentLine(last.lines);
      return;
    }

    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas: [delta],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [],
      },
      'flag',
      -1,
    );
  }

  recordFlagClear(prevEntries: readonly (readonly [string, FlagValue])[]): void {
    this.tick();
    if (prevEntries.length === 0) return;
    const flagDeltas: FlagDelta[] = prevEntries.map(([name, prevValue]) => ({
      name,
      hadPrev: true,
      prevValue,
      hasNext: false,
      nextValue: undefined,
    }));
    this.pushStep(
      {
        stateDeltas: [],
        parentDeltas: [],
        flagDeltas,
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [],
      },
      'other',
      -1,
    );
  }

  recordExplicitMark(node: NodeId, next: NodeState): void {
    this.tick();
    const deltas: StateDelta[] = [];
    this.applyStateChange(deltas, node, next);
    if (deltas.length === 0) return;

    this.pushStep(
      {
        stateDeltas: deltas,
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent: this.currentNode,
        nextCurrent: this.currentNode,
        prevEdgeFrom: this.activeEdgeFrom,
        prevEdgeTo: this.activeEdgeTo,
        nextEdgeFrom: this.activeEdgeFrom,
        nextEdgeTo: this.activeEdgeTo,
        containerOps: [],
      },
      'other',
      node,
    );
  }

  recordPath(path: readonly NodeId[]): void {
    const deltas: StateDelta[] = [];
    const prevCurrent = this.currentNode;
    if (prevCurrent >= 0 && this.working[prevCurrent] === NodeState.Current) {
      this.applyStateChange(deltas, prevCurrent, NodeState.Visited);
    }
    for (const node of path) {
      this.applyStateChange(deltas, node, NodeState.Path);
    }

    const prevEdgeFrom = this.activeEdgeFrom;
    const prevEdgeTo = this.activeEdgeTo;
    this.currentNode = -1;
    this.activeEdgeFrom = -1;
    this.activeEdgeTo = -1;

    if (deltas.length === 0 && prevCurrent === -1) return;
    this.pushStep(
      {
        stateDeltas: deltas,
        parentDeltas: [],
        flagDeltas: [],
        prevCurrent,
        nextCurrent: -1,
        prevEdgeFrom,
        prevEdgeTo,
        nextEdgeFrom: -1,
        nextEdgeTo: -1,
        containerOps: [],
      },
      'other',
      -1,
    );
  }

  build(): Trace {
    return {
      initial: this.initial,
      containers: this.containers,
      steps: this.steps,
      length: this.steps.length,
    };
  }
}

class Deque<T> {
  private buf: (T | undefined)[] = new Array(16);
  private head = 0;
  private count = 0;

  get size(): number {
    return this.count;
  }

  private grow(): void {
    const next = new Array<T | undefined>(this.buf.length * 2);
    for (let i = 0; i < this.count; i += 1) {
      next[i] = this.buf[(this.head + i) % this.buf.length];
    }
    this.buf = next;
    this.head = 0;
  }

  pushBack(item: T): void {
    if (this.count === this.buf.length) this.grow();
    const tail = (this.head + this.count) % this.buf.length;
    this.buf[tail] = item;
    this.count += 1;
  }

  popBack(): T | undefined {
    if (this.count === 0) return undefined;
    this.count -= 1;
    const tail = (this.head + this.count) % this.buf.length;
    const item = this.buf[tail];
    this.buf[tail] = undefined;
    return item;
  }

  pushFront(item: T): void {
    if (this.count === this.buf.length) this.grow();
    this.head = (this.head - 1 + this.buf.length) % this.buf.length;
    this.buf[this.head] = item;
    this.count += 1;
  }

  popFront(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.buf[this.head];
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) % this.buf.length;
    this.count -= 1;
    return item;
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  snapshot(limit: number): T[] {
    const n = Math.min(this.count, limit);
    const out: T[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      out[i] = this.buf[(this.head + i) % this.buf.length]!;
    }
    return out;
  }
}

class ShadowContainer {
  readonly info: ContainerInfo;
  private readonly deque: Deque<ContainerEntry> | null = null;
  private readonly stackItems: ContainerEntry[] | null = null;
  private readonly pqDesc: ContainerEntry[] | null = null;
  private readonly setItems: Set<unknown> | null = null;
  private readonly mapItems: Map<unknown, unknown> | null = null;

  constructor(info: ContainerInfo) {
    this.info = info;
    switch (info.kind) {
      case 'queue':
        this.deque = new Deque();
        break;
      case 'stack':
        this.stackItems = [];
        break;
      case 'priority-queue':
        this.pqDesc = [];
        break;
      case 'set':
        this.setItems = new Set();
        break;
      case 'map':
        this.mapItems = new Map();
        break;
    }
  }

  reset(): void {
    this.deque?.clear();
    if (this.stackItems) this.stackItems.length = 0;
    if (this.pqDesc) this.pqDesc.length = 0;
    this.setItems?.clear();
    this.mapItems?.clear();
  }

  applyForward(op: ContainerOp): void {
    switch (op.type) {
      case 'push':
        if (this.deque) this.deque.pushBack(op.entry);
        else if (this.stackItems) this.stackItems.push(op.entry);
        else if (this.pqDesc) this.insertPqDesc(op.entry);
        break;
      case 'pop':
        if (this.deque) this.deque.popFront();
        else if (this.stackItems) this.stackItems.pop();
        else if (this.pqDesc) this.pqDesc.pop();
        break;
      case 'set-add':
        if (op.mutated) this.setItems?.add(op.value);
        break;
      case 'set-delete':
        if (op.mutated) this.setItems?.delete(op.value);
        break;
      case 'set-clear':
        this.setItems?.clear();
        break;
      case 'map-set':
        this.mapItems?.set(op.key, op.value);
        break;
      case 'map-delete':
        if (op.mutated) this.mapItems?.delete(op.key);
        break;
      case 'map-clear':
        this.mapItems?.clear();
        break;
    }
  }

  applyBackward(op: ContainerOp): void {
    switch (op.type) {
      case 'push':
        if (this.deque) this.deque.popBack();
        else if (this.stackItems) this.stackItems.pop();
        else if (this.pqDesc) this.removePqEntry(op.entry);
        break;
      case 'pop':
        if (this.deque) this.deque.pushFront(op.entry);
        else if (this.stackItems) this.stackItems.push(op.entry);
        else if (this.pqDesc) this.insertPqDesc(op.entry);
        break;
      case 'set-add':
        if (op.mutated) this.setItems?.delete(op.value);
        break;
      case 'set-delete':
        if (op.mutated) this.setItems?.add(op.value);
        break;
      case 'set-clear':
        if (this.setItems) {
          for (const v of op.prevValues) {
            this.setItems.add(v);
          }
        }
        break;
      case 'map-set':
        if (op.hadPrev) this.mapItems?.set(op.key, op.prevValue);
        else this.mapItems?.delete(op.key);
        break;
      case 'map-delete':
        if (op.mutated) this.mapItems?.set(op.key, op.prevValue);
        break;
      case 'map-clear':
        if (this.mapItems) {
          for (const [k, v] of op.prevEntries) {
            this.mapItems.set(k, v);
          }
        }
        break;
    }
  }

  snapshot(limit: number): ContainerState {
    if (this.deque) {
      return {
        info: this.info,
        entries: this.deque.snapshot(limit),
        size: this.deque.size,
      };
    }

    if (this.stackItems) {
      const n = Math.min(this.stackItems.length, limit);
      const entries: ContainerEntry[] = new Array(n);
      for (let i = 0; i < n; i += 1) {
        entries[i] = this.stackItems[this.stackItems.length - 1 - i]!;
      }
      return { info: this.info, entries, size: this.stackItems.length };
    }

    if (this.pqDesc) {
      const n = Math.min(this.pqDesc.length, limit);
      const entries: ContainerEntry[] = new Array(n);
      for (let i = 0; i < n; i += 1) {
        entries[i] = this.pqDesc[this.pqDesc.length - 1 - i]!;
      }
      return { info: this.info, entries, size: this.pqDesc.length };
    }

    if (this.mapItems) {
      const size = this.mapItems.size;
      const entries: ContainerEntry[] = [];
      for (const [k, v] of this.mapItems) {
        entries.push({ value: k, mapValue: v });
        if (entries.length >= limit) break;
      }
      return { info: this.info, entries, size };
    }

    const size = this.setItems?.size ?? 0;
    const entries: ContainerEntry[] = [];
    if (this.setItems) {
      for (const v of this.setItems) {
        entries.push({ value: v });
        if (entries.length >= limit) break;
      }
    }
    return { info: this.info, entries, size };
  }

  private insertPqDesc(entry: ContainerEntry): void {
    const arr = this.pqDesc!;
    const p = entry.priority ?? 0;
    const seq = entry.seq ?? 0;

    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = arr[mid]!;
      const mp = m.priority ?? 0;
      const mseq = m.seq ?? 0;
      if (mp > p || (mp === p && mseq > seq)) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    arr.splice(lo, 0, entry);
  }

  private removePqEntry(entry: ContainerEntry): void {
    const arr = this.pqDesc!;
    const targetSeq = entry.seq;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (arr[i]!.seq === targetSeq) {
        arr.splice(i, 1);
        return;
      }
    }
  }
}

/**
 * Stateful cursor over a recorded Trace for instant forward/backward scrubbing
 * of node states, parent tree pointers, active edges, and live containers.
 */
export class TracePlayer {
  readonly trace: Trace;
  readonly states: Uint8Array;
  readonly parents: Int32Array;
  currentNode: NodeId = -1;
  activeEdgeFrom: NodeId = -1;
  activeEdgeTo: NodeId = -1;
  private readonly shadows: ShadowContainer[];
  private readonly flags = new Map<string, FlagValue>();
  private _cursor = 0;

  constructor(trace: Trace) {
    this.trace = trace;
    this.states = new Uint8Array(trace.initial);
    this.parents = new Int32Array(trace.initial.length).fill(-1);
    this.shadows = trace.containers.map((info) => new ShadowContainer(info));
  }

  get cursor(): number {
    return this._cursor;
  }

  get length(): number {
    return this.trace.length;
  }

  get isAtEnd(): boolean {
    return this._cursor >= this.trace.length;
  }

  get lastStep(): TraceStep | null {
    return this._cursor > 0 ? (this.trace.steps[this._cursor - 1] ?? null) : null;
  }

  getContainers(limit = 28): ContainerState[] {
    return this.shadows.map((s) => s.snapshot(limit));
  }

  getFlags(): FlagEntry[] {
    const out: FlagEntry[] = [];
    for (const [name, value] of this.flags) {
      out.push({ name, value });
    }
    return out;
  }

  stepForward(count = 1): boolean {
    const target = Math.min(this.trace.length, this._cursor + count);
    if (target === this._cursor) return false;
    this.seek(target);
    return true;
  }

  stepBackward(count = 1): boolean {
    const target = Math.max(0, this._cursor - count);
    if (target === this._cursor) return false;
    this.seek(target);
    return true;
  }

  seek(target: number): void {
    const clamped = Math.max(0, Math.min(this.trace.length, target | 0));
    const steps = this.trace.steps;

    while (this._cursor < clamped) {
      const step = steps[this._cursor]!;
      for (const delta of step.stateDeltas) {
        this.states[delta.node] = delta.next;
      }
      for (const pd of step.parentDeltas) {
        this.parents[pd.node] = pd.nextParent;
      }
      for (const fd of step.flagDeltas) {
        if (fd.hasNext) {
          this.flags.set(fd.name, fd.nextValue!);
        } else {
          this.flags.delete(fd.name);
        }
      }
      this.currentNode = step.nextCurrent;
      this.activeEdgeFrom = step.nextEdgeFrom;
      this.activeEdgeTo = step.nextEdgeTo;
      for (const op of step.containerOps) {
        this.shadows[op.containerId]?.applyForward(op);
      }
      this._cursor += 1;
    }

    while (this._cursor > clamped) {
      this._cursor -= 1;
      const step = steps[this._cursor]!;
      for (let i = step.stateDeltas.length - 1; i >= 0; i -= 1) {
        const delta = step.stateDeltas[i]!;
        this.states[delta.node] = delta.prev;
      }
      for (let i = step.parentDeltas.length - 1; i >= 0; i -= 1) {
        const pd = step.parentDeltas[i]!;
        this.parents[pd.node] = pd.prevParent;
      }
      for (let i = 0; i < step.flagDeltas.length; i += 1) {
        const fd = step.flagDeltas[i]!;
        if (fd.hadPrev) {
          this.flags.set(fd.name, fd.prevValue!);
        } else {
          this.flags.delete(fd.name);
        }
      }
      this.currentNode = step.prevCurrent;
      this.activeEdgeFrom = step.prevEdgeFrom;
      this.activeEdgeTo = step.prevEdgeTo;
      for (let i = step.containerOps.length - 1; i >= 0; i -= 1) {
        const op = step.containerOps[i]!;
        this.shadows[op.containerId]?.applyBackward(op);
      }
    }
  }

  reset(): void {
    this.states.set(this.trace.initial);
    this.parents.fill(-1);
    this.currentNode = -1;
    this.activeEdgeFrom = -1;
    this.activeEdgeTo = -1;
    this.flags.clear();
    for (const shadow of this.shadows) {
      shadow.reset();
    }
    this._cursor = 0;
  }
}

export interface VisualFilterOptions {
  readonly includeParents?: boolean;
  readonly includeActiveEdge?: boolean;
}

/** Returns true if applying `step` changes anything visually on the canvas. */
export function stepHasVisualChange(
  step: TraceStep,
  options: VisualFilterOptions = {},
): boolean {
  return (
    step.stateDeltas.length > 0 ||
    step.prevCurrent !== step.nextCurrent ||
    (Boolean(options.includeParents) &&
      step.parentDeltas.some((pd) => pd.prevParent !== pd.nextParent)) ||
    (Boolean(options.includeActiveEdge) &&
      (step.prevEdgeFrom !== step.nextEdgeFrom ||
        step.prevEdgeTo !== step.nextEdgeTo))
  );
}

function mergeTraceSteps(
  group: readonly TraceStep[],
  linesFrom: TraceStep,
): TraceStep {
  if (group.length === 1) return group[0]!;
  const first = group[0]!;
  const last = group[group.length - 1]!;
  const flagMap = new Map<string, FlagDelta>();

  for (const s of group) {
    for (const fd of s.flagDeltas) {
      const prev = flagMap.get(fd.name);
      flagMap.set(
        fd.name,
        prev ? { ...fd, hadPrev: prev.hadPrev, prevValue: prev.prevValue } : fd,
      );
    }
  }

  const flagDeltas = Array.from(flagMap.values()).filter(
    (fd) =>
      (fd.hadPrev || fd.hasNext) &&
      !(fd.hadPrev && fd.hasNext && Object.is(fd.prevValue, fd.nextValue)),
  );

  let lines = linesFrom.lines;
  for (let i = group.length - 1; lines.length === 0 && i >= 0; i -= 1) {
    lines = group[i]!.lines;
  }

  return {
    stateDeltas: group.flatMap((s) => s.stateDeltas),
    parentDeltas: group.flatMap((s) => s.parentDeltas),
    flagDeltas,
    prevCurrent: first.prevCurrent,
    nextCurrent: last.nextCurrent,
    prevEdgeFrom: first.prevEdgeFrom,
    prevEdgeTo: first.prevEdgeTo,
    nextEdgeFrom: last.nextEdgeFrom,
    nextEdgeTo: last.nextEdgeTo,
    containerOps: group.flatMap((s) => s.containerOps),
    lines,
  };
}

/**
 * Collapses intermediate non-visual steps into adjacent visual steps so only
 * steps with canvas visual changes are registered as replay steps.
 */
export function compactVisualTrace(
  trace: Trace,
  options: VisualFilterOptions = {},
): Trace {
  if (trace.steps.length === 0) return trace;

  const outSteps: TraceStep[] = [];
  let pending: TraceStep[] = [];

  for (const step of trace.steps) {
    pending.push(step);
    if (stepHasVisualChange(step, options)) {
      outSteps.push(mergeTraceSteps(pending, step));
      pending = [];
    }
  }

  if (pending.length > 0 && outSteps.length > 0) {
    const lastVisual = outSteps[outSteps.length - 1]!;
    outSteps[outSteps.length - 1] = mergeTraceSteps(
      [lastVisual, ...pending],
      lastVisual,
    );
  }

  return {
    initial: trace.initial,
    containers: trace.containers,
    steps: outSteps,
    length: outSteps.length,
  };
}

/**
 * Maps a cursor in a raw trace to the equivalent visual-step cursor in a
 * compacted trace so toggling preserves the current canvas state.
 */
export function rawCursorToVisualCursor(
  rawTrace: Trace,
  rawCursor: number,
  options: VisualFilterOptions = {},
): number {
  const limit = Math.max(0, Math.min(rawCursor | 0, rawTrace.steps.length));
  let visualCount = 0;
  for (let i = 0; i < limit; i += 1) {
    if (stepHasVisualChange(rawTrace.steps[i]!, options)) {
      visualCount += 1;
    }
  }
  return visualCount;
}

/**
 * Maps a visual-step cursor in a compacted trace back to the raw trace cursor
 * immediately after that visual step.
 */
export function visualCursorToRawCursor(
  rawTrace: Trace,
  visualCursor: number,
  options: VisualFilterOptions = {},
): number {
  const target = visualCursor | 0;
  if (target <= 0) return 0;
  let visualCount = 0;
  for (let i = 0; i < rawTrace.steps.length; i += 1) {
    if (stepHasVisualChange(rawTrace.steps[i]!, options)) {
      visualCount += 1;
      if (visualCount === target) {
        return i + 1;
      }
    }
  }
  return rawTrace.steps.length;
}
