import { describe, expect, it } from 'vitest';
import { search as astarSearch } from '../algorithms/informed/astar';
import { search as bfsSearch } from '../algorithms/uninformed/bfs';
import { evaluateCompatibility } from '../engine/compatibility';
import {
  clampRandomNodeCount,
  gridDimensionsForNodeCount,
  MAX_RANDOM_GRAPH_NODES,
  MAX_RANDOM_GRID_NODES,
  MIN_RANDOM_GRAPH_NODES,
  MIN_RANDOM_GRID_NODES,
  minEdgeEdgeClearanceForCount,
  minNodeEdgeClearanceForCount,
  pointToSegmentDistance,
  randomizeGraph,
  randomizeGrid,
  segmentsIntersect,
  segmentToSegmentDistance,
} from '../engine/randomize';
import { getAlgorithm } from '../engine/registry';
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

    const prime = gridDimensionsForNodeCount(101);
    expect(prime.cols).toBeGreaterThanOrEqual(2);
    expect(prime.rows).toBeGreaterThanOrEqual(2);
    expect(Math.abs(prime.cols * prime.rows - 101)).toBeLessThanOrEqual(5);
  });

  it('generates solvable randomized grids respecting each grid preset theme', () => {
    // open-field: zero walls, unit weights
    const open = randomizeGrid({
      nodeCount: 150,
      presetId: 'open-field',
      rng: makeSeededRng(11),
    });
    expect(open.nodeCount).toBe(150);
    expect(open.walls.every((w) => w === 0)).toBe(true);
    for (let i = 0; i < open.nodeCount; i += 1) {
      expect(open.weightAt(i)).toBe(1);
    }

    // concave-trap: has walls, unit weights, solvable
    const trap = randomizeGrid({
      nodeCount: 300,
      presetId: 'concave-trap',
      rng: makeSeededRng(22),
    });
    expect(trap.walls.some((w) => w === 1)).toBe(true);
    for (let i = 0; i < trap.nodeCount; i += 1) {
      expect(trap.weightAt(i)).toBe(1);
    }
    expect(runAlgorithm(astarSearch, trap).path).not.toBeNull();

    // weighted-swamp: has weighted terrain > 1, solvable
    const swamp = randomizeGrid({
      nodeCount: 200,
      presetId: 'weighted-swamp',
      rng: makeSeededRng(33),
    });
    let hasHeavyCell = false;
    for (let i = 0; i < swamp.nodeCount; i += 1) {
      if (swamp.weightAt(i) > 1) {
        hasHeavyCell = true;
        break;
      }
    }
    expect(hasHeavyCell).toBe(true);
    expect(runAlgorithm(astarSearch, swamp).path).not.toBeNull();

    // random-maze: has maze walls, unit weights, solvable
    const maze = randomizeGrid({
      nodeCount: 240,
      presetId: 'random-maze',
      rng: makeSeededRng(44),
    });
    expect(maze.walls.some((w) => w === 1)).toBe(true);
    for (let i = 0; i < maze.nodeCount; i += 1) {
      expect(maze.weightAt(i)).toBe(1);
    }
    expect(runAlgorithm(bfsSearch, maze).path).not.toBeNull();
  });

  it('respects core themes of all graph presets (blank, negative-edge, heuristic-trap, unweighted, directed)', () => {
    // blank-graph: specified nodeCount with zero edges
    const blank = randomizeGraph({
      nodeCount: 14,
      presetId: 'blank-graph',
      directed: false,
      weighted: true,
      rng: makeSeededRng(5),
    });
    expect(blank.nodeCount).toBe(14);
    for (let u = 0; u < blank.nodeCount; u += 1) {
      expect(blank.neighbors(u)).toHaveLength(0);
    }

    // negative-edge-graph: has negative edge weight(s), no negative cycle, reachable Goal
    const neg = randomizeGraph({
      nodeCount: 12,
      presetId: 'negative-edge-graph',
      directed: true,
      weighted: true,
      rng: makeSeededRng(17),
    });
    expect(neg.directed).toBe(true);
    let hasNegativeEdge = false;
    for (let u = 0; u < neg.nodeCount; u += 1) {
      for (const e of neg.neighbors(u)) {
        if (e.cost < 0) hasNegativeEdge = true;
      }
    }
    expect(hasNegativeEdge).toBe(true);
    const negReport = evaluateCompatibility(getAlgorithm('astar'), neg, null);
    expect(negReport.optimalStatus).toBe('ok');
    expect(negReport.warnings.some((w) => w.code === 'negative-weights')).toBe(true);
    expect(negReport.warnings.some((w) => w.code === 'negative-cycle')).toBe(false);

    // heuristic-trap-graph: triggers inadmissible-heuristic warning via express edge < Euclidean dist
    const trap = randomizeGraph({
      nodeCount: 10,
      presetId: 'heuristic-trap-graph',
      directed: false,
      weighted: true,
      rng: makeSeededRng(29),
    });
    const trapReport = evaluateCompatibility(getAlgorithm('astar'), trap, null);
    expect(trapReport.optimalStatus).toBe('ok');
    expect(trapReport.warnings.some((w) => w.code === 'inadmissible-heuristic')).toBe(true);

    // sample-graph & unweighted-graph: connected and clean
    const weightedNet = randomizeGraph({
      nodeCount: 16,
      presetId: 'sample-graph',
      directed: false,
      weighted: true,
      rng: makeSeededRng(41),
    });
    expect(runAlgorithm(astarSearch, weightedNet).path).not.toBeNull();
    expect(
      evaluateCompatibility(getAlgorithm('astar'), weightedNet, null).warnings.some(
        (w) => w.code === 'inadmissible-heuristic',
      ),
    ).toBe(false);

    const unweightedNet = randomizeGraph({
      nodeCount: 16,
      presetId: 'unweighted-graph',
      directed: false,
      weighted: false,
      rng: makeSeededRng(53),
    });
    for (let u = 0; u < unweightedNet.nodeCount; u += 1) {
      for (const e of unweightedNet.neighbors(u)) {
        expect(e.cost).toBe(1);
      }
    }
    expect(runAlgorithm(bfsSearch, unweightedNet).path).not.toBeNull();
  });

  it('keeps non-endpoint nodes clear of edges and prevents overlapping or crossing edges', () => {
    for (const presetId of ['sample-graph', 'directed-graph', 'negative-edge-graph'] as const) {
      for (const count of [6, 12, 24]) {
        const directed = presetId !== 'sample-graph';
        for (let seedOffset = 0; seedOffset < 5; seedOffset += 1) {
          const graph = randomizeGraph({
            nodeCount: count,
            presetId,
            directed,
            weighted: true,
            rng: makeSeededRng(700 + count * 10 + seedOffset),
          });
          const minNodeClr = minNodeEdgeClearanceForCount(count);
          const minEdgeClr = minEdgeEdgeClearanceForCount(count);
          const positions = graph.positions!;

          const edges: [number, number][] = [];
          for (let u = 0; u < graph.nodeCount; u += 1) {
            for (const e of graph.neighbors(u)) {
              if (!directed && u > e.node) continue;
              edges.push([u, e.node]);
            }
          }

          for (let i = 0; i < edges.length; i += 1) {
            const [u, v] = edges[i]!;
            const pu = positions[u]!;
            const pv = positions[v]!;

            for (let w = 0; w < graph.nodeCount; w += 1) {
              if (w === u || w === v) continue;
              expect(pointToSegmentDistance(positions[w]!, pu, pv)).toBeGreaterThanOrEqual(
                minNodeClr * 0.5 - 1e-6,
              );
            }

            for (let j = i + 1; j < edges.length; j += 1) {
              const [x, y] = edges[j]!;
              const px = positions[x]!;
              const py = positions[y]!;

              if (u === x || u === y || v === x || v === y) {
                // Incident edges: must not share both endpoints or lie at a near-zero angle.
                const shared = u === x || u === y ? u : v;
                const other1 = shared === u ? v : u;
                const other2 = shared === x ? y : x;
                expect(other1).not.toBe(other2);
                const ps = positions[shared]!;
                const p1 = positions[other1]!;
                const p2 = positions[other2]!;
                const v1x = p1.x - ps.x;
                const v1y = p1.y - ps.y;
                const v2x = p2.x - ps.x;
                const v2y = p2.y - ps.y;
                const cos =
                  (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
                expect(cos).toBeLessThanOrEqual(0.96 + 1e-6);
              } else {
                // Non-incident edges: must neither intersect nor run too close together.
                expect(segmentsIntersect(pu, pv, px, py)).toBe(false);
                expect(segmentToSegmentDistance(pu, pv, px, py)).toBeGreaterThanOrEqual(
                  minEdgeClr * 0.5 - 1e-6,
                );
              }
            }
          }
        }
      }
    }
  });
});
