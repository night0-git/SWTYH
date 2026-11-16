import { describe, expect, it } from 'vitest';
import { search as astarSearch } from '../algorithms/informed/astar';
import { search as bfsSearch } from '../algorithms/uninformed/bfs';
import {
  clampRandomNodeCount,
  gridDimensionsForNodeCount,
  MAX_RANDOM_GRAPH_NODES,
  MAX_RANDOM_GRID_NODES,
  MIN_RANDOM_GRAPH_NODES,
  MIN_RANDOM_GRID_NODES,
  randomizeGraph,
  randomizeGrid,
} from '../engine/randomize';
import { runAlgorithm } from '../engine/runner';

function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe('randomize helpers', () => {
  it('clamps requested node counts for grid and graph safely', () => {
    expect(clampRandomNodeCount('grid', 0)).toBe(MIN_RANDOM_GRID_NODES);
    expect(clampRandomNodeCount('grid', 99999)).toBe(MAX_RANDOM_GRID_NODES);
    expect(clampRandomNodeCount('grid', Number.NaN, 120)).toBe(120);

    expect(clampRandomNodeCount('graph', -5)).toBe(MIN_RANDOM_GRAPH_NODES);
    expect(clampRandomNodeCount('graph', 99999)).toBe(MAX_RANDOM_GRAPH_NODES);
    expect(clampRandomNodeCount('graph', Number.NaN, 14)).toBe(14);
  });

  it('derives balanced grid dimensions matching exact node counts when factorable', () => {
    expect(gridDimensionsForNodeCount(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridDimensionsForNodeCount(3)).toEqual({ cols: 3, rows: 1 });
    expect(gridDimensionsForNodeCount(100)).toEqual({ cols: 10, rows: 10 });
    expect(gridDimensionsForNodeCount(200)).toEqual({ cols: 20, rows: 10 });
    expect(gridDimensionsForNodeCount(735)).toEqual({ cols: 35, rows: 21 });

    // Prime counts choose closest balanced rectangle.
    const prime = gridDimensionsForNodeCount(101);
    expect(prime.cols).toBeGreaterThanOrEqual(2);
    expect(prime.rows).toBeGreaterThanOrEqual(2);
    expect(Math.abs(prime.cols * prime.rows - 101)).toBeLessThanOrEqual(5);
  });

  it('generates solvable randomized grids across sizes and diagonal modes', () => {
    for (const [count, diag] of [
      [2, false],
      [12, false],
      [100, true],
      [300, false],
    ] as const) {
      const grid = randomizeGrid({
        nodeCount: count,
        allowDiagonal: diag,
        rng: makeSeededRng(42 + count),
      });

      expect(grid.nodeCount).toBe(count);
      expect(grid.allowDiagonal).toBe(diag);
      expect(grid.start).not.toBe(grid.goal);
      expect(grid.walls[grid.start]).toBe(0);
      expect(grid.walls[grid.goal]).toBe(0);

      const res = runAlgorithm(astarSearch, grid);
      expect(res.error).toBeNull();
      expect(res.path).not.toBeNull();
      expect(res.path![0]).toBe(grid.start);
      expect(res.path![res.path!.length - 1]).toBe(grid.goal);
    }
  });

  it('generates connected randomized graphs respecting nodeCount, directed, and weighted flags', () => {
    for (const directed of [false, true]) {
      for (const weighted of [false, true]) {
        for (const count of [2, 5, 16, 45]) {
          const graph = randomizeGraph({
            nodeCount: count,
            directed,
            weighted,
            rng: makeSeededRng(100 + count + (directed ? 10 : 0)),
          });

          expect(graph.nodeCount).toBe(count);
          expect(graph.directed).toBe(directed);
          expect(graph.weighted).toBe(weighted);
          expect(graph.start).toBe(0);
          expect(graph.goal).toBe(count - 1);
          expect(graph.positions?.length).toBe(count);

          // Every vertex has valid finite positions and admissible raw weights.
          for (let u = 0; u < graph.nodeCount; u += 1) {
            const p = graph.position(u);
            expect(p).not.toBeNull();
            expect(Number.isFinite(p!.x)).toBe(true);
            expect(Number.isFinite(p!.y)).toBe(true);
            for (const edge of graph.neighbors(u)) {
              expect(edge.node).not.toBe(u);
              if (weighted) {
                expect(edge.cost).toBeGreaterThanOrEqual(graph.heuristic(u, edge.node) - 1e-6);
              } else {
                expect(edge.cost).toBe(1);
              }
            }
          }

          // Goal is reachable from Start for BFS and A*.
          const bfsRes = runAlgorithm(bfsSearch, graph);
          expect(bfsRes.error).toBeNull();
          expect(bfsRes.path).not.toBeNull();

          const astarRes = runAlgorithm(astarSearch, graph);
          expect(astarRes.error).toBeNull();
          expect(astarRes.path).not.toBeNull();
        }
      }
    }
  });
});
