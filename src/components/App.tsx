import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { evaluateCompatibility } from '../engine/compatibility';
import type { AdjacencyGraphProblem } from '../engine/graphProblem';
import { PRESETS, type PresetId } from '../engine/presets';
import { groupAlgorithmsByCategory } from '../engine/registry';
import type { NodeId, Point2D } from '../engine/types';
import { CodeView, syncCodeHighlightDom } from './CodeView';
import { ContainerView, syncContainersDom } from './ContainerView';
import {
  createInitialSimulationState,
  resolveSelectedAlgorithm,
  simulationReducer,
  type GraphEdit,
  type GraphTool,
  type GridEdit,
  type WeightBrush,
} from './simulationState';
import { Viewport } from './Viewport';

const SPEED_OPTIONS = [
  { label: '0.25x', stepsPerSecond: 0.25 },
  { label: '0.5x', stepsPerSecond: 0.5 },
  { label: '1x', stepsPerSecond: 1 },
  { label: '4x', stepsPerSecond: 4 },
  { label: '16x', stepsPerSecond: 16 },
  { label: '64x', stepsPerSecond: 64 },
  { label: '256x', stepsPerSecond: 256 },
] as const;

const WEIGHT_BRUSHES: readonly WeightBrush[] = [2, 5, 10];

const GRAPH_TOOL_OPTIONS: readonly { readonly id: GraphTool; readonly label: string }[] = [
  { id: 'move', label: 'Move' },
  { id: 'add-node', label: '+Node' },
  { id: 'add-edge', label: '+Edge' },
  { id: 'erase', label: 'Erase' },
  { id: 'set-start', label: 'Set S' },
  { id: 'set-goal', label: 'Set G' },
];

interface LegendItem {
  readonly label: string;
  readonly varName: string;
  readonly gridOnly?: boolean;
}

const LEGEND_ITEMS: readonly LegendItem[] = [
  { label: 'Start', varName: '--state-start' },
  { label: 'Goal', varName: '--state-goal' },
  { label: 'Wall', varName: '--state-wall', gridOnly: true },
  { label: 'Weight', varName: '--state-weight', gridOnly: true },
  { label: 'Frontier', varName: '--state-frontier' },
  { label: 'Current', varName: '--state-current' },
  { label: 'Visited', varName: '--state-visited' },
  { label: 'Path', varName: '--state-path' },
];

export function App() {
  const categories = useMemo(() => Array.from(groupAlgorithmsByCategory().entries()), []);
  const [state, dispatch] = useReducer(
    simulationReducer,
    undefined,
    createInitialSimulationState,
  );

  const scrubberRef = useRef<HTMLInputElement | null>(null);
  const stepCounterRef = useRef<HTMLSpanElement | null>(null);
  const hoverLabelRef = useRef<HTMLSpanElement | null>(null);
  const containerHostRef = useRef<HTMLDivElement | null>(null);
  const codeBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const [algoHeight, setAlgoHeight] = useState<number | null>(null);
  const [expandedPane, setExpandedPane] = useState<'algorithm' | 'code' | null>(null);

  const playerRef = useRef(state.player);
  playerRef.current = state.player;

  const selected = resolveSelectedAlgorithm(state.selectedId);

  const handlePlayToggle = useCallback(() => {
    const active = playerRef.current;
    dispatch({
      type: 'play-toggle',
      currentCursor: active ? active.cursor : 0,
      isAtEnd: active ? active.isAtEnd : false,
    });
  }, []);

  const handleStep = useCallback((delta: number) => {
    const active = playerRef.current;
    dispatch({
      type: 'step',
      delta,
      currentCursor: active ? active.cursor : 0,
    });
  }, []);

  const handleGridEdit = useCallback((edit: GridEdit) => {
    const active = playerRef.current;
    dispatch({
      type: 'grid-edit',
      edit,
      currentCursor: active ? active.cursor : 0,
      wasAtEnd: active ? active.isAtEnd : false,
    });
  }, []);

  const handleMoveVertex = useCallback((node: NodeId, pos: Point2D) => {
    const active = playerRef.current;
    dispatch({
      type: 'move-vertex',
      node,
      pos,
      currentCursor: active ? active.cursor : 0,
      wasAtEnd: active ? active.isAtEnd : false,
    });
  }, []);

  const handleGraphEdit = useCallback((edit: GraphEdit) => {
    const active = playerRef.current;
    dispatch({
      type: 'graph-edit',
      edit,
      currentCursor: active ? active.cursor : 0,
      wasAtEnd: active ? active.isAtEnd : false,
    });
  }, []);

  const handlePlaybackComplete = useCallback((cursor: number) => {
    dispatch({ type: 'playback-complete', cursor });
  }, []);

  const handleToggleSkipIntermediate = useCallback(() => {
    const active = playerRef.current;
    dispatch({
      type: 'toggle-skip-intermediate',
      currentCursor: active ? active.cursor : 0,
      wasAtEnd: active ? active.isAtEnd : false,
    });
  }, []);

  const handleToggleGridTree = useCallback(() => {
    const active = playerRef.current;
    dispatch({
      type: 'toggle-grid-tree',
      currentCursor: active ? active.cursor : 0,
      wasAtEnd: active ? active.isAtEnd : false,
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayToggle();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleStep(1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleStep(-1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePlayToggle, handleStep]);

  const { runResult, player, problem, playing } = state;
  const compatibility = useMemo(
    () => evaluateCompatibility(selected, problem, runResult),
    [selected, problem, runResult],
  );
  const traceLength = player ? player.length : 0;

  useEffect(() => {
    syncContainersDom(containerHostRef.current, player, problem);
    syncCodeHighlightDom(codeBodyRef.current, player);
  }, [expandedPane, selected?.meta.id, player, problem]);

  const handleSidebarResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const onMove = (ev: PointerEvent) => {
        const rect = workspaceRef.current?.getBoundingClientRect();
        const right = rect ? rect.right : window.innerWidth;
        const totalW = rect ? rect.width : window.innerWidth;
        const maxW = totalW > 0 ? Math.max(320, totalW - 320) : 760;
        const nextW = Math.round(Math.max(280, Math.min(maxW, right - ev.clientX)));
        setSidebarWidth(nextW);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [],
  );

  const handleSectionResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const onMove = (ev: PointerEvent) => {
        const rect = inspectorRef.current?.getBoundingClientRect();
        const top = rect ? rect.top : 0;
        const totalH = rect ? rect.height : window.innerHeight;
        const maxH = totalH > 0 ? Math.max(80, totalH - 48) : 640;
        const nextH = Math.round(Math.max(48, Math.min(maxH, ev.clientY - top)));
        setAlgoHeight(nextH);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [],
  );
  const costDisplay = runResult
    ? runResult.path
      ? Number.isNaN(runResult.stats.pathCost)
        ? 'invalid'
        : Number.isInteger(runResult.stats.pathCost)
          ? String(runResult.stats.pathCost)
          : runResult.stats.pathCost.toFixed(1)
      : '—'
    : '—';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-main">
          <span className="topbar-title">SWTYH</span>

          <div className="control-group">
            <label className="field-label" htmlFor="algo-select">
              Algorithm
            </label>
            <select
              id="algo-select"
              value={selected?.meta.id ?? ''}
              onChange={(e) => dispatch({ type: 'select-algorithm', id: e.target.value })}
            >
              {categories.map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map((entry) => (
                    <option key={entry.meta.id} value={entry.meta.id}>
                      {entry.meta.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label className="field-label" htmlFor="preset-select">
              Problem
            </label>
            <select
              id="preset-select"
              value={state.presetId}
              onChange={(e) =>
                dispatch({ type: 'select-preset', presetId: e.target.value as PresetId })
              }
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => dispatch({ type: 'reset-preset' })}
            >
              Reset Preset
            </button>
            {state.presetId === 'random-maze' && (
              <button type="button" onClick={() => dispatch({ type: 'regen-maze' })}>
                Regen
              </button>
            )}
          </div>

          <label className="topbar-checkbox">
            <input
              type="checkbox"
              checked={state.skipIntermediateSteps}
              onChange={handleToggleSkipIntermediate}
            />
            <span>Skip intermediate steps</span>
          </label>
        </div>

        <div className="topbar-tools">
          {problem.kind === 'grid' ? (
          <>
            <div className="control-group segmented" role="group" aria-label="Draw tool">
              <button
                type="button"
                className={state.drawTool === 'wall' ? 'is-active' : undefined}
                onClick={() => dispatch({ type: 'set-draw-tool', tool: 'wall' })}
              >
                Wall
              </button>
              <button
                type="button"
                className={state.drawTool === 'weight' ? 'is-active' : undefined}
                onClick={() => dispatch({ type: 'set-draw-tool', tool: 'weight' })}
              >
                Weight {state.weightBrush}x
              </button>
              <button
                type="button"
                className={state.drawTool === 'erase' ? 'is-active' : undefined}
                onClick={() => dispatch({ type: 'set-draw-tool', tool: 'erase' })}
              >
                Erase
              </button>
            </div>

            {state.drawTool === 'weight' && (
              <div
                className="control-group segmented"
                role="group"
                aria-label="Weight multiplier"
              >
                {WEIGHT_BRUSHES.map((brush) => (
                  <button
                    key={brush}
                    type="button"
                    className={state.weightBrush === brush ? 'is-active' : undefined}
                    onClick={() => dispatch({ type: 'set-weight-brush', brush })}
                  >
                    {brush}x
                  </button>
                ))}
              </div>
            )}

            <div className="control-group">
              <button
                type="button"
                onClick={() => dispatch({ type: 'toggle-diagonal' })}
              >
                {state.allowDiagonal ? '8-way' : '4-way'}
              </button>
              <button
                type="button"
                className={state.showGridTree ? 'is-active' : undefined}
                onClick={handleToggleGridTree}
              >
                Tree
              </button>
              <button type="button" onClick={() => dispatch({ type: 'clear-grid' })}>
                Clear
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="control-group segmented" role="group" aria-label="Graph tool">
              {GRAPH_TOOL_OPTIONS.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className={state.graphTool === tool.id ? 'is-active' : undefined}
                  onClick={() => dispatch({ type: 'set-graph-tool', tool: tool.id })}
                >
                  {tool.label}
                </button>
              ))}
            </div>

            <div className="control-group">
              <button
                type="button"
                className={(problem as AdjacencyGraphProblem).directed ? 'is-active' : undefined}
                onClick={() => handleGraphEdit({ type: 'toggle-directed' })}
              >
                {(problem as AdjacencyGraphProblem).directed ? 'Directed' : 'Undirected'}
              </button>
              <button
                type="button"
                className={(problem as AdjacencyGraphProblem).weighted ? 'is-active' : undefined}
                onClick={() => handleGraphEdit({ type: 'toggle-weighted' })}
              >
                {(problem as AdjacencyGraphProblem).weighted ? 'Weighted' : 'Unweighted'}
              </button>
              <button
                type="button"
                onClick={() => handleGraphEdit({ type: 'clear-edges' })}
              >
                Clear Edges
              </button>
            </div>
          </>
        )}
        </div>
      </header>

      <main
        ref={workspaceRef}
        className="workspace"
        style={
          sidebarWidth !== null
            ? ({ gridTemplateColumns: `1fr ${sidebarWidth}px` } as CSSProperties)
            : undefined
        }
      >
        <section className="viewport-column">
          <Viewport
            problem={problem}
            player={player}
            path={runResult?.path ?? null}
            playing={playing}
            stepsPerSecond={state.stepsPerSecond}
            showGridTree={state.showGridTree}
            renderTick={state.renderTick}
            drawTool={state.drawTool}
            weightBrush={state.weightBrush}
            graphTool={state.graphTool}
            scrubberRef={scrubberRef}
            stepCounterRef={stepCounterRef}
            hoverLabelRef={hoverLabelRef}
            containerHostRef={containerHostRef}
            codeBodyRef={codeBodyRef}
            onGridEdit={handleGridEdit}
            onMoveVertex={handleMoveVertex}
            onGraphEdit={handleGraphEdit}
            onPlaybackComplete={handlePlaybackComplete}
          />

          <div className="legend">
            {LEGEND_ITEMS.filter(
              (item) => !item.gridOnly || problem.kind === 'grid',
            ).map((item) => (
              <span key={item.label} className="legend-item">
                <span
                  className="legend-swatch"
                  style={{ background: `var(${item.varName})` }}
                />
                {item.label}
              </span>
            ))}
          </div>

          <div className="transport-bar">
            <div className="control-group">
              <button
                type="button"
                className="btn-primary"
                onClick={handlePlayToggle}
                disabled={!selected}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button type="button" onClick={() => handleStep(-1)} disabled={!selected}>
                -1
              </button>
              <button type="button" onClick={() => handleStep(1)} disabled={!selected}>
                +1
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'jump-end' })}
                disabled={!selected}
              >
                End
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'reset' })}
                disabled={!player}
              >
                Reset
              </button>
            </div>

            <input
              ref={scrubberRef}
              className="scrubber"
              type="range"
              aria-label="Trace step scrubber"
              min={0}
              max={traceLength}
              defaultValue={0}
              disabled={!player || traceLength === 0}
              onChange={(e) =>
                dispatch({ type: 'scrub', cursor: Number(e.target.value) })
              }
            />

            <span ref={stepCounterRef} className="step-counter">
              0 / 0
            </span>

            <select
              aria-label="Playback speed"
              value={state.stepsPerSecond}
              onChange={(e) =>
                dispatch({
                  type: 'set-speed',
                  stepsPerSecond: Number(e.target.value),
                })
              }
            >
              {SPEED_OPTIONS.map((opt) => (
                <option key={opt.stepsPerSecond} value={opt.stepsPerSecond}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="status-strip">
            <span ref={hoverLabelRef} className="hover-readout" title="hover: —">
              hover: —
            </span>
          </div>
        </section>

        <aside
          ref={inspectorRef}
          className="inspector-pane"
          style={
            expandedPane === 'algorithm'
              ? { gridTemplateRows: '1fr auto' }
              : expandedPane === 'code'
                ? { gridTemplateRows: 'auto 1fr' }
                : algoHeight !== null
                  ? { gridTemplateRows: `${algoHeight}px auto 1fr` }
                  : undefined
          }
        >
          <div
            className="sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={handleSidebarResizeStart}
            onDoubleClick={() => setSidebarWidth(null)}
          />

          <div
            className={
              expandedPane === 'code'
                ? 'algorithm-section is-collapsed'
                : algoHeight !== null || expandedPane === 'algorithm'
                  ? 'algorithm-section is-resizable'
                  : 'algorithm-section'
            }
          >
            {expandedPane === 'code' ? (
              <div className="meta-collapsed-bar">
                <h2>{selected?.meta.name ?? 'No algorithms found'}</h2>
                <button
                  type="button"
                  className="panel-toggle-btn"
                  aria-label="Restore algorithm section"
                  onClick={() => setExpandedPane(null)}
                >
                  Split
                </button>
              </div>
            ) : (
              <>
                <section className="inspector-meta">
                  <div className="meta-heading">
                    <div className="meta-title-row">
                      <h2>{selected?.meta.name ?? 'No algorithms found'}</h2>
                      <button
                        type="button"
                        className="panel-toggle-btn"
                        aria-label={
                          expandedPane === 'algorithm'
                            ? 'Restore split view from algorithm'
                            : 'Maximize algorithm section'
                        }
                        aria-pressed={expandedPane === 'algorithm'}
                        onClick={() =>
                          setExpandedPane((prev) =>
                            prev === 'algorithm' ? null : 'algorithm',
                          )
                        }
                      >
                        {expandedPane === 'algorithm' ? 'Split' : 'Full'}
                      </button>
                    </div>
                    {selected && (
                      <span className="meta-flags">
                        {selected.meta.category}
                        {selected.meta.weighted ? ' · weighted' : ' · unweighted'}
                        {selected.meta.usesHeuristic ? ' · heuristic' : ''}
                      </span>
                    )}
                  </div>

                  {selected?.meta.description && (
                    <p className="meta-desc">{selected.meta.description}</p>
                  )}

                  <div className="telemetry-grid">
                    <div className="telemetry-cell">
                      <span className="telemetry-label">Visited</span>
                      <span className="telemetry-value">
                        {runResult ? runResult.stats.visitedCount : '—'}
                      </span>
                    </div>
                    <div className="telemetry-cell">
                      <span className="telemetry-label">Path Nodes</span>
                      <span className="telemetry-value">
                        {runResult
                          ? runResult.path
                            ? runResult.stats.pathLength
                            : 'none'
                          : '—'}
                      </span>
                    </div>
                    <div className="telemetry-cell">
                      <span className="telemetry-label">Path Cost</span>
                      <span className="telemetry-value">{costDisplay}</span>
                    </div>
                    <div className="telemetry-cell">
                      <span className="telemetry-label">Compute</span>
                      <span className="telemetry-value">
                        {runResult ? `${runResult.stats.durationMs.toFixed(2)}ms` : '—'}
                      </span>
                    </div>
                  </div>

                  {compatibility.warnings.length > 0 && (
                    <div className="warning-banner" role="status" aria-label="Compatibility warning">
                      {compatibility.warnings.map((w) => (
                        <div key={w.code} className="warning-line">
                          <strong>Note:</strong> {w.message}
                        </div>
                      ))}
                    </div>
                  )}

                  {runResult?.error && <div className="error-banner">{runResult.error}</div>}
                </section>

                <ContainerView hostRef={containerHostRef} />
              </>
            )}
          </div>

          {expandedPane === null && (
            <div
              className="section-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize algorithm and code sections"
              onPointerDown={handleSectionResizeStart}
              onDoubleClick={() => setAlgoHeight(null)}
            />
          )}

          <CodeView
            filePath={selected?.filePath ?? ''}
            source={selected?.source ?? ''}
            tbodyRef={codeBodyRef}
            expanded={expandedPane === 'code'}
            collapsed={expandedPane === 'algorithm'}
            onToggleExpand={() =>
              setExpandedPane((prev) => (prev === 'code' ? null : 'code'))
            }
          />
        </aside>
      </main>
    </div>
  );
}
