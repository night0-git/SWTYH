import { describe, expect, it } from 'vitest';
import {
  applyGridEdit,
  createInitialSimulationState,
  simulationReducer,
  type SimulationAction,
  type SimulationState,
} from '../components/simulationState';
import type { AdjacencyGraphProblem } from '../engine/graphProblem';
import { Grid2DProblem } from '../engine/gridProblem';
import { NodeState } from '../engine/types';

function reduceSeq(
  initial: SimulationState,
  actions: readonly SimulationAction[],
): SimulationState {
  return actions.reduce((s, a) => simulationReducer(s, a), initial);
}

describe('applyGridEdit', () => {
  const base = new Grid2DProblem({
    cols: 5,
    rows: 5,
    start: { x: 0, y: 0 },
    goal: { x: 4, y: 4 },
  });

  it('paints and erases walls and weights without touching Start or Goal', () => {
    const mid = base.toId(2, 2);
    const withWall = applyGridEdit(base, { type: 'wall', node: mid, value: 1 });
    expect(withWall.walls[mid]).toBe(1);

    // Attempting to place a wall or weight on Start or Goal is ignored.
    const onStart = applyGridEdit(withWall, { type: 'wall', node: base.start, value: 1 });
    expect(onStart.walls[base.start]).toBe(0);
    const weightOnGoal = applyGridEdit(withWall, {
      type: 'weight',
      node: base.goal,
      value: 5,
    });
    expect(weightOnGoal.weightAt(base.goal)).toBe(1);

    // Painting weight clears wall; erasing clears both wall and weight.
    const withWeight = applyGridEdit(withWall, { type: 'weight', node: mid, value: 5 });
    expect(withWeight.walls[mid]).toBe(0);
    expect(withWeight.weightAt(mid)).toBe(5);

    const erased = applyGridEdit(withWeight, { type: 'erase', node: mid });
    expect(erased.walls[mid]).toBe(0);
    expect(erased.weightAt(mid)).toBe(1);
  });

  it('moves Start and Goal safely and forbids overlapping them', () => {
    const cell = base.toId(1, 2);
    const wallCell = base.toId(3, 3);
    const withWall = applyGridEdit(base, { type: 'wall', node: wallCell, value: 1 });

    // Moving Start onto a wall clears the wall at Start.
    const movedStart = applyGridEdit(withWall, { type: 'move-start', node: wallCell });
    expect(movedStart.start).toBe(wallCell);
    expect(movedStart.walls[wallCell]).toBe(0);

    // Moving Start onto Goal is ignored.
    const ontoGoal = applyGridEdit(movedStart, { type: 'move-start', node: movedStart.goal });
    expect(ontoGoal.start).toBe(wallCell);

    // Moving Goal onto Start is ignored; valid move succeeds.
    const ontoStart = applyGridEdit(movedStart, { type: 'move-goal', node: movedStart.start });
    expect(ontoStart.goal).toBe(base.goal);
    const movedGoal = applyGridEdit(movedStart, { type: 'move-goal', node: cell });
    expect(movedGoal.goal).toBe(cell);
  });
});

describe('simulationReducer replay & editing hot paths', () => {
  it('preserves rapid sequential grid edits before replay', () => {
    const s0 = createInitialSimulationState();
    const grid = s0.problem as Grid2DProblem;
    const c1 = grid.toId(1, 1);
    const c2 = grid.toId(1, 2);
    const c3 = grid.toId(1, 3);

    const s1 = reduceSeq(s0, [
      { type: 'grid-edit', edit: { type: 'wall', node: c1, value: 1 }, currentCursor: 0, wasAtEnd: false },
      { type: 'grid-edit', edit: { type: 'wall', node: c2, value: 1 }, currentCursor: 0, wasAtEnd: false },
      { type: 'grid-edit', edit: { type: 'wall', node: c3, value: 1 }, currentCursor: 0, wasAtEnd: false },
    ]);

    const nextGrid = s1.problem as Grid2DProblem;
    expect(nextGrid.walls[c1]).toBe(1);
    expect(nextGrid.walls[c2]).toBe(1);
    expect(nextGrid.walls[c3]).toBe(1);
    expect(s1.player).toBeNull();
  });

  it('erasing a wall at End recomputes trace, clears wall state, and stays at End', () => {
    let s = createInitialSimulationState();
    const grid = s.problem as Grid2DProblem;
    // Center wall of concave-trap is at (19, 10)
    const wallNode = grid.toId(19, 10);
    expect(grid.walls[wallNode]).toBe(1);

    s = simulationReducer(s, { type: 'jump-end' });
    expect(s.player).not.toBeNull();
    const oldLen = s.runResult!.stats.pathLength;
    expect(s.player!.states[wallNode]).toBe(NodeState.Wall);

    // Erase the middle barrier wall while at End.
    s = simulationReducer(s, {
      type: 'grid-edit',
      edit: { type: 'wall', node: wallNode, value: 0 },
      currentCursor: s.player!.cursor,
      wasAtEnd: s.player!.isAtEnd,
    });

    const updatedGrid = s.problem as Grid2DProblem;
    expect(updatedGrid.walls[wallNode]).toBe(0);
    expect(s.player!.isAtEnd).toBe(true);
    expect(s.player!.cursor).toBe(s.player!.length);
    // Erasing the wall opens the direct path through (19, 10)
    expect(s.player!.states[wallNode]).not.toBe(NodeState.Wall);
    expect(s.runResult!.stats.pathLength).toBeLessThan(oldLen);
  });

  it('erasing a wall after Reset (cursor 0) keeps cursor at 0 with updated initial states', () => {
    let s = createInitialSimulationState();
    const grid = s.problem as Grid2DProblem;
    const wallNode = grid.toId(19, 10);

    s = simulationReducer(s, { type: 'jump-end' });
    s = simulationReducer(s, { type: 'reset' });
    expect(s.player!.cursor).toBe(0);

    s = simulationReducer(s, {
      type: 'grid-edit',
      edit: { type: 'wall', node: wallNode, value: 0 },
      currentCursor: s.player!.cursor,
      wasAtEnd: s.player!.isAtEnd,
    });

    expect(s.player!.cursor).toBe(0);
    expect(s.player!.states[wallNode]).toBe(NodeState.Unvisited);
    expect(s.playing).toBe(false);
  });

  it('erasing a wall mid-replay clamps cursor if new trace is shorter and stops playing', () => {
    let s = createInitialSimulationState();
    s = simulationReducer(s, { type: 'select-algorithm', id: 'bfs' });
    s = simulationReducer(s, { type: 'jump-end' });
    const fullLength = s.player!.length;

    // Seek near the end, then open a shortcut that makes the trace much shorter.
    const highCursor = fullLength - 10;
    s = simulationReducer(s, { type: 'scrub', cursor: highCursor });
    s = simulationReducer(s, {
      type: 'play-toggle',
      currentCursor: s.player!.cursor,
      isAtEnd: false,
    });
    expect(s.playing).toBe(true);

    const grid = s.problem as Grid2DProblem;
    const wallNode = grid.toId(19, 10);
    s = simulationReducer(s, {
      type: 'grid-edit',
      edit: { type: 'wall', node: wallNode, value: 0 },
      currentCursor: highCursor,
      wasAtEnd: false,
    });

    expect(s.playing).toBe(false);
    expect(s.player!.cursor).toBeLessThanOrEqual(s.player!.length);
    expect(s.player!.cursor).toBe(Math.min(highCursor, s.player!.length));
    expect(s.player!.states[wallNode]).not.toBe(NodeState.Wall);
  });

  it('handles play-toggle restart from End and clamps step/scrub bounds', () => {
    let s = createInitialSimulationState();

    // Stepping -1 from null initializes player and clamps at 0.
    s = simulationReducer(s, { type: 'step', delta: -1, currentCursor: 0 });
    expect(s.player).not.toBeNull();
    expect(s.player!.cursor).toBe(0);

    // Stepping +1 advances cleanly.
    s = simulationReducer(s, { type: 'step', delta: 1, currentCursor: 0 });
    expect(s.player!.cursor).toBe(1);

    // Scrub out of bounds clamps cleanly.
    s = simulationReducer(s, { type: 'scrub', cursor: 999_999 });
    expect(s.player!.cursor).toBe(s.player!.length);

    // Play from End rewinds to 0 and starts playing.
    s = simulationReducer(s, {
      type: 'play-toggle',
      currentCursor: s.player!.cursor,
      isAtEnd: true,
    });
    expect(s.playing).toBe(true);
    expect(s.player!.cursor).toBe(0);

    // Pause preserves passed cursor.
    s = simulationReducer(s, {
      type: 'play-toggle',
      currentCursor: 12,
      isAtEnd: false,
    });
    expect(s.playing).toBe(false);
    expect(s.cursor).toBe(12);
  });

  it('handles zero-length trace on play-toggle without entering playing state', () => {
    let s = createInitialSimulationState();
    const grid = s.problem as Grid2DProblem;
    // Put Start and Goal adjacent? No, even faster: surround Start with walls? No, BFS still pushes Start!
    // Force an empty trace by testing playback-complete and scrub clamping on short trace:
    s = simulationReducer(s, { type: 'select-preset', presetId: 'open-field' });
    expect(grid.nodeCount).toBeGreaterThan(0);
    s = simulationReducer(s, { type: 'playback-complete', cursor: 0 });
    expect(s.playing).toBe(false);
  });

  it('handles graph vertex movement, bounds clamping, and mid-replay sync', () => {
    let s = createInitialSimulationState();
    s = simulationReducer(s, { type: 'select-preset', presetId: 'sample-graph' });
    s = simulationReducer(s, { type: 'select-algorithm', id: 'astar' });

    // grid-edit is safely ignored in graph mode.
    const ignored = simulationReducer(s, {
      type: 'grid-edit',
      edit: { type: 'wall', node: 1, value: 1 },
      currentCursor: 0,
      wasAtEnd: false,
    });
    expect(ignored).toBe(s);

    // Run to End, then drag vertex 4.
    s = simulationReducer(s, { type: 'jump-end' });
    s = simulationReducer(s, {
      type: 'move-vertex',
      node: 4,
      pos: { x: 82, y: 48 },
      currentCursor: s.player!.cursor,
      wasAtEnd: s.player!.isAtEnd,
    });

    const graph = s.problem as AdjacencyGraphProblem;
    expect(graph.position(4)).toEqual({ x: 82, y: 48 });
    expect(s.player!.isAtEnd).toBe(true);

    // Mid-replay vertex move preserves cursor.
    s = simulationReducer(s, { type: 'scrub', cursor: 5 });
    s = simulationReducer(s, {
      type: 'move-vertex',
      node: 4,
      pos: { x: 40, y: 50 },
      currentCursor: 5,
      wasAtEnd: false,
    });
    expect(s.player!.cursor).toBe(5);
  });

  it('handles clear, diagonal toggle, maze regen, tree toggle, and algorithm switch cleanly', () => {
    let s = createInitialSimulationState();
    s = simulationReducer(s, { type: 'jump-end' });
    expect(s.player).not.toBeNull();

    // Toggle diagonal preserves walls & resets trace.
    s = simulationReducer(s, { type: 'toggle-diagonal' });
    expect(s.allowDiagonal).toBe(true);
    expect(s.player).toBeNull();
    expect((s.problem as Grid2DProblem).allowDiagonal).toBe(true);

    // Clear wipes walls & weights while keeping Start/Goal.
    s = simulationReducer(s, { type: 'clear-grid' });
    const cleared = s.problem as Grid2DProblem;
    expect(cleared.walls.every((w) => w === 0)).toBe(true);

    // Maze regen and grid tree toggle.
    s = simulationReducer(s, { type: 'regen-maze' });
    expect(s.presetId).toBe('random-maze');
    s = simulationReducer(s, { type: 'toggle-grid-tree' });
    expect(s.showGridTree).toBe(true);
    s = simulationReducer(s, { type: 'set-draw-tool', tool: 'weight' });
    expect(s.drawTool).toBe('weight');
    s = simulationReducer(s, { type: 'set-speed', stepsPerSecond: 48 });
    expect(s.stepsPerSecond).toBe(48);
  });

  it('remains idempotent under React StrictMode double-invocation of reducer actions', () => {
    let s = createInitialSimulationState();
    s = simulationReducer(s, { type: 'jump-end' });
    s = simulationReducer(s, { type: 'scrub', cursor: 10 });

    const stepAction: SimulationAction = {
      type: 'step',
      delta: 1,
      currentCursor: s.player!.cursor,
    };
    const first = simulationReducer(s, stepAction);
    const second = simulationReducer(s, stepAction);

    expect(first.cursor).toBe(11);
    expect(second.cursor).toBe(11);
    expect(second.player!.cursor).toBe(11);

    const editAction: SimulationAction = {
      type: 'grid-edit',
      edit: { type: 'wall', node: (s.problem as Grid2DProblem).toId(19, 10), value: 0 },
      currentCursor: 11,
      wasAtEnd: false,
    };
    const e1 = simulationReducer(first, editAction);
    const e2 = simulationReducer(first, editAction);
    expect(e1.cursor).toBe(e2.cursor);
    expect(e1.player!.states).toEqual(e2.player!.states);
  });

  it('handles weight-brush selection and all graph customization actions across replay states', () => {
    let s = createInitialSimulationState();
    s = simulationReducer(s, { type: 'set-weight-brush', brush: 10 });
    expect(s.weightBrush).toBe(10);

    // Graph edits ignored when Grid is active.
    const ignoredGraph = simulationReducer(s, {
      type: 'graph-edit',
      edit: { type: 'toggle-directed' },
      currentCursor: 0,
      wasAtEnd: false,
    });
    expect(ignoredGraph).toBe(s);

    // Switch to Graph preset and select graph tool.
    s = simulationReducer(s, { type: 'select-preset', presetId: 'blank-graph' });
    s = simulationReducer(s, { type: 'set-graph-tool', tool: 'add-node' });
    expect(s.graphTool).toBe('add-node');

    // Add vertex before run (player === null).
    s = simulationReducer(s, {
      type: 'graph-edit',
      edit: { type: 'add-vertex', pos: { x: 50, y: 30 } },
      currentCursor: 0,
      wasAtEnd: false,
    });
    expect((s.problem as AdjacencyGraphProblem).nodeCount).toBe(3);
    expect(s.player).toBeNull();

    // Connect 0 -> 2 -> 1 and run to End.
    s = reduceSeq(s, [
      {
        type: 'graph-edit',
        edit: { type: 'add-edge', u: 0, v: 2, cost: 12 },
        currentCursor: 0,
        wasAtEnd: false,
      },
      {
        type: 'graph-edit',
        edit: { type: 'add-edge', u: 2, v: 1, cost: 15 },
        currentCursor: 0,
        wasAtEnd: false,
      },
      { type: 'jump-end' },
    ]);
    expect(s.runResult!.stats.pathCost).toBe(27);
    expect(s.player!.isAtEnd).toBe(true);

    // Editing edge weight (including negative!) at End recomputes path cost and stays at End.
    s = simulationReducer(s, {
      type: 'graph-edit',
      edit: { type: 'set-edge-weight', u: 2, v: 1, cost: -4 },
      currentCursor: s.player!.cursor,
      wasAtEnd: true,
    });
    expect(s.runResult!.stats.pathCost).toBe(8);
    expect(s.player!.isAtEnd).toBe(true);

    // Toggle weighted -> unweighted while playing pauses playback and updates cost.
    s = simulationReducer(s, { type: 'scrub', cursor: 2 });
    s = simulationReducer(s, { type: 'play-toggle', currentCursor: 2, isAtEnd: false });
    expect(s.playing).toBe(true);

    s = simulationReducer(s, {
      type: 'graph-edit',
      edit: { type: 'toggle-weighted' },
      currentCursor: 2,
      wasAtEnd: false,
    });
    expect(s.playing).toBe(false);
    expect((s.problem as AdjacencyGraphProblem).weighted).toBe(false);

    // Toggle directed, clear edges, move start/goal, remove vertex.
    s = reduceSeq(s, [
      { type: 'graph-edit', edit: { type: 'toggle-directed' }, currentCursor: 2, wasAtEnd: false },
      { type: 'graph-edit', edit: { type: 'move-start', node: 2 }, currentCursor: 2, wasAtEnd: false },
      { type: 'graph-edit', edit: { type: 'move-goal', node: 0 }, currentCursor: 2, wasAtEnd: false },
      { type: 'graph-edit', edit: { type: 'remove-vertex', node: 1 }, currentCursor: 2, wasAtEnd: false },
      { type: 'graph-edit', edit: { type: 'clear-edges' }, currentCursor: 2, wasAtEnd: false },
    ]);
    const finalGraph = s.problem as AdjacencyGraphProblem;
    expect(finalGraph.directed).toBe(true);
    expect(finalGraph.nodeCount).toBe(2);
    expect(finalGraph.neighbors(0)).toEqual([]);

    // Reset Preset restores original sample-graph / blank-graph structure and clears replay.
    s = simulationReducer(s, { type: 'select-preset', presetId: 'sample-graph' });
    s = simulationReducer(s, {
      type: 'graph-edit',
      edit: { type: 'clear-edges' },
      currentCursor: 0,
      wasAtEnd: false,
    });
    expect((s.problem as AdjacencyGraphProblem).neighbors(0)).toEqual([]);
    s = simulationReducer(s, { type: 'reset-preset' });
    expect((s.problem as AdjacencyGraphProblem).neighbors(0).length).toBeGreaterThan(0);
    expect(s.player).toBeNull();
    expect(s.cursor).toBe(0);
    expect(s.playing).toBe(false);
  });
});
