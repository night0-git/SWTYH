import type { AdjacencyGraphProblem } from '../engine/graphProblem';
import { Grid2DProblem } from '../engine/gridProblem';
import { buildPreset, type PresetId } from '../engine/presets';
import { algorithms, getAlgorithm } from '../engine/registry';
import { runAlgorithm } from '../engine/runner';
import {
  compactVisualTrace,
  rawCursorToVisualCursor,
  TracePlayer,
  visualCursorToRawCursor,
  type VisualFilterOptions,
} from '../engine/trace';
import type {
  AlgorithmEntry,
  NodeId,
  Point2D,
  RunResult,
  SearchProblem,
  Trace,
} from '../engine/types';

export type DrawTool = 'wall' | 'weight' | 'erase';
export type WeightBrush = 2 | 5 | 10;
export type GraphTool =
  | 'move'
  | 'add-node'
  | 'add-edge'
  | 'erase'
  | 'set-start'
  | 'set-goal'
  | 'rename';

export type GridEdit =
  | { readonly type: 'wall'; readonly node: NodeId; readonly value: 0 | 1 }
  | { readonly type: 'weight'; readonly node: NodeId; readonly value: number }
  | { readonly type: 'erase'; readonly node: NodeId }
  | { readonly type: 'move-start'; readonly node: NodeId }
  | { readonly type: 'move-goal'; readonly node: NodeId };

export type GraphEdit =
  | { readonly type: 'add-vertex'; readonly pos: Point2D }
  | { readonly type: 'remove-vertex'; readonly node: NodeId }
  | { readonly type: 'rename-vertex'; readonly node: NodeId; readonly label: string }
  | { readonly type: 'add-edge'; readonly u: NodeId; readonly v: NodeId; readonly cost?: number }
  | { readonly type: 'set-edge-weight'; readonly u: NodeId; readonly v: NodeId; readonly cost: number }
  | { readonly type: 'remove-edge'; readonly u: NodeId; readonly v: NodeId }
  | { readonly type: 'move-start'; readonly node: NodeId }
  | { readonly type: 'move-goal'; readonly node: NodeId }
  | { readonly type: 'toggle-directed' }
  | { readonly type: 'toggle-weighted' }
  | { readonly type: 'clear-edges' };

export interface SimulationState {
  readonly selectedId: string;
  readonly presetId: PresetId;
  readonly allowDiagonal: boolean;
  readonly showGridTree: boolean;
  readonly skipIntermediateSteps: boolean;
  readonly problem: SearchProblem;
  readonly drawTool: DrawTool;
  readonly weightBrush: WeightBrush;
  readonly graphTool: GraphTool;
  readonly stepsPerSecond: number;
  readonly runResult: RunResult | null;
  readonly player: TracePlayer | null;
  readonly cursor: number;
  readonly playing: boolean;
  readonly renderTick: number;
}

export type SimulationAction =
  | { readonly type: 'select-algorithm'; readonly id: string }
  | { readonly type: 'select-preset'; readonly presetId: PresetId }
  | { readonly type: 'reset-preset' }
  | { readonly type: 'regen-maze' }
  | { readonly type: 'clear-grid' }
  | { readonly type: 'toggle-diagonal' }
  | {
      readonly type: 'toggle-grid-tree';
      readonly currentCursor?: number;
      readonly wasAtEnd?: boolean;
    }
  | {
      readonly type: 'toggle-skip-intermediate';
      readonly currentCursor?: number;
      readonly wasAtEnd?: boolean;
    }
  | { readonly type: 'set-draw-tool'; readonly tool: DrawTool }
  | { readonly type: 'set-weight-brush'; readonly brush: WeightBrush }
  | { readonly type: 'set-graph-tool'; readonly tool: GraphTool }
  | { readonly type: 'set-speed'; readonly stepsPerSecond: number }
  | { readonly type: 'play-toggle'; readonly currentCursor: number; readonly isAtEnd: boolean }
  | { readonly type: 'step'; readonly delta: number; readonly currentCursor: number }
  | { readonly type: 'jump-end' }
  | { readonly type: 'reset' }
  | { readonly type: 'scrub'; readonly cursor: number }
  | { readonly type: 'playback-complete'; readonly cursor: number }
  | {
      readonly type: 'grid-edit';
      readonly edit: GridEdit;
      readonly currentCursor: number;
      readonly wasAtEnd: boolean;
    }
  | {
      readonly type: 'move-vertex';
      readonly node: NodeId;
      readonly pos: Point2D;
      readonly currentCursor: number;
      readonly wasAtEnd: boolean;
    }
  | {
      readonly type: 'graph-edit';
      readonly edit: GraphEdit;
      readonly currentCursor: number;
      readonly wasAtEnd: boolean;
    };

export function applyGridEdit(grid: Grid2DProblem, edit: GridEdit): Grid2DProblem {
  const walls = new Uint8Array(grid.walls);
  const weights = grid.weights
    ? new Float32Array(grid.weights)
    : new Float32Array(grid.nodeCount).fill(1);

  let startX = grid.start % grid.cols;
  let startY = (grid.start - startX) / grid.cols;
  let goalX = grid.goal % grid.cols;
  let goalY = (grid.goal - goalX) / grid.cols;

  switch (edit.type) {
    case 'wall':
      if (edit.node !== grid.start && edit.node !== grid.goal) {
        walls[edit.node] = edit.value;
        if (edit.value === 1) weights[edit.node] = 1;
      }
      break;
    case 'weight':
      if (edit.node !== grid.start && edit.node !== grid.goal) {
        walls[edit.node] = 0;
        weights[edit.node] = edit.value > 0 ? edit.value : 1;
      }
      break;
    case 'erase':
      walls[edit.node] = 0;
      weights[edit.node] = 1;
      break;
    case 'move-start':
      if (edit.node !== grid.goal && edit.node >= 0 && edit.node < grid.nodeCount) {
        startX = edit.node % grid.cols;
        startY = (edit.node - startX) / grid.cols;
      }
      break;
    case 'move-goal':
      if (edit.node !== grid.start && edit.node >= 0 && edit.node < grid.nodeCount) {
        goalX = edit.node % grid.cols;
        goalY = (edit.node - goalX) / grid.cols;
      }
      break;
  }

  return new Grid2DProblem({
    cols: grid.cols,
    rows: grid.rows,
    start: { x: startX, y: startY },
    goal: { x: goalX, y: goalY },
    walls,
    weights,
    allowDiagonal: grid.allowDiagonal,
  });
}

export function applyGraphEdit(
  graph: AdjacencyGraphProblem,
  edit: GraphEdit,
): AdjacencyGraphProblem {
  switch (edit.type) {
    case 'add-vertex':
      return graph.withAddedVertex(edit.pos);
    case 'remove-vertex':
      return graph.withRemovedVertex(edit.node);
    case 'rename-vertex':
      return graph.withRenamedVertex(edit.node, edit.label);
    case 'add-edge': {
      const defaultCost = Math.max(1, Math.round(graph.heuristic(edit.u, edit.v)));
      return graph.withAddedEdge(edit.u, edit.v, edit.cost ?? defaultCost);
    }
    case 'set-edge-weight':
      return graph.withEdgeWeight(edit.u, edit.v, edit.cost);
    case 'remove-edge':
      return graph.withRemovedEdge(edit.u, edit.v);
    case 'move-start':
      return graph.withStart(edit.node);
    case 'move-goal':
      return graph.withGoal(edit.node);
    case 'toggle-directed':
      return graph.withDirected(!graph.directed);
    case 'toggle-weighted':
      return graph.withWeighted(!graph.weighted);
    case 'clear-edges':
      return graph.clearedEdges();
  }
}

export function resolveSelectedAlgorithm(selectedId: string): AlgorithmEntry | undefined {
  return getAlgorithm(selectedId) ?? algorithms[0];
}

export function createInitialSimulationState(): SimulationState {
  return {
    selectedId: algorithms[0]?.meta.id ?? '',
    presetId: 'concave-trap',
    allowDiagonal: false,
    showGridTree: false,
    skipIntermediateSteps: false,
    problem: buildPreset('concave-trap', false),
    drawTool: 'wall',
    weightBrush: 5,
    graphTool: 'move',
    stepsPerSecond: 1,
    runResult: null,
    player: null,
    cursor: 0,
    playing: false,
    renderTick: 0,
  };
}

function visualFilterFor(
  problem: SearchProblem,
  showGridTree: boolean,
): VisualFilterOptions {
  return {
    includeParents: problem.kind === 'graph' || showGridTree,
    includeActiveEdge: problem.kind === 'graph',
  };
}

function buildPlayer(
  trace: Trace,
  problem: SearchProblem,
  skipIntermediateSteps: boolean,
  showGridTree: boolean,
): TracePlayer {
  return new TracePlayer(
    skipIntermediateSteps
      ? compactVisualTrace(trace, visualFilterFor(problem, showGridTree))
      : trace,
  );
}

function ensureExecuted(state: SimulationState): {
  runResult: RunResult;
  player: TracePlayer;
} | null {
  if (state.runResult && state.player) {
    return { runResult: state.runResult, player: state.player };
  }
  const selected = resolveSelectedAlgorithm(state.selectedId);
  if (!selected) return null;
  const runResult = runAlgorithm(selected.search, state.problem);
  const player = buildPlayer(
    runResult.trace,
    state.problem,
    state.skipIntermediateSteps,
    state.showGridTree,
  );
  return { runResult, player };
}

function refreshPlayerFromTrace(
  prevState: SimulationState,
  nextState: SimulationState,
  currentCursor: number,
  wasAtEnd: boolean,
): SimulationState {
  if (!prevState.runResult || !prevState.player) return nextState;
  const rawTrace = prevState.runResult.trace;
  const nextPlayer = buildPlayer(
    rawTrace,
    nextState.problem,
    nextState.skipIntermediateSteps,
    nextState.showGridTree,
  );

  let nextCursor: number;
  if (wasAtEnd) {
    nextCursor = nextPlayer.length;
  } else {
    const rawCursor = prevState.skipIntermediateSteps
      ? visualCursorToRawCursor(
          rawTrace,
          currentCursor,
          visualFilterFor(prevState.problem, prevState.showGridTree),
        )
      : Math.max(0, Math.min(currentCursor, rawTrace.length));
    nextCursor = nextState.skipIntermediateSteps
      ? rawCursorToVisualCursor(
          rawTrace,
          rawCursor,
          visualFilterFor(nextState.problem, nextState.showGridTree),
        )
      : rawCursor;
  }

  nextPlayer.seek(nextCursor);
  return {
    ...nextState,
    player: nextPlayer,
    cursor: nextCursor,
    playing: prevState.playing && nextPlayer.length > 0 && !nextPlayer.isAtEnd,
    renderTick: prevState.renderTick + 1,
  };
}

function recomputeAfterProblemChange(
  state: SimulationState,
  nextProblem: SearchProblem,
  currentCursor: number,
  wasAtEnd: boolean,
): SimulationState {
  if (!state.player) {
    return {
      ...state,
      problem: nextProblem,
      playing: false,
      renderTick: state.renderTick + 1,
    };
  }

  const selected = resolveSelectedAlgorithm(state.selectedId);
  if (!selected) {
    return {
      ...state,
      problem: nextProblem,
      runResult: null,
      player: null,
      cursor: 0,
      playing: false,
      renderTick: state.renderTick + 1,
    };
  }

  const nextRun = runAlgorithm(selected.search, nextProblem);
  const nextPlayer = buildPlayer(
    nextRun.trace,
    nextProblem,
    state.skipIntermediateSteps,
    state.showGridTree,
  );
  const nextCursor = wasAtEnd
    ? nextPlayer.length
    : Math.max(0, Math.min(currentCursor, nextPlayer.length));
  nextPlayer.seek(nextCursor);

  return {
    ...state,
    problem: nextProblem,
    runResult: nextRun,
    player: nextPlayer,
    cursor: nextCursor,
    playing: false,
    renderTick: state.renderTick + 1,
  };
}

export function simulationReducer(
  state: SimulationState,
  action: SimulationAction,
): SimulationState {
  switch (action.type) {
    case 'select-algorithm':
      return {
        ...state,
        selectedId: action.id,
        runResult: null,
        player: null,
        cursor: 0,
        playing: false,
        renderTick: state.renderTick + 1,
      };

    case 'select-preset':
      return {
        ...state,
        presetId: action.presetId,
        problem: buildPreset(action.presetId, state.allowDiagonal),
        runResult: null,
        player: null,
        cursor: 0,
        playing: false,
        renderTick: state.renderTick + 1,
      };

    case 'reset-preset':
      return {
        ...state,
        problem: buildPreset(state.presetId, state.allowDiagonal),
        runResult: null,
        player: null,
        cursor: 0,
        playing: false,
        renderTick: state.renderTick + 1,
      };

    case 'regen-maze':
      return {
        ...state,
        presetId: 'random-maze',
        problem: buildPreset('random-maze', state.allowDiagonal),
        runResult: null,
        player: null,
        cursor: 0,
        playing: false,
        renderTick: state.renderTick + 1,
      };

    case 'clear-grid': {
      if (state.problem.kind !== 'grid') return state;
      const grid = state.problem as Grid2DProblem;
      const startX = grid.start % grid.cols;
      const startY = (grid.start - startX) / grid.cols;
      const goalX = grid.goal % grid.cols;
      const goalY = (grid.goal - goalX) / grid.cols;
      return {
        ...state,
        problem: new Grid2DProblem({
          cols: grid.cols,
          rows: grid.rows,
          start: { x: startX, y: startY },
          goal: { x: goalX, y: goalY },
          weights: new Float32Array(grid.nodeCount).fill(1),
          allowDiagonal: grid.allowDiagonal,
        }),
        runResult: null,
        player: null,
        cursor: 0,
        playing: false,
        renderTick: state.renderTick + 1,
      };
    }

    case 'toggle-diagonal': {
      const nextDiag = !state.allowDiagonal;
      if (state.problem.kind !== 'grid') {
        return { ...state, allowDiagonal: nextDiag };
      }
      const grid = state.problem as Grid2DProblem;
      const startX = grid.start % grid.cols;
      const startY = (grid.start - startX) / grid.cols;
      const goalX = grid.goal % grid.cols;
      const goalY = (grid.goal - goalX) / grid.cols;
      return {
        ...state,
        allowDiagonal: nextDiag,
        problem: new Grid2DProblem({
          cols: grid.cols,
          rows: grid.rows,
          start: { x: startX, y: startY },
          goal: { x: goalX, y: goalY },
          walls: grid.walls,
          weights: grid.weights ?? undefined,
          allowDiagonal: nextDiag,
        }),
        runResult: null,
        player: null,
        cursor: 0,
        playing: false,
        renderTick: state.renderTick + 1,
      };
    }

    case 'toggle-grid-tree': {
      const nextState: SimulationState = {
        ...state,
        showGridTree: !state.showGridTree,
      };
      if (state.skipIntermediateSteps && state.problem.kind === 'grid' && state.player) {
        return refreshPlayerFromTrace(
          state,
          nextState,
          action.currentCursor ?? state.player.cursor,
          action.wasAtEnd ?? state.player.isAtEnd,
        );
      }
      return nextState;
    }

    case 'toggle-skip-intermediate': {
      const nextState: SimulationState = {
        ...state,
        skipIntermediateSteps: !state.skipIntermediateSteps,
      };
      return refreshPlayerFromTrace(
        state,
        nextState,
        action.currentCursor ?? state.player?.cursor ?? 0,
        action.wasAtEnd ?? state.player?.isAtEnd ?? false,
      );
    }

    case 'set-draw-tool':
      return {
        ...state,
        drawTool: action.tool,
      };

    case 'set-weight-brush':
      return {
        ...state,
        weightBrush: action.brush,
      };

    case 'set-graph-tool':
      return {
        ...state,
        graphTool: action.tool,
      };

    case 'set-speed':
      return {
        ...state,
        stepsPerSecond: action.stepsPerSecond,
      };

    case 'play-toggle': {
      if (state.playing) {
        const clamped = state.player
          ? Math.max(0, Math.min(action.currentCursor, state.player.length))
          : 0;
        return {
          ...state,
          playing: false,
          cursor: clamped,
          renderTick: state.renderTick + 1,
        };
      }

      const active = ensureExecuted(state);
      if (!active) return state;

      let nextCursor = state.player ? action.currentCursor : 0;
      if (active.player.length === 0) {
        active.player.seek(0);
        return {
          ...state,
          runResult: active.runResult,
          player: active.player,
          cursor: 0,
          playing: false,
          renderTick: state.renderTick + 1,
        };
      }

      if (action.isAtEnd || nextCursor >= active.player.length) {
        active.player.seek(0);
        nextCursor = 0;
      }

      return {
        ...state,
        runResult: active.runResult,
        player: active.player,
        cursor: nextCursor,
        playing: true,
        renderTick: state.renderTick + 1,
      };
    }

    case 'step': {
      const active = ensureExecuted(state);
      if (!active) return state;
      const baseCursor = state.player ? action.currentCursor : 0;
      const nextCursor = Math.max(
        0,
        Math.min(active.player.length, baseCursor + action.delta),
      );
      active.player.seek(nextCursor);
      return {
        ...state,
        runResult: active.runResult,
        player: active.player,
        cursor: nextCursor,
        playing: false,
        renderTick: state.renderTick + 1,
      };
    }

    case 'jump-end': {
      const active = ensureExecuted(state);
      if (!active) return state;
      active.player.seek(active.player.length);
      return {
        ...state,
        runResult: active.runResult,
        player: active.player,
        cursor: active.player.length,
        playing: false,
        renderTick: state.renderTick + 1,
      };
    }

    case 'reset': {
      if (!state.player) return state;
      state.player.seek(0);
      return {
        ...state,
        cursor: 0,
        playing: false,
        renderTick: state.renderTick + 1,
      };
    }

    case 'scrub': {
      if (!state.player) return state;
      const clamped = Math.max(
        0,
        Math.min(state.player.length, Math.trunc(action.cursor)),
      );
      state.player.seek(clamped);
      return {
        ...state,
        cursor: clamped,
        playing: false,
        renderTick: state.renderTick + 1,
      };
    }

    case 'playback-complete':
      return {
        ...state,
        cursor: state.player
          ? Math.max(0, Math.min(action.cursor, state.player.length))
          : 0,
        playing: false,
        renderTick: state.renderTick + 1,
      };

    case 'grid-edit': {
      if (state.problem.kind !== 'grid') return state;
      const nextProblem = applyGridEdit(state.problem as Grid2DProblem, action.edit);
      return recomputeAfterProblemChange(
        state,
        nextProblem,
        action.currentCursor,
        action.wasAtEnd,
      );
    }

    case 'move-vertex': {
      if (state.problem.kind !== 'graph') return state;
      const graph = state.problem as AdjacencyGraphProblem;
      const nextProblem = graph.withMovedVertex(action.node, action.pos);
      if (nextProblem === graph) return state;
      return recomputeAfterProblemChange(
        state,
        nextProblem,
        action.currentCursor,
        action.wasAtEnd,
      );
    }

    case 'graph-edit': {
      if (state.problem.kind !== 'graph') return state;
      const graph = state.problem as AdjacencyGraphProblem;
      const nextProblem = applyGraphEdit(graph, action.edit);
      if (nextProblem === graph) return state;
      return recomputeAfterProblemChange(
        state,
        nextProblem,
        action.currentCursor,
        action.wasAtEnd,
      );
    }
  }
}
