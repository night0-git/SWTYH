import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { SearchCanvasRenderer, type EdgeHitResult } from '../canvas/renderer';
import type { AdjacencyGraphProblem } from '../engine/graphProblem';
import type { Grid2DProblem } from '../engine/gridProblem';
import type { TracePlayer } from '../engine/trace';
import { NodeState, type NodeId, type Point2D, type SearchProblem } from '../engine/types';
import { syncCodeHighlightDom } from './CodeView';
import { syncContainersDom } from './ContainerView';
import type {
  DrawTool,
  GraphEdit,
  GraphTool,
  GridEdit,
  WeightBrush,
} from './simulationState';

type DragMode =
  | 'move-start'
  | 'move-goal'
  | 'move-vertex'
  | 'connect-edge'
  | 'wall-add'
  | 'wall-erase'
  | 'weight-add'
  | 'weight-erase'
  | 'erase';

interface WeightEditorState {
  readonly u: NodeId;
  readonly v: NodeId;
  readonly left: number;
  readonly top: number;
}

const STATE_NAMES: Record<number, string> = {
  [NodeState.Unvisited]: 'unvisited',
  [NodeState.Wall]: 'wall',
  [NodeState.Start]: 'start',
  [NodeState.Goal]: 'goal',
  [NodeState.Frontier]: 'frontier',
  [NodeState.Visited]: 'visited',
  [NodeState.Current]: 'current',
  [NodeState.Path]: 'path',
};

const GRAPH_IDLE_HINTS: Record<GraphTool, string> = {
  move: 'hover: drag vertex or click edge weight',
  'add-node': 'hover: click canvas to add vertex',
  'add-edge': 'hover: drag vertex to vertex to connect',
  erase: 'hover: click vertex or edge to remove',
  'set-start': 'hover: click vertex to move Start',
  'set-goal': 'hover: click vertex to move Goal',
};

function formatGraphNodeId(problem: SearchProblem, node: NodeId): string {
  if (node === problem.start) return 'S';
  if (node === problem.goal) return 'G';
  return `#${node}`;
}

function formatGraphNeighbors(problem: SearchProblem, node: NodeId, limit = 6): string {
  const edges = problem.neighbors(node);
  if (edges.length === 0) return 'none';
  const shown = edges.slice(0, limit).map((e) => formatGraphNodeId(problem, e.node));
  if (edges.length > limit) {
    return `[${shown.join(', ')}, +${edges.length - limit}]`;
  }
  return `[${shown.join(', ')}]`;
}

function formatHoverLabel(
  problem: SearchProblem,
  states: Uint8Array,
  node: NodeId | null,
  graphTool: GraphTool,
): string {
  if (node === null || node < 0 || node >= problem.nodeCount) {
    return problem.kind === 'graph' ? GRAPH_IDLE_HINTS[graphTool] : 'hover: —';
  }
  const stateName = STATE_NAMES[states[node] ?? NodeState.Unvisited] ?? 'unknown';
  if (problem.kind === 'grid') {
    const grid = problem as Grid2DProblem;
    const x = node % grid.cols;
    const y = (node - x) / grid.cols;
    const w = grid.weightAt(node);
    const h = problem.heuristic(node).toFixed(1);
    return `cell (${x}, ${y}) #${node} · ${stateName} · w:${w} · h:${h}`;
  }
  const h = problem.heuristic(node).toFixed(1);
  const neighbors = formatGraphNeighbors(problem, node);
  return `vertex ${formatGraphNodeId(problem, node)} · ${stateName} · h:${h} · neighbors: ${neighbors}`;
}

interface ViewportProps {
  readonly problem: SearchProblem;
  readonly player: TracePlayer | null;
  readonly path: readonly NodeId[] | null;
  readonly playing: boolean;
  readonly stepsPerSecond: number;
  readonly showGridTree: boolean;
  readonly renderTick: number;
  readonly drawTool: DrawTool;
  readonly weightBrush: WeightBrush;
  readonly graphTool: GraphTool;
  readonly scrubberRef: RefObject<HTMLInputElement | null>;
  readonly stepCounterRef: RefObject<HTMLSpanElement | null>;
  readonly hoverLabelRef: RefObject<HTMLSpanElement | null>;
  readonly containerHostRef: RefObject<HTMLDivElement | null>;
  readonly codeBodyRef: RefObject<HTMLTableSectionElement | null>;
  readonly onGridEdit: (edit: GridEdit) => void;
  readonly onMoveVertex: (node: NodeId, pos: Point2D) => void;
  readonly onGraphEdit: (edit: GraphEdit) => void;
  readonly onPlaybackComplete: (cursor: number) => void;
}

export function Viewport({
  problem,
  player,
  path,
  playing,
  stepsPerSecond,
  showGridTree,
  renderTick,
  drawTool,
  weightBrush,
  graphTool,
  scrubberRef,
  stepCounterRef,
  hoverLabelRef,
  containerHostRef,
  codeBodyRef,
  onGridEdit,
  onMoveVertex,
  onGraphEdit,
  onPlaybackComplete,
}: ViewportProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SearchCanvasRenderer | null>(null);
  const dragModeRef = useRef<DragMode | null>(null);
  const draggedVertexRef = useRef<NodeId | null>(null);
  const draftEdgeRef = useRef<{ from: NodeId; toX: number; toY: number } | null>(null);
  const lastPaintedRef = useRef<NodeId | null>(null);
  const hoverNodeRef = useRef<NodeId | null>(null);
  const weightInputRef = useRef<HTMLInputElement | null>(null);
  const lastSyncedTraceRef = useRef<{
    problem: SearchProblem;
    player: TracePlayer | null;
    cursor: number;
    containerHost: HTMLElement | null;
    codeBody: HTMLTableSectionElement | null;
  } | null>(null);

  const [weightEditor, setWeightEditor] = useState<WeightEditorState | null>(null);
  const [weightInput, setWeightInput] = useState('');

  const problemRef = useRef(problem);
  const playerRef = useRef(player);
  const pathRef = useRef(path);
  const playingRef = useRef(playing);
  const showGridTreeRef = useRef(showGridTree);
  const drawToolRef = useRef(drawTool);
  const weightBrushRef = useRef(weightBrush);
  const graphToolRef = useRef(graphTool);
  const weightEditorRef = useRef(weightEditor);
  const onGridEditRef = useRef(onGridEdit);
  const onMoveVertexRef = useRef(onMoveVertex);
  const onGraphEditRef = useRef(onGraphEdit);

  problemRef.current = problem;
  playerRef.current = player;
  pathRef.current = path;
  playingRef.current = playing;
  showGridTreeRef.current = showGridTree;
  drawToolRef.current = drawTool;
  weightBrushRef.current = weightBrush;
  graphToolRef.current = graphTool;
  weightEditorRef.current = weightEditor;
  onGridEditRef.current = onGridEdit;
  onMoveVertexRef.current = onMoveVertex;
  onGraphEditRef.current = onGraphEdit;

  const drawFrame = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const activePlayer = playerRef.current;
    const activeProblem = problemRef.current;
    const states = activePlayer ? activePlayer.states : activeProblem.initialStates();
    const activeWeightEditor = weightEditorRef.current;

    renderer.render(activeProblem, states, {
      path: pathRef.current,
      showPathLine: Boolean(activePlayer && activePlayer.isAtEnd),
      parents: activePlayer ? activePlayer.parents : null,
      currentNode: activePlayer ? activePlayer.currentNode : -1,
      activeEdgeFrom: activePlayer ? activePlayer.activeEdgeFrom : -1,
      activeEdgeTo: activePlayer ? activePlayer.activeEdgeTo : -1,
      showGridTree: showGridTreeRef.current,
      hoverNode: hoverNodeRef.current,
      dragNode: draggedVertexRef.current,
      selectedEdge: activeWeightEditor
        ? { u: activeWeightEditor.u, v: activeWeightEditor.v }
        : null,
      draftEdge: draftEdgeRef.current,
    });

    if (hoverLabelRef.current) {
      const nextLabel = formatHoverLabel(
        activeProblem,
        states,
        hoverNodeRef.current,
        graphToolRef.current,
      );
      if (hoverLabelRef.current.textContent !== nextLabel) {
        hoverLabelRef.current.textContent = nextLabel;
        hoverLabelRef.current.title = nextLabel;
      }
    }

    const activeCursor = activePlayer ? activePlayer.cursor : 0;
    const containerHost = containerHostRef.current;
    const codeBody = codeBodyRef.current;
    const prevSync = lastSyncedTraceRef.current;
    if (
      !prevSync ||
      prevSync.problem !== activeProblem ||
      prevSync.player !== activePlayer ||
      prevSync.cursor !== activeCursor ||
      prevSync.containerHost !== containerHost ||
      prevSync.codeBody !== codeBody
    ) {
      lastSyncedTraceRef.current = {
        problem: activeProblem,
        player: activePlayer,
        cursor: activeCursor,
        containerHost,
        codeBody,
      };
      syncContainersDom(containerHost, activePlayer, activeProblem);
      syncCodeHighlightDom(codeBody, activePlayer);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new SearchCanvasRenderer(canvas);
    rendererRef.current = renderer;

    const observer = new ResizeObserver(drawFrame);
    observer.observe(canvas);
    drawFrame();

    return () => {
      observer.disconnect();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (problem.kind !== 'graph' || !(problem as AdjacencyGraphProblem).weighted) {
      setWeightEditor(null);
    }
  }, [problem]);

  useEffect(() => {
    if (weightEditor && weightInputRef.current) {
      weightInputRef.current.focus();
      weightInputRef.current.select();
    }
  }, [weightEditor]);

  useEffect(() => {
    drawFrame();
    if (scrubberRef.current) {
      scrubberRef.current.value = String(player ? player.cursor : 0);
    }
    if (stepCounterRef.current) {
      const cur = player ? player.cursor : 0;
      const total = player ? player.length : 0;
      stepCounterRef.current.textContent = `${cur} / ${total}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, player, path, showGridTree, graphTool, weightEditor, renderTick]);

  useEffect(() => {
    if (!playing || !player) return;
    let rafId = 0;
    let lastTime = performance.now();
    // Pre-seed 1 step when starting from step 0 so slow speeds give immediate feedback on Play.
    let accumulator = player.cursor === 0 ? 1 : 0;

    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      accumulator += dt * stepsPerSecond;

      const stepsToAdvance = Math.floor(accumulator);
      if (stepsToAdvance > 0) {
        accumulator -= stepsToAdvance;
        const advanced = player.stepForward(stepsToAdvance);
        drawFrame();

        if (scrubberRef.current) {
          scrubberRef.current.value = String(player.cursor);
        }
        if (stepCounterRef.current) {
          stepCounterRef.current.textContent = `${player.cursor} / ${player.length}`;
        }

        if (!advanced || player.isAtEnd) {
          onPlaybackComplete(player.cursor);
          return;
        }
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, player, problem, stepsPerSecond, onPlaybackComplete]);

  const applyDragAtNode = (mode: DragMode, node: NodeId) => {
    const activeProblem = problemRef.current;
    if (activeProblem.kind !== 'grid') return;

    switch (mode) {
      case 'move-start':
        if (node !== activeProblem.goal && node !== activeProblem.start) {
          onGridEditRef.current({ type: 'move-start', node });
        }
        break;
      case 'move-goal':
        if (node !== activeProblem.start && node !== activeProblem.goal) {
          onGridEditRef.current({ type: 'move-goal', node });
        }
        break;
      case 'wall-add':
        if (node !== activeProblem.start && node !== activeProblem.goal) {
          onGridEditRef.current({ type: 'wall', node, value: 1 });
        }
        break;
      case 'wall-erase':
        onGridEditRef.current({ type: 'wall', node, value: 0 });
        break;
      case 'weight-add':
        if (node !== activeProblem.start && node !== activeProblem.goal) {
          onGridEditRef.current({ type: 'weight', node, value: weightBrushRef.current });
        }
        break;
      case 'weight-erase':
        onGridEditRef.current({ type: 'weight', node, value: 1 });
        break;
      case 'erase':
        onGridEditRef.current({ type: 'erase', node });
        break;
    }
  };

  const openEdgeWeightEditor = (hit: EdgeHitResult) => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) {
      setWeightEditor({ u: hit.u, v: hit.v, left: hit.canvasX, top: hit.canvasY });
      setWeightInput(String(hit.cost));
      return;
    }

    const offsetLeft = canvas.offsetLeft + hit.canvasX;
    const offsetTop = canvas.offsetTop + hit.canvasY;
    const maxLeft = Math.max(16, stage.clientWidth - 156);
    const maxTop = Math.max(16, stage.clientHeight - 44);

    setWeightEditor({
      u: hit.u,
      v: hit.v,
      left: Math.max(12, Math.min(maxLeft, offsetLeft)),
      top: Math.max(12, Math.min(maxTop, offsetTop)),
    });
    setWeightInput(String(hit.cost));
  };

  const updateCursor = (node: NodeId | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (dragModeRef.current === 'move-vertex') {
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (problemRef.current.kind === 'graph') {
      const tool = graphToolRef.current;
      if (tool === 'add-node') {
        canvas.style.cursor = node !== null ? 'grab' : 'copy';
      } else if (tool === 'add-edge') {
        canvas.style.cursor = node !== null ? 'crosshair' : 'default';
      } else if (tool === 'erase' || tool === 'set-start' || tool === 'set-goal') {
        canvas.style.cursor = node !== null ? 'pointer' : 'default';
      } else {
        canvas.style.cursor = node !== null ? 'grab' : 'default';
      }
      return;
    }
    canvas.style.cursor = node !== null ? 'crosshair' : 'default';
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const renderer = rendererRef.current;
    const activeProblem = problemRef.current;
    if (!renderer) return;

    if (weightEditorRef.current) {
      setWeightEditor(null);
    }

    const node = renderer.hitTest(activeProblem, e.clientX, e.clientY);

    if (activeProblem.kind === 'graph') {
      const graph = activeProblem as AdjacencyGraphProblem;
      const tool = graphToolRef.current;

      if (tool === 'set-start') {
        if (node !== null) onGraphEditRef.current({ type: 'move-start', node });
        return;
      }

      if (tool === 'set-goal') {
        if (node !== null) onGraphEditRef.current({ type: 'move-goal', node });
        return;
      }

      if (tool === 'erase') {
        if (node !== null) {
          onGraphEditRef.current({ type: 'remove-vertex', node });
          return;
        }
        const edgeHit = renderer.edgeHitTest(graph, e.clientX, e.clientY);
        if (edgeHit) {
          onGraphEditRef.current({ type: 'remove-edge', u: edgeHit.u, v: edgeHit.v });
        }
        return;
      }

      if (tool === 'add-node') {
        if (node === null) {
          const pos = renderer.screenToGraphPosition(e.clientX, e.clientY);
          if (pos) onGraphEditRef.current({ type: 'add-vertex', pos });
          return;
        }
        dragModeRef.current = 'move-vertex';
        draggedVertexRef.current = node;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateCursor(node);
        if (!playingRef.current) drawFrame();
        return;
      }

      if (tool === 'add-edge') {
        if (node !== null) {
          const rect = e.currentTarget.getBoundingClientRect();
          dragModeRef.current = 'connect-edge';
          draggedVertexRef.current = node;
          draftEdgeRef.current = {
            from: node,
            toX: e.clientX - rect.left,
            toY: e.clientY - rect.top,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          updateCursor(node);
          if (!playingRef.current) drawFrame();
          return;
        }
        if (graph.weighted) {
          const edgeHit = renderer.edgeHitTest(graph, e.clientX, e.clientY);
          if (edgeHit) openEdgeWeightEditor(edgeHit);
        }
        return;
      }

      // Default 'move' tool: drag vertex or click edge weight to edit.
      if (node !== null) {
        dragModeRef.current = 'move-vertex';
        draggedVertexRef.current = node;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateCursor(node);
        if (!playingRef.current) drawFrame();
        return;
      }

      if (graph.weighted) {
        const edgeHit = renderer.edgeHitTest(graph, e.clientX, e.clientY);
        if (edgeHit) openEdgeWeightEditor(edgeHit);
      }
      return;
    }

    if (node === null) return;
    const grid = activeProblem as Grid2DProblem;
    let mode: DragMode;
    if (node === grid.start) {
      mode = 'move-start';
    } else if (node === grid.goal) {
      mode = 'move-goal';
    } else if (drawToolRef.current === 'wall') {
      mode = grid.walls[node] === 1 ? 'wall-erase' : 'wall-add';
    } else if (drawToolRef.current === 'weight') {
      mode = grid.weightAt(node) === weightBrushRef.current ? 'weight-erase' : 'weight-add';
    } else {
      mode = 'erase';
    }

    dragModeRef.current = mode;
    lastPaintedRef.current = node;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyDragAtNode(mode, node);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const activeProblem = problemRef.current;

    if (
      dragModeRef.current === 'move-vertex' &&
      draggedVertexRef.current !== null &&
      activeProblem.kind === 'graph'
    ) {
      const pos = renderer.screenToGraphPosition(e.clientX, e.clientY);
      if (pos) {
        onMoveVertexRef.current(draggedVertexRef.current, pos);
      }
      return;
    }

    if (
      dragModeRef.current === 'connect-edge' &&
      draftEdgeRef.current !== null &&
      activeProblem.kind === 'graph'
    ) {
      const rect = e.currentTarget.getBoundingClientRect();
      draftEdgeRef.current = {
        from: draftEdgeRef.current.from,
        toX: e.clientX - rect.left,
        toY: e.clientY - rect.top,
      };
      hoverNodeRef.current = renderer.hitTest(activeProblem, e.clientX, e.clientY);
      drawFrame();
      return;
    }

    const node = renderer.hitTest(activeProblem, e.clientX, e.clientY);
    updateCursor(node);

    if (hoverNodeRef.current !== node) {
      hoverNodeRef.current = node;
      drawFrame();
    }

    const mode = dragModeRef.current;
    if (mode !== null && node !== null && node !== lastPaintedRef.current) {
      lastPaintedRef.current = node;
      applyDragAtNode(mode, node);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragModeRef.current === null) return;

    if (
      dragModeRef.current === 'connect-edge' &&
      draftEdgeRef.current !== null &&
      rendererRef.current &&
      problemRef.current.kind === 'graph'
    ) {
      const target = rendererRef.current.hitTest(problemRef.current, e.clientX, e.clientY);
      const source = draftEdgeRef.current.from;
      if (target !== null && target !== source) {
        onGraphEditRef.current({ type: 'add-edge', u: source, v: target });
      }
    }

    dragModeRef.current = null;
    draggedVertexRef.current = null;
    draftEdgeRef.current = null;
    lastPaintedRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    updateCursor(hoverNodeRef.current);
    drawFrame();
  };

  const handlePointerLeave = () => {
    if (hoverNodeRef.current !== null) {
      hoverNodeRef.current = null;
      updateCursor(null);
      drawFrame();
    }
  };

  const handleWeightSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!weightEditor) return;
    const parsed = Number(weightInput);
    if (!Number.isFinite(parsed)) return;
    onGraphEdit({
      type: 'set-edge-weight',
      u: weightEditor.u,
      v: weightEditor.v,
      cost: parsed,
    });
    setWeightEditor(null);
  };

  const handleDeleteSelectedEdge = () => {
    if (!weightEditor) return;
    onGraphEdit({ type: 'remove-edge', u: weightEditor.u, v: weightEditor.v });
    setWeightEditor(null);
  };

  return (
    <div ref={stageRef} className="canvas-stage">
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />

      {weightEditor && (
        <form
          className="edge-weight-popover"
          style={{ left: weightEditor.left, top: weightEditor.top }}
          onSubmit={handleWeightSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setWeightEditor(null);
            }
          }}
        >
          <span className="edge-weight-label">
            {weightEditor.u}→{weightEditor.v}
          </span>
          <input
            ref={weightInputRef}
            className="edge-weight-input"
            type="number"
            step="any"
            aria-label="Edge weight"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
          />
          <button type="submit">OK</button>
          <button
            type="button"
            aria-label="Remove edge"
            onClick={handleDeleteSelectedEdge}
          >
            Del
          </button>
        </form>
      )}
    </div>
  );
}
