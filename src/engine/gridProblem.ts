import { NodeState, type Edge, type NodeId, type Point2D, type SearchProblem } from './types';

export interface Grid2DOptions {
  readonly cols: number;
  readonly rows: number;
  readonly start: Point2D;
  readonly goal: Point2D;
  readonly walls?: Uint8Array;
  readonly weights?: Float32Array;
  readonly allowDiagonal?: boolean;
}

const CARDINAL_DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

const DIAGONAL_DIRS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
] as const;

export class Grid2DProblem implements SearchProblem {
  readonly kind = 'grid' as const;
  readonly cols: number;
  readonly rows: number;
  readonly nodeCount: number;
  readonly start: NodeId;
  readonly goal: NodeId;
  readonly walls: Uint8Array;
  readonly weights: Float32Array | null;
  readonly allowDiagonal: boolean;

  constructor(options: Grid2DOptions) {
    this.cols = options.cols;
    this.rows = options.rows;
    this.nodeCount = options.cols * options.rows;
    this.start = this.toId(options.start.x, options.start.y);
    this.goal = this.toId(options.goal.x, options.goal.y);
    this.walls = options.walls ? new Uint8Array(options.walls) : new Uint8Array(this.nodeCount);
    this.weights = options.weights ? new Float32Array(options.weights) : null;
    this.allowDiagonal = options.allowDiagonal ?? false;

    // Ensure start and goal cells are always traversable.
    this.walls[this.start] = 0;
    this.walls[this.goal] = 0;
  }

  toId(x: number, y: number): NodeId {
    return y * this.cols + x;
  }

  weightAt(node: NodeId): number {
    if (!this.weights) return 1;
    const w = this.weights[node];
    return w !== undefined && w > 0 ? w : 1;
  }

  isGoal(node: NodeId): boolean {
    return node === this.goal;
  }

  neighbors(node: NodeId): readonly Edge[] {
    const x = node % this.cols;
    const y = (node - x) / this.cols;
    const dirs = this.allowDiagonal ? DIAGONAL_DIRS : CARDINAL_DIRS;
    const result: Edge[] = [];

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) continue;
      const nid = ny * this.cols + nx;
      if (this.walls[nid] === 1) continue;
      const stepScale = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const cellWeight = this.weightAt(nid);
      result.push({ node: nid, cost: stepScale * cellWeight });
    }

    return result;
  }

  heuristic(node: NodeId, target: NodeId = this.goal): number {
    const x1 = node % this.cols;
    const y1 = (node - x1) / this.cols;
    const x2 = target % this.cols;
    const y2 = (target - x2) / this.cols;
    const dx = Math.abs(x1 - x2);
    const dy = Math.abs(y1 - y2);
    if (!this.allowDiagonal) return dx + dy;
    // Octile distance for 8-connected grids.
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  position(node: NodeId): Point2D | null {
    if (node < 0 || node >= this.nodeCount) return null;
    const x = node % this.cols;
    const y = (node - x) / this.cols;
    return { x, y };
  }

  initialStates(): Uint8Array {
    const states = new Uint8Array(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i += 1) {
      states[i] = this.walls[i] === 1 ? NodeState.Wall : NodeState.Unvisited;
    }
    states[this.start] = NodeState.Start;
    states[this.goal] = NodeState.Goal;
    return states;
  }
}
