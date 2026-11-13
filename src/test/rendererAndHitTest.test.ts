import { describe, expect, it } from 'vitest';
import { SearchCanvasRenderer } from '../canvas/renderer';
import type { AdjacencyGraphProblem } from '../engine/graphProblem';
import { Grid2DProblem } from '../engine/gridProblem';
import { buildPreset } from '../engine/presets';
import { runAlgorithm } from '../engine/runner';
import { TracePlayer } from '../engine/trace';

function createSizedCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: height });
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return canvas;
}

describe('SearchCanvasRenderer hitTest, coordinate mapping, and rendering', () => {
  it('maps grid pointer coordinates accurately and rejects out-of-bounds margins', () => {
    const canvas = createSizedCanvas(724, 444);
    const renderer = new SearchCanvasRenderer(canvas);
    const grid = buildPreset('weighted-swamp', false) as Grid2DProblem;

    const res = runAlgorithm((p, ctx) => {
      const q = ctx.queue();
      const parent = ctx.parentMap();
      q.push(p.start);
      const u = q.pop()!;
      for (const { node: v } of p.neighbors(u)) {
        parent.set(v, u);
        q.push(v);
      }
      return [p.start, p.goal];
    }, grid);
    const player = new TracePlayer(res.trace);
    player.seek(player.length);

    renderer.render(grid, player.states, {
      path: res.path,
      showPathLine: true,
      parents: player.parents,
      showGridTree: true,
      hoverNode: grid.start,
    });

    // Padding is 12px on 724x444 -> 700x420 grid -> 20px cells starting at (12, 12).
    expect(renderer.hitTest(grid, 15, 15)).toBe(0);
    expect(renderer.hitTest(grid, 35, 35)).toBe(grid.toId(1, 1));
    // Margin outside grid returns null.
    expect(renderer.hitTest(grid, 2, 2)).toBeNull();
    expect(renderer.hitTest(grid, 720, 440)).toBeNull();
  });

  it('hits graph vertices and clamps screenToGraphPosition inside bounds', () => {
    const canvas = createSizedCanvas(688, 488);
    const renderer = new SearchCanvasRenderer(canvas);
    const graph = buildPreset('sample-graph', false) as AdjacencyGraphProblem;

    const res = runAlgorithm((p, ctx) => {
      const q = ctx.queue();
      const parent = ctx.parentMap();
      q.push(p.start);
      const cur = q.pop()!;
      for (const { node: v } of p.neighbors(cur)) {
        parent.set(v, cur);
        q.push(v);
      }
      return [p.start, 2, 4, p.goal];
    }, graph);
    const player = new TracePlayer(res.trace);
    player.seek(Math.max(1, player.length - 1));

    renderer.render(graph, player.states, {
      path: res.path,
      showPathLine: false,
      parents: player.parents,
      currentNode: player.currentNode,
      activeEdgeFrom: player.activeEdgeFrom,
      activeEdgeTo: player.activeEdgeTo,
      hoverNode: 4,
      dragNode: 4,
    });

    // Vertex 0 is at (8, 50) in [0..100] with pad=44 on 688x488 -> span 600x400 -> (44 + 48, 44 + 200) = (92, 244).
    expect(renderer.hitTest(graph, 92, 244)).toBe(0);
    expect(renderer.hitTest(graph, 5, 5)).toBeNull();

    // Dragging past top-left corner clamps inside [3, 97] bounds.
    const clampedMin = renderer.screenToGraphPosition(-100, -100)!;
    expect(clampedMin.x).toBeGreaterThanOrEqual(3);
    expect(clampedMin.y).toBeGreaterThanOrEqual(3);

    const clampedMax = renderer.screenToGraphPosition(2000, 2000)!;
    expect(clampedMax.x).toBeLessThanOrEqual(97);
    expect(clampedMax.y).toBeLessThanOrEqual(97);
  });

  it('hits straight and curved directed edges via edgeHitTest and renders grid weight tiers cleanly', () => {
    const canvas = createSizedCanvas(688, 488);
    const renderer = new SearchCanvasRenderer(canvas);
    const directed = buildPreset('directed-graph', false) as AdjacencyGraphProblem;

    renderer.render(directed, directed.initialStates(), {
      selectedEdge: { u: 0, v: 1 },
      draftEdge: { from: 0, toX: 250, toY: 180 },
    });

    // Edge 0 -> 1 goes from (10, 50) to (34, 22) -> midpoint (22, 36) -> screen (44+132, 44+144) = (176, 188).
    const hit = renderer.edgeHitTest(directed, 176, 188);
    expect(hit).not.toBeNull();
    expect(hit!.u).toBe(0);
    expect(hit!.v).toBe(1);
    expect(hit!.cost).toBe(36);

    // Bidirectional pair 1 <-> 2 offsets two distinct curved edges on screen.
    // Vertex 1: (34, 22)->(248, 132), Vertex 2: (34, 78)->(248, 356). Midpoint ~248, 244; curve offsets ±11px.
    const curvedRight = renderer.edgeHitTest(directed, 237, 244);
    const curvedLeft = renderer.edgeHitTest(directed, 259, 244);
    expect(curvedRight).not.toBeNull();
    expect(curvedLeft).not.toBeNull();
    expect(curvedRight!.u).not.toBe(curvedLeft!.u);

    // Grid edgeHitTest always returns null; 2x/5x/10x grid weights render without errors.
    const grid = (buildPreset('open-field', false) as Grid2DProblem);
    const wGrid = new Grid2DProblem({
      cols: grid.cols,
      rows: grid.rows,
      start: { x: 0, y: 0 },
      goal: { x: 10, y: 10 },
      weights: Float32Array.from({ length: grid.nodeCount }, (_, idx) =>
        idx === 1 ? 2 : idx === 2 ? 5 : idx === 3 ? 10 : 1,
      ),
    });
    renderer.render(wGrid, wGrid.initialStates(), {});
    expect(renderer.edgeHitTest(wGrid, 100, 100)).toBeNull();
  });
});
