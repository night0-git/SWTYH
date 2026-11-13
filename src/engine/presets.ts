import { AdjacencyGraphProblem } from './graphProblem';
import { Grid2DProblem } from './gridProblem';
import type { Edge, Point2D, SearchProblem } from './types';

export type PresetId =
  | 'concave-trap'
  | 'weighted-swamp'
  | 'open-field'
  | 'random-maze'
  | 'sample-graph'
  | 'unweighted-graph'
  | 'directed-graph'
  | 'heuristic-trap-graph'
  | 'negative-edge-graph'
  | 'blank-graph';

export interface PresetDescriptor {
  readonly id: PresetId;
  readonly label: string;
}

export const PRESETS: readonly PresetDescriptor[] = [
  { id: 'concave-trap', label: 'Grid · Concave Barrier' },
  { id: 'weighted-swamp', label: 'Grid · Weighted Swamp' },
  { id: 'open-field', label: 'Grid · Open Field' },
  { id: 'random-maze', label: 'Grid · Generated Maze' },
  { id: 'sample-graph', label: 'Graph · Weighted Network' },
  { id: 'unweighted-graph', label: 'Graph · Unweighted Network' },
  { id: 'directed-graph', label: 'Graph · Directed One-Way' },
  { id: 'heuristic-trap-graph', label: 'Graph · Heuristic Trap' },
  { id: 'negative-edge-graph', label: 'Graph · Negative Edge' },
  { id: 'blank-graph', label: 'Graph · Blank Canvas' },
];

const GRID_COLS = 35;
const GRID_ROWS = 21;

function makeWeights(cols: number, rows: number): Float32Array {
  const weights = new Float32Array(cols * rows);
  weights.fill(1);
  return weights;
}

function createConcaveTrap(allowDiagonal: boolean): Grid2DProblem {
  const walls = new Uint8Array(GRID_COLS * GRID_ROWS);
  // U-shaped wall opening away from Goal to highlight uninformed flood vs heuristic wrap.
  for (let r = 4; r <= 16; r += 1) {
    walls[r * GRID_COLS + 19] = 1;
  }
  for (let c = 11; c <= 19; c += 1) {
    walls[4 * GRID_COLS + c] = 1;
    walls[16 * GRID_COLS + c] = 1;
  }
  return new Grid2DProblem({
    cols: GRID_COLS,
    rows: GRID_ROWS,
    start: { x: 6, y: 10 },
    goal: { x: 28, y: 10 },
    walls,
    weights: makeWeights(GRID_COLS, GRID_ROWS),
    allowDiagonal,
  });
}

function createWeightedSwamp(allowDiagonal: boolean): Grid2DProblem {
  const walls = new Uint8Array(GRID_COLS * GRID_ROWS);
  const weights = makeWeights(GRID_COLS, GRID_ROWS);

  // High-cost central region (5x cost) with small barrier pillars.
  for (let r = 4; r <= 16; r += 1) {
    for (let c = 12; c <= 22; c += 1) {
      weights[r * GRID_COLS + c] = 5;
    }
  }
  for (let r = 0; r < 3; r += 1) {
    walls[r * GRID_COLS + 17] = 1;
  }

  return new Grid2DProblem({
    cols: GRID_COLS,
    rows: GRID_ROWS,
    start: { x: 5, y: 10 },
    goal: { x: 29, y: 10 },
    walls,
    weights,
    allowDiagonal,
  });
}

function createOpenField(allowDiagonal: boolean): Grid2DProblem {
  return new Grid2DProblem({
    cols: GRID_COLS,
    rows: GRID_ROWS,
    start: { x: 5, y: 10 },
    goal: { x: 29, y: 10 },
    weights: makeWeights(GRID_COLS, GRID_ROWS),
    allowDiagonal,
  });
}

function createMaze(allowDiagonal: boolean): Grid2DProblem {
  const cols = GRID_COLS;
  const rows = GRID_ROWS;
  const walls = new Uint8Array(cols * rows);
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

    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    walls[pick[3] * cols + pick[2]] = 0;
    walls[pick[1] * cols + pick[0]] = 0;
    stack.push([pick[0], pick[1]]);
  }

  // Open a couple of extra loops so heuristic vs uninformed paths can diverge.
  for (let i = 0; i < 18; i += 1) {
    const rx = 1 + Math.floor(Math.random() * (cols - 2));
    const ry = 1 + Math.floor(Math.random() * (rows - 2));
    walls[ry * cols + rx] = 0;
  }

  return new Grid2DProblem({
    cols,
    rows,
    start: { x: 1, y: 1 },
    goal: { x: cols - 2, y: rows - 2 },
    walls,
    weights: makeWeights(cols, GRID_ROWS),
    allowDiagonal,
  });
}

function createSampleGraph(weighted = true): AdjacencyGraphProblem {
  const positions: Point2D[] = [
    { x: 8, y: 50 },   // 0: Start
    { x: 26, y: 20 },  // 1
    { x: 28, y: 52 },  // 2
    { x: 26, y: 82 },  // 3
    { x: 52, y: 50 },  // 4: High-cost direct bridge
    { x: 50, y: 16 },  // 5
    { x: 52, y: 84 },  // 6
    { x: 74, y: 24 },  // 7
    { x: 74, y: 76 },  // 8
    { x: 92, y: 50 },  // 9: Goal
  ];

  const adjacency: Edge[][] = Array.from({ length: positions.length }, () => []);
  const connect = (u: number, v: number, cost: number) => {
    adjacency[u]!.push({ node: v, cost });
    adjacency[v]!.push({ node: u, cost });
  };

  connect(0, 1, 36);
  connect(0, 2, 22);
  connect(0, 3, 38);
  connect(1, 5, 25);
  connect(2, 4, 48); // Expensive direct corridor
  connect(2, 1, 34);
  connect(2, 3, 32);
  connect(3, 6, 28);
  connect(4, 9, 55); // Expensive direct corridor
  connect(4, 7, 36);
  connect(5, 7, 26);
  connect(6, 8, 25);
  connect(7, 9, 32);
  connect(8, 9, 33);

  return new AdjacencyGraphProblem({
    nodeCount: positions.length,
    start: 0,
    goal: 9,
    adjacency,
    positions,
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    directed: false,
    weighted,
  });
}

function createDirectedGraph(): AdjacencyGraphProblem {
  const positions: Point2D[] = [
    { x: 10, y: 50 },  // 0: Start
    { x: 34, y: 22 },  // 1
    { x: 34, y: 78 },  // 2
    { x: 58, y: 22 },  // 3
    { x: 58, y: 78 },  // 4
    { x: 88, y: 50 },  // 5: Goal
  ];

  const adjacency: Edge[][] = Array.from({ length: positions.length }, () => []);
  const link = (u: number, v: number, cost: number) => {
    adjacency[u]!.push({ node: v, cost });
  };

  // Bidirectional branch between 1 & 2, one-way dead-end / shortcut toward Goal.
  link(0, 1, 36);
  link(0, 2, 36);
  link(1, 2, 56);
  link(2, 1, 56);
  link(1, 3, 24);
  link(3, 2, 62); // Cycle back down; 3 has no direct edge to Goal
  link(2, 4, 24);
  link(4, 5, 42);
  link(3, 5, 42);

  // Redirect 3 -> 5 cost vs cycle: make 1 -> 3 a one-way dead end back to 0/2,
  // while only 4 leads into Goal cleanly from lower corridor unless detouring via 3->4.
  adjacency[3] = [
    { node: 2, cost: 60 },
    { node: 4, cost: 58 },
  ];

  return new AdjacencyGraphProblem({
    nodeCount: positions.length,
    start: 0,
    goal: 5,
    adjacency,
    positions,
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    directed: true,
    weighted: true,
  });
}

function createHeuristicTrapGraph(): AdjacencyGraphProblem {
  const positions: Point2D[] = [
    { x: 10, y: 50 }, // 0: Start
    { x: 55, y: 50 }, // 1: Appealing middle node
    { x: 35, y: 15 }, // 2: Upper detour
    { x: 75, y: 15 }, // 3: Fast express shortcut to Goal (cost < Euclidean)
    { x: 90, y: 50 }, // 4: Goal
  ];

  const adjacency: Edge[][] = Array.from({ length: positions.length }, () => []);
  const connect = (u: number, v: number, cost: number) => {
    adjacency[u]!.push({ node: v, cost });
    adjacency[v]!.push({ node: u, cost });
  };

  connect(0, 1, 46);
  connect(1, 4, 48); // Direct cost = 94
  connect(0, 2, 30);
  connect(2, 3, 30);
  connect(3, 4, 12); // Express cost = 72, though Euclidean h(3) = 38 overestimates it

  return new AdjacencyGraphProblem({
    nodeCount: positions.length,
    start: 0,
    goal: 4,
    adjacency,
    positions,
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    directed: false,
    weighted: true,
  });
}

function createNegativeEdgeGraph(): AdjacencyGraphProblem {
  const positions: Point2D[] = [
    { x: 10, y: 50 }, // 0: Start
    { x: 42, y: 22 }, // 1
    { x: 42, y: 78 }, // 2
    { x: 68, y: 36 }, // 3
    { x: 90, y: 50 }, // 4: Goal
  ];

  const adjacency: Edge[][] = Array.from({ length: positions.length }, () => []);
  const link = (u: number, v: number, cost: number) => {
    adjacency[u]!.push({ node: v, cost });
  };

  link(0, 1, 20);
  link(0, 2, 35);
  link(2, 1, -25); // Negative weight lowers true cost to node 1 from 20 -> 10
  link(1, 3, 25);
  link(3, 4, 15);
  link(2, 4, 45);

  return new AdjacencyGraphProblem({
    nodeCount: positions.length,
    start: 0,
    goal: 4,
    adjacency,
    positions,
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    directed: true,
    weighted: true,
  });
}

function createBlankGraph(): AdjacencyGraphProblem {
  return new AdjacencyGraphProblem({
    nodeCount: 2,
    start: 0,
    goal: 1,
    adjacency: [[], []],
    positions: [
      { x: 20, y: 50 },
      { x: 80, y: 50 },
    ],
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    directed: false,
    weighted: true,
  });
}

export function buildPreset(id: PresetId, allowDiagonal: boolean): SearchProblem {
  switch (id) {
    case 'concave-trap':
      return createConcaveTrap(allowDiagonal);
    case 'weighted-swamp':
      return createWeightedSwamp(allowDiagonal);
    case 'open-field':
      return createOpenField(allowDiagonal);
    case 'random-maze':
      return createMaze(allowDiagonal);
    case 'sample-graph':
      return createSampleGraph(true);
    case 'unweighted-graph':
      return createSampleGraph(false);
    case 'directed-graph':
      return createDirectedGraph();
    case 'heuristic-trap-graph':
      return createHeuristicTrapGraph();
    case 'negative-edge-graph':
      return createNegativeEdgeGraph();
    case 'blank-graph':
      return createBlankGraph();
  }
}
