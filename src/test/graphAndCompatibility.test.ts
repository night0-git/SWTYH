import { describe, expect, it } from 'vitest';
import { evaluateCompatibility } from '../engine/compatibility';
import { AdjacencyGraphProblem } from '../engine/graphProblem';
import { buildPreset } from '../engine/presets';
import { getAlgorithm } from '../engine/registry';
import { runAlgorithm } from '../engine/runner';
import type { AlgorithmEntry } from '../engine/types';

describe('AdjacencyGraphProblem customization and graph modes', () => {
  it('supports adding/removing vertices while remapping Start, Goal, and incident edges cleanly', () => {
    const base = buildPreset('blank-graph', false) as AdjacencyGraphProblem;
    expect(base.nodeCount).toBe(2);
    expect(base.start).toBe(0);
    expect(base.goal).toBe(1);

    const g1 = base
      .withAddedVertex({ x: 50, y: 20 }) // id 2
      .withAddedVertex({ x: 50, y: 80 }) // id 3
      .withAddedEdge(0, 2, 14)
      .withAddedEdge(2, 3, 25)
      .withAddedEdge(3, 1, 18);

    expect(g1.nodeCount).toBe(4);
    expect(g1.neighbors(2).map((e) => e.node)).toEqual([0, 3]);

    // Removing Start or Goal is guarded.
    expect(g1.withRemovedVertex(g1.start)).toBe(g1);
    expect(g1.withRemovedVertex(g1.goal)).toBe(g1);

    // Move Goal to 3, then remove vertex 2; old Goal (3) must remap cleanly to 2.
    const movedGoal = g1.withGoal(3);
    expect(movedGoal.goal).toBe(3);

    const removedMid = movedGoal.withRemovedVertex(2);
    expect(removedMid.nodeCount).toBe(3);
    expect(removedMid.start).toBe(0);
    expect(removedMid.goal).toBe(2); // Remapped from 3 -> 2
    expect(removedMid.neighbors(0)).toEqual([]);
    expect(removedMid.neighbors(2)).toEqual([{ node: 1, cost: 18 }]);
  });

  it('toggles directed/undirected and preserves weights across weighted/unweighted switches', () => {
    const g = new AdjacencyGraphProblem({
      nodeCount: 3,
      start: 0,
      goal: 2,
      adjacency: [
        [{ node: 1, cost: 12 }, { node: 2, cost: 40 }],
        [{ node: 0, cost: 12 }, { node: 2, cost: -5 }],
        [{ node: 0, cost: 40 }, { node: 1, cost: -5 }],
      ],
      positions: [
        { x: 10, y: 50 },
        { x: 50, y: 20 },
        { x: 90, y: 50 },
      ],
      directed: false,
      weighted: true,
    });

    // Unweighted normalizes exposed edge costs to 1 while retaining underlying weights.
    const unweighted = g.withWeighted(false);
    expect(unweighted.neighbors(1).map((e) => e.cost)).toEqual([1, 1]);
    const restored = unweighted.withWeighted(true);
    expect(restored.neighbors(1).map((e) => e.cost)).toEqual([12, -5]);

    // Switching Undirected -> Directed collapses undirected pairs into canonical u -> v edges.
    const directed = g.withDirected(true);
    expect(directed.directed).toBe(true);
    expect(directed.neighbors(0).map((e) => e.node)).toEqual([1, 2]);
    expect(directed.neighbors(2)).toEqual([]);

    // Adding opposite edge in directed mode allows asymmetric pair.
    const withReverse = directed.withAddedEdge(1, 0, 99);
    expect(withReverse.neighbors(1).some((e) => e.node === 0 && e.cost === 99)).toBe(true);

    // Editing edge weight supports negative numbers and removes edges cleanly.
    const reweighted = withReverse.withEdgeWeight(0, 1, -15);
    expect(reweighted.neighbors(0).find((e) => e.node === 1)?.cost).toBe(-15);
    const removed = reweighted.withRemovedEdge(1, 0);
    expect(removed.neighbors(1).some((e) => e.node === 0)).toBe(false);
    expect(removed.clearedEdges().neighbors(0)).toEqual([]);
  });

  it('supports renaming vertices, normalizes whitespace, and remaps labels across edits', () => {
    const base = buildPreset('blank-graph', false) as AdjacencyGraphProblem;
    expect(base.displayLabel(0)).toBe('S');
    expect(base.displayLabel(1)).toBe('G');
    expect(base.customLabel(0)).toBeNull();

    const g1 = base
      .withAddedVertex({ x: 40, y: 30 }) // 2
      .withAddedVertex({ x: 60, y: 70 }) // 3
      .withRenamedVertex(0, '  Arad  ')
      .withRenamedVertex(2, 'Sibiu\tNorth')
      .withRenamedVertex(3, 'Bucharest');

    expect(g1.customLabel(0)).toBe('Arad');
    expect(g1.displayLabel(0, true)).toBe('Arad');
    expect(g1.displayLabel(2, true)).toBe('Sibiu North');
    expect(g1.displayLabel(3)).toBe('Bucharest');

    // No-op when setting identical label or invalid index.
    expect(g1.withRenamedVertex(0, 'Arad')).toBe(g1);
    expect(g1.withRenamedVertex(99, 'X')).toBe(g1);

    // Preserved across start/goal moves, edge additions, directed/weighted toggles, and vertex addition.
    const g2 = g1
      .withAddedEdge(0, 2, 12)
      .withDirected(true)
      .withWeighted(false)
      .withStart(2)
      .withAddedVertex({ x: 80, y: 20 }); // 4
    expect(g2.displayLabel(0)).toBe('Arad');
    expect(g2.displayLabel(2)).toBe('Sibiu North');
    expect(g2.displayLabel(4)).toBe('1');
    expect(g2.displayLabel(4, true)).toBe('#1');

    // Removing vertex 0 shifts remaining custom labels cleanly.
    const g3 = g2.withRemovedVertex(0);
    expect(g3.start).toBe(1); // shifted from 2 -> 1
    expect(g3.goal).toBe(0);  // shifted from 1 -> 0
    expect(g3.displayLabel(0)).toBe('G');
    expect(g3.displayLabel(1)).toBe('Sibiu North');
    expect(g3.displayLabel(2)).toBe('Bucharest');
    expect(g3.displayLabel(3)).toBe('1');

    // Clearing custom labels reverts back to S / G / #id and nulls out labels array.
    const cleared = g3.withRenamedVertex(1, '   ').withRenamedVertex(2, '');
    expect(cleared.labels).toBeNull();
    expect(cleared.displayLabel(1)).toBe('S');
    expect(cleared.displayLabel(2, true)).toBe('#2');
  });

  it('numbers added vertices starting from 1 while ignoring S and G and avoiding collisions', () => {
    const blank = buildPreset('blank-graph', false) as AdjacencyGraphProblem;
    expect(blank.displayLabel(blank.start)).toBe('S');
    expect(blank.displayLabel(blank.goal)).toBe('G');

    const g1 = blank.withAddedVertex({ x: 30, y: 20 }); // nodeId 2 -> '1'
    const g2 = g1.withAddedVertex({ x: 50, y: 20 }); // nodeId 3 -> '2'
    const g3 = g2.withAddedVertex({ x: 70, y: 20 }); // nodeId 4 -> '3'
    expect(g3.displayLabel(2)).toBe('1');
    expect(g3.displayLabel(2, true)).toBe('#1');
    expect(g3.displayLabel(3)).toBe('2');
    expect(g3.displayLabel(4)).toBe('3');

    // Removing '2' (nodeId 3) preserves remaining default numbers and fills gap '2' next.
    const removed = g3.withRemovedVertex(3);
    expect(removed.displayLabel(2)).toBe('1');
    expect(removed.displayLabel(3)).toBe('3'); // was nodeId 4
    const refilled = removed.withAddedVertex({ x: 85, y: 20 });
    expect(refilled.displayLabel(4)).toBe('2');

    // Moving Goal onto node 3 frees old Goal (node 1), which avoids colliding with node 2 ('1')
    // and still displays 'G' on node 3 (auto-assigned default label does not block Set G/Set S).
    const movedGoal = g2.withGoal(3);
    expect(movedGoal.displayLabel(3)).toBe('G');
    expect(movedGoal.displayLabel(2)).toBe('1');
    expect(movedGoal.displayLabel(1)).toBe('2');

    // Sample Graph has S=0, G=9 and intermediate nodes 1..8, so first added vertex is '9'.
    const sample = buildPreset('sample-graph', false) as AdjacencyGraphProblem;
    const samplePlusOne = sample.withAddedVertex({ x: 95, y: 50 });
    expect(samplePlusOne.displayLabel(10)).toBe('9');
  });
});

describe('Compatibility analyzer and ground-truth optimality warnings', () => {
  it('warns when BFS runs on weighted or diagonal problems and flags suboptimal cost', () => {
    const bfs = getAlgorithm('bfs')!;
    const weightedGraph = buildPreset('sample-graph', false);

    // Pre-run warning.
    const preReport = evaluateCompatibility(bfs, weightedGraph, null);
    expect(preReport.warnings.map((w) => w.code)).toContain('ignores-weights');
    expect(preReport.optimalStatus).toBe('ok');
    expect(preReport.optimalCost).toBe(119);

    // Post-run comparison: BFS takes 2-hop expensive bridge (22 + 48 + 55 = 125 vs 103).
    const run = runAlgorithm(bfs.search, weightedGraph);
    const postReport = evaluateCompatibility(bfs, weightedGraph, run);
    expect(postReport.warnings.map((w) => w.code)).toContain('suboptimal-result');

    // No warning on unweighted network.
    const unweighted = buildPreset('unweighted-graph', false);
    const okRun = runAlgorithm(bfs.search, unweighted);
    const cleanReport = evaluateCompatibility(bfs, unweighted, okRun);
    expect(cleanReport.warnings).toEqual([]);
  });

  it('warns on negative edge weights, negative cycles, and inadmissible heuristics', () => {
    const astar = getAlgorithm('astar')!;

    // Negative edge graph: A* returns cost 60 while SPFA optimal cost is 50.
    const negGraph = buildPreset('negative-edge-graph', false);
    const negRun = runAlgorithm(astar.search, negGraph);
    const negReport = evaluateCompatibility(astar, negGraph, negRun);
    expect(negReport.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['negative-weights', 'suboptimal-result']),
    );
    expect(negReport.optimalCost).toBe(50);

    // Negative-weight cycle triggers cycle warning cleanly without hanging.
    const cycleGraph = new AdjacencyGraphProblem({
      nodeCount: 3,
      start: 0,
      goal: 2,
      adjacency: [
        [{ node: 1, cost: 5 }],
        [{ node: 0, cost: -10 }, { node: 2, cost: 5 }],
        [],
      ],
      positions: [
        { x: 10, y: 50 },
        { x: 50, y: 50 },
        { x: 90, y: 50 },
      ],
      directed: true,
      weighted: true,
    });
    const cycleReport = evaluateCompatibility(astar, cycleGraph, null);
    expect(cycleReport.optimalStatus).toBe('negative-cycle');
    expect(cycleReport.warnings.map((w) => w.code)).toContain('negative-cycle');

    // Heuristic trap graph: A* finds 94 vs optimal 72 because edge (3,4) cost 12 < h(3)=38.
    const trapGraph = buildPreset('heuristic-trap-graph', false);
    const trapRun = runAlgorithm(astar.search, trapGraph);
    const trapReport = evaluateCompatibility(astar, trapGraph, trapRun);
    expect(trapReport.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['inadmissible-heuristic', 'suboptimal-result']),
    );
    expect(trapReport.optimalCost).toBe(72);
  });

  it('flags missing coordinates, incomplete runs, and disconnected paths for custom algos', () => {
    const fakeHeuristicEntry: AlgorithmEntry = {
      meta: {
        id: 'mock-h',
        name: 'Mock Heuristic',
        category: 'Custom',
        weighted: true,
        usesHeuristic: true,
        supportsNegativeWeights: false,
        requiresAdmissibleHeuristic: true,
        description: 'Test entry.',
      },
      search: () => null,
      source: '',
      filePath: '',
    };

    const coordless = new AdjacencyGraphProblem({
      nodeCount: 2,
      start: 0,
      goal: 1,
      adjacency: [[{ node: 1, cost: 5 }], []],
      directed: true,
      weighted: true,
    });

    const nullRun = runAlgorithm(fakeHeuristicEntry.search, coordless);
    const nullReport = evaluateCompatibility(fakeHeuristicEntry, coordless, nullRun);
    expect(nullReport.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['no-positions-heuristic', 'incomplete-result']),
    );

    const disconnectedRun = runAlgorithm(() => [0, 1], buildPreset('blank-graph', false));
    const badPathReport = evaluateCompatibility(
      fakeHeuristicEntry,
      buildPreset('blank-graph', false),
      disconnectedRun,
    );
    expect(badPathReport.warnings.map((w) => w.code)).toContain('invalid-path');
  });

  it('executes BFS, DFS, UCS, LCFS, and IDS and reports automatic & custom incompatibility warnings', () => {
    const unweighted = buildPreset('unweighted-graph', false);
    const weightedGraph = buildPreset('sample-graph', false);
    const weightedGrid = buildPreset('weighted-swamp', false);
    const directed = buildPreset('directed-graph', false);
    const negativeGraph = buildPreset('negative-edge-graph', false);
    const blankUnreachable = buildPreset('blank-graph', false);

    // 1. BFS
    const bfs = getAlgorithm('bfs')!;
    expect(bfs).toBeTruthy();
    const bfsDirected = runAlgorithm(bfs.search, directed);
    expect(bfsDirected.error).toBeNull();
    expect(bfsDirected.path).toBeTruthy();

    // 2. DFS: valid connected paths, null when unreachable, non-optimal warning even on unweighted graph.
    const dfs = getAlgorithm('dfs')!;
    expect(dfs).toBeTruthy();
    const dfsUnweighted = runAlgorithm(dfs.search, unweighted);
    expect(dfsUnweighted.error).toBeNull();
    expect(dfsUnweighted.path?.[0]).toBe(unweighted.start);
    expect(dfsUnweighted.path?.[dfsUnweighted.path.length - 1]).toBe(unweighted.goal);
    expect(evaluateCompatibility(dfs, unweighted, dfsUnweighted).warnings.map((w) => w.code)).toContain(
      'non-optimal-strategy',
    );
    expect(evaluateCompatibility(dfs, weightedGraph, null).warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['ignores-weights', 'non-optimal-strategy']),
    );
    expect(runAlgorithm(dfs.search, blankUnreachable).path).toBeNull();

    // 3. UCS: optimal cost on weighted graphs/grids/directed, warns on negative weights.
    const ucs = getAlgorithm('ucs')!;
    expect(ucs).toBeTruthy();
    const ucsWeighted = runAlgorithm(ucs.search, weightedGraph);
    expect(ucsWeighted.error).toBeNull();
    expect(ucsWeighted.stats.pathCost).toBe(119);
    expect(evaluateCompatibility(ucs, weightedGraph, ucsWeighted).warnings).toEqual([]);
    const ucsGrid = runAlgorithm(ucs.search, weightedGrid);
    const ucsGridReport = evaluateCompatibility(ucs, weightedGrid, ucsGrid);
    expect(ucsGridReport.warnings).toEqual([]);
    expect(ucsGrid.stats.pathCost).toBe(ucsGridReport.optimalCost);
    expect(evaluateCompatibility(ucs, negativeGraph, null).warnings.map((w) => w.code)).toContain(
      'negative-weights',
    );

    // 4. LCFS: optimal cost on weighted graphs/grids, warns on negative weights & dense cyclic heap growth.
    const lcfs = getAlgorithm('lcfs')!;
    expect(lcfs).toBeTruthy();
    const lcfsWeighted = runAlgorithm(lcfs.search, weightedGraph);
    expect(lcfsWeighted.error).toBeNull();
    expect(lcfsWeighted.stats.pathCost).toBe(119);
    expect(lcfsWeighted.trace.length).toBeGreaterThanOrEqual(ucsWeighted.trace.length);
    const lcfsGrid = runAlgorithm(lcfs.search, weightedGrid);
    const lcfsGridReport = evaluateCompatibility(lcfs, weightedGrid, lcfsGrid);
    expect(lcfsGrid.stats.pathCost).toBe(lcfsGridReport.optimalCost);
    expect(lcfsGridReport.warnings.map((w) => w.code)).toContain('cycle-reexploration');
    expect(evaluateCompatibility(lcfs, negativeGraph, null).warnings.map((w) => w.code)).toContain(
      'negative-weights',
    );

    // 5. IDS: optimal fewest-hop path on small unweighted/directed graphs, warns on weighted & deep cyclic grids.
    const ids = getAlgorithm('ids')!;
    expect(ids).toBeTruthy();
    const idsUnweighted = runAlgorithm(ids.search, unweighted);
    expect(idsUnweighted.error).toBeNull();
    expect(idsUnweighted.stats.pathCost).toBe(3); // fewest hops on sample graph
    expect(evaluateCompatibility(ids, unweighted, idsUnweighted).warnings).toEqual([]);
    const idsDirected = runAlgorithm(ids.search, directed);
    expect(idsDirected.error).toBeNull();
    expect(idsDirected.path).toBeTruthy();
    expect(evaluateCompatibility(ids, weightedGraph, null).warnings.map((w) => w.code)).toContain(
      'ignores-weights',
    );
    expect(evaluateCompatibility(ids, weightedGrid, null).warnings.map((w) => w.code)).toContain(
      'step-budget-risk',
    );
    expect(runAlgorithm(ids.search, blankUnreachable).path).toBeNull();

    // 6. Greedy Best-First Search: expands by h(n), finds valid paths, warns on non-optimality, weights, and missing coordinates.
    const gbfs = getAlgorithm('greedy-best-first')!;
    expect(gbfs).toBeTruthy();
    const gbfsConcave = runAlgorithm(gbfs.search, buildPreset('concave-trap', false));
    expect(gbfsConcave.error).toBeNull();
    expect(gbfsConcave.path).toBeTruthy();
    expect(gbfsConcave.path?.[0]).toBe(buildPreset('concave-trap', false).start);
    expect(gbfsConcave.path?.[gbfsConcave.path.length - 1]).toBe(
      buildPreset('concave-trap', false).goal,
    );

    const gbfsUnweighted = runAlgorithm(gbfs.search, unweighted);
    expect(gbfsUnweighted.error).toBeNull();
    expect(gbfsUnweighted.path).toBeTruthy();
    expect(
      evaluateCompatibility(gbfs, unweighted, gbfsUnweighted).warnings.map((w) => w.code),
    ).toContain('non-optimal-strategy');

    const gbfsWeighted = runAlgorithm(gbfs.search, weightedGraph);
    expect(gbfsWeighted.error).toBeNull();
    expect(
      evaluateCompatibility(gbfs, weightedGraph, gbfsWeighted).warnings.map((w) => w.code),
    ).toEqual(expect.arrayContaining(['ignores-weights', 'non-optimal-strategy']));

    const gbfsNegative = evaluateCompatibility(gbfs, negativeGraph, null);
    expect(gbfsNegative.warnings.map((w) => w.code)).toContain('negative-weights');

    const coordless = new AdjacencyGraphProblem({
      nodeCount: 2,
      start: 0,
      goal: 1,
      adjacency: [[{ node: 1, cost: 5 }], []],
      directed: true,
      weighted: true,
    });
    expect(evaluateCompatibility(gbfs, coordless, null).warnings.map((w) => w.code)).toContain(
      'no-positions-heuristic',
    );
    expect(runAlgorithm(gbfs.search, blankUnreachable).path).toBeNull();
  });
});
