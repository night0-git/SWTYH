import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../components/App';

function mockCanvasBox(canvas: HTMLCanvasElement, width: number, height: number): void {
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
}

describe('<App /> UI integration', () => {
  it('supports stepping, scrubbing, resetting, and inspecting live containers', () => {
    render(<App />);

    expect(screen.getByRole('combobox', { name: 'Algorithm' })).toBeTruthy();
    expect(screen.getByText('src/algorithms/informed/astar.ts')).toBeTruthy();
    expect(screen.getByText('0 / 0')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+1' }));
    const stepText = screen.getByText(/^\d+ \/ \d+$/).textContent!;
    expect(stepText.startsWith('1 / ')).toBe(true);
    expect(document.querySelector('.containers-panel')?.textContent).toContain('[MIN-HEAP]');

    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    const endCounter = screen.getByText(/^\d+ \/ \d+$/).textContent!;
    const [cur, total] = endCounter.split(' / ').map(Number);
    expect(cur).toBe(total);
    expect(total).toBeGreaterThan(10);

    const scrubber = screen.getByRole('slider', { name: 'Trace step scrubber' }) as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: '5' } });
    expect(screen.getByText(`5 / ${total}`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText(`0 / ${total}`)).toBeTruthy();
    expect(document.querySelector('.containers-panel')?.textContent).toContain('empty');
  });

  it('recomputes replay state cleanly when erasing a wall after End and mid-replay', () => {
    render(<App />);

    // Select BFS and size canvas so cells are exactly 20x20 starting at (12, 12).
    fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
      target: { value: 'bfs' },
    });
    const canvas = document.querySelector('canvas')!;
    mockCanvasBox(canvas, 724, 444);
    // Trigger resize-independent render pass via diagonal toggle twice or step.
    fireEvent.click(screen.getByRole('button', { name: 'End' }));

    const pathNodesBefore = document.querySelectorAll('.telemetry-value')[1]?.textContent;
    expect(pathNodesBefore).toBe('37');

    // Erase the middle barrier wall at (19, 10) -> screen center (12 + 19.5*20, 12 + 10.5*20) = (402, 222).
    fireEvent.pointerDown(canvas, { clientX: 402, clientY: 222, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 402, clientY: 222, button: 0, pointerId: 1 });

    const pathNodesAfter = Number(document.querySelectorAll('.telemetry-value')[1]?.textContent);
    expect(pathNodesAfter).toBeLessThan(37);

    // Counter should stay pinned to the new End length, not stale length.
    const counterText = screen.getByText(/^\d+ \/ \d+$/).textContent!;
    const [cur, total] = counterText.split(' / ').map(Number);
    expect(cur).toBe(total);

    // Paint the wall back while paused mid-replay (at step 10).
    const scrubber = screen.getByRole('slider', { name: 'Trace step scrubber' }) as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: '10' } });
    fireEvent.pointerDown(canvas, { clientX: 402, clientY: 222, button: 0, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: 402, clientY: 222, button: 0, pointerId: 2 });

    expect(screen.getByText(/^10 \/ \d+$/)).toBeTruthy();
    expect(document.querySelectorAll('.telemetry-value')[1]?.textContent).toBe('37');
  });

  it('switches between Grid, Maze, and Graph modes and supports dragging graph vertices', () => {
    render(<App />);

    // Grid controls sit in the dedicated centered second row below primary selectors.
    const wallBtn = screen.getByRole('button', { name: 'Wall' });
    const treeBtn = screen.getByRole('button', { name: 'Tree' });
    expect(wallBtn.closest('.topbar-tools')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Algorithm' }).closest('.topbar-main')).toBeTruthy();
    expect(wallBtn).toBeTruthy();
    expect(treeBtn).toBeTruthy();
    const legendLabels = () =>
      Array.from(document.querySelectorAll('.legend .legend-item')).map((el) => el.textContent);
    expect(legendLabels()).toEqual([
      'Start',
      'Goal',
      'Wall',
      'Weight',
      'Frontier',
      'Current',
      'Visited',
      'Path',
    ]);

    // Switch to Generated Maze -> Regen button appears.
    fireEvent.change(screen.getByRole('combobox', { name: 'Problem' }), {
      target: { value: 'random-maze' },
    });
    expect(screen.getByRole('button', { name: 'Regen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Regen' }));
    expect(screen.getByText('0 / 0')).toBeTruthy();

    // Switch to Weighted Graph -> Grid-only controls and Grid-only legend items hide.
    fireEvent.change(screen.getByRole('combobox', { name: 'Problem' }), {
      target: { value: 'sample-graph' },
    });
    expect(screen.queryByRole('button', { name: 'Wall' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tree' })).toBeNull();
    expect(legendLabels()).toEqual(['Start', 'Goal', 'Frontier', 'Current', 'Visited', 'Path']);

    const canvas = document.querySelector('canvas')!;
    mockCanvasBox(canvas, 688, 488);
    fireEvent.click(screen.getByRole('button', { name: 'End' }));

    // Vertex 0 sits at (92, 244) on 688x488; drag it smoothly.
    fireEvent.pointerDown(canvas, { clientX: 92, clientY: 244, button: 0, pointerId: 3 });
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 200, button: 0, pointerId: 3 });
    fireEvent.pointerUp(canvas, { clientX: 120, clientY: 200, button: 0, pointerId: 3 });

    const counterText = screen.getByText(/^\d+ \/ \d+$/).textContent!;
    const [cur, total] = counterText.split(' / ').map(Number);
    expect(cur).toBe(total);
    expect(total).toBeGreaterThan(0);
  });

  it('handles keyboard shortcuts globally while ignoring input/select targets', () => {
    render(<App />);

    fireEvent.keyDown(window, { code: 'ArrowRight' });
    expect(screen.getByText(/^1 \/ \d+$/)).toBeTruthy();

    fireEvent.keyDown(window, { code: 'ArrowLeft' });
    expect(screen.getByText(/^0 \/ \d+$/)).toBeTruthy();

    // Events targeted at <select> must not hijack Space / ArrowRight.
    const algoSelect = screen.getByRole('combobox', { name: 'Algorithm' });
    fireEvent.keyDown(algoSelect, { code: 'ArrowRight' });
    expect(screen.getByText(/^0 \/ \d+$/)).toBeTruthy();

    fireEvent.keyDown(window, { code: 'Space' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

    fireEvent.keyDown(window, { code: 'Space' });
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('displays boxed container op badges when stepping through graph traversal', () => {
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
      target: { value: 'bfs' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Problem' }), {
      target: { value: 'sample-graph' },
    });

    const badgeTexts = () =>
      Array.from(document.querySelectorAll('.container-op-badge')).map((el) => el.textContent);

    fireEvent.keyDown(window, { code: 'ArrowRight' });
    expect(badgeTexts()).toEqual(['PUSH S', 'ADD S']);

    fireEvent.keyDown(window, { code: 'ArrowRight' });
    expect(badgeTexts()).toEqual(['POP S']);

    fireEvent.keyDown(window, { code: 'ArrowRight' });
    expect(badgeTexts()).toEqual(['PUSH #1', 'ADD #1']);

    fireEvent.keyDown(window, { code: 'ArrowLeft' });
    expect(badgeTexts()).toEqual(['POP S']);
  });

  it('paces playback by elapsed time rather than monitor frame rate', () => {
    let nowMs = 1000;
    let nextRafId = 1;
    let rafMap = new Map<number, FrameRequestCallback>();
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        const id = nextRafId;
        nextRafId += 1;
        rafMap.set(id, cb);
        return id;
      });
    const cancelSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id) => {
        rafMap.delete(id);
      });

    const tickFrame = (deltaMs: number) => {
      nowMs += deltaMs;
      const pending = Array.from(rafMap.values());
      rafMap = new Map();
      for (const cb of pending) cb(nowMs);
    };

    try {
      render(<App />);
      // Default speed is 1x (1 step/sec).
      const speedSelect = screen.getByRole('combobox', {
        name: 'Playback speed',
      }) as HTMLSelectElement;
      expect(speedSelect.value).toBe('1');

      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
      // First frame advances 1 immediate step for responsive feedback.
      tickFrame(16);
      expect(screen.getByText(/^1 \/ \d+$/)).toBeTruthy();

      // Half a second later at 1x, still on step 1.
      for (let i = 0; i < 5; i += 1) tickFrame(100);
      expect(screen.getByText(/^1 \/ \d+$/)).toBeTruthy();

      // After 1 second total elapsed, step 2 advances.
      for (let i = 0; i < 5; i += 1) tickFrame(100);
      expect(screen.getByText(/^2 \/ \d+$/)).toBeTruthy();

      // Switching to 0.25x (4s/step) slows further: 1s later stays on step 2.
      fireEvent.change(speedSelect, { target: { value: '0.25' } });
      for (let i = 0; i < 10; i += 1) tickFrame(100);
      expect(screen.getByText(/^2 \/ \d+$/)).toBeTruthy();
    } finally {
      nowSpy.mockRestore();
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    }
  });

  it('surfaces pre-run & post-run compatibility warnings for mismatched algorithm and graph types', () => {
    render(<App />);

    // Select BFS + Weighted Network -> pre-run warning appears immediately.
    fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
      target: { value: 'bfs' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Problem' }), {
      target: { value: 'sample-graph' },
    });

    const banner = screen.getByRole('status', { name: 'Compatibility warning' });
    expect(banner.textContent).toContain('ignores edge weights');

    // Run to End -> post-run suboptimal comparison appears (125 vs 103).
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(screen.getByRole('status', { name: 'Compatibility warning' }).textContent).toContain(
      'Suboptimal path',
    );

    // Toggling Graph to Unweighted resolves both BFS warnings cleanly.
    fireEvent.click(screen.getByRole('button', { name: 'Weighted' }));
    expect(screen.queryByRole('status', { name: 'Compatibility warning' })).toBeNull();
  });

  it('shows Grid variable weight brush options and Graph customization + edge-weight popover safely', () => {
    render(<App />);

    // Grid variable weight brush selector appears when Weight is selected.
    fireEvent.click(screen.getByRole('button', { name: 'Weight 5x' }));
    fireEvent.click(screen.getByRole('button', { name: '10x' }));
    expect(screen.getByRole('button', { name: 'Weight 10x' })).toBeTruthy();

    // Switch to Graph · Weighted Network -> Graph toolset and mode toggles appear.
    fireEvent.change(screen.getByRole('combobox', { name: 'Problem' }), {
      target: { value: 'sample-graph' },
    });
    expect(screen.getByRole('group', { name: 'Graph tool' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Undirected' }));
    expect(screen.getByRole('button', { name: 'Directed' })).toBeTruthy();

    // Mock canvas sizing so edge hit-testing can open the inline weight popover on click.
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 688,
        bottom: 488,
        width: 688,
        height: 488,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 688 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 488 });
    // Trigger ResizeObserver / initial layout via switching back to Undirected Weighted sample-graph.
    fireEvent.change(screen.getByRole('combobox', { name: 'Problem' }), {
      target: { value: 'negative-edge-graph' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
      target: { value: 'astar' },
    });

    // Trigger ResizeObserver? Let's dispatch pointerDown directly after triggering render via select/click:
    fireEvent.click(screen.getByRole('button', { name: 'Directed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undirected' }));

    // Vertex 0 is (10,50)->(104,244), vertex 1 is (42,22)->(296,132) -> midpoint (200, 188).
    fireEvent.pointerDown(canvas, { button: 0, clientX: 200, clientY: 188, pointerId: 1 });
    const weightInput = screen.getByRole('spinbutton', {
      name: 'Edge weight',
    }) as HTMLInputElement;
    expect(weightInput).toBeTruthy();

    // Typing Space inside the edge-weight input must NOT start playback.
    fireEvent.keyDown(weightInput, { code: 'Space' });
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();

    // Submitting a negative edge weight updates graph & preserves negative-weight warning.
    fireEvent.change(weightInput, { target: { value: '-15' } });
    fireEvent.submit(weightInput.closest('form')!);
    expect(screen.queryByRole('spinbutton', { name: 'Edge weight' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Compatibility warning' }).textContent).toContain(
      'negative edge weights',
    );

    // Clicking Clear Edges removes edges, and Reset Preset restores original preset edges cleanly.
    fireEvent.click(screen.getByRole('button', { name: 'Clear Edges' }));
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(screen.getByText('Path Nodes').nextSibling?.textContent).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Reset Preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(screen.getByText('Path Nodes').nextSibling?.textContent).not.toBe('none');
  });

  it('extracts clean algorithm code, highlights active lines on step/reset, and supports sidebar/section resize & expand', () => {
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
      target: { value: 'bfs' },
    });

    // Extracted code omits import/meta noise and starts directly at export function search.
    const codeRows = () => Array.from(document.querySelectorAll('.code-table tbody tr'));
    expect(codeRows()[0]?.textContent).toContain('export function search');
    expect(document.querySelector('.code-table')?.textContent).not.toContain('import type');
    expect(document.querySelector('.code-table')?.textContent).not.toContain('export const meta');

    // Stepping highlights active line(s) in code panel; Reset clears highlights.
    fireEvent.keyDown(window, { code: 'ArrowRight' });
    const highlightedAfterStep1 = document.querySelectorAll('.code-table tr.is-active-line');
    expect(highlightedAfterStep1.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(document.querySelectorAll('.code-table tr.is-active-line').length).toBe(0);

    // Drag sidebar resizer horizontally and double-click to reset default layout.
    const workspace = document.querySelector('.workspace') as HTMLElement;
    const sidebarResizer = screen.getByRole('separator', { name: 'Resize sidebar' });
    workspace.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(sidebarResizer, { button: 0, clientX: 760 });
    fireEvent.pointerMove(window, { clientX: 680 });
    fireEvent.pointerUp(window);
    expect(workspace.style.gridTemplateColumns).toBe('1fr 520px');

    fireEvent.doubleClick(sidebarResizer);
    expect(workspace.style.gridTemplateColumns).toBe('');

    // Drag section resizer vertically between Algorithm and Code sections.
    const inspector = document.querySelector('.inspector-pane') as HTMLElement;
    const sectionResizer = screen.getByRole('separator', {
      name: 'Resize algorithm and code sections',
    });
    inspector.getBoundingClientRect = () =>
      ({ left: 760, top: 42, right: 1200, bottom: 800, width: 440, height: 758, x: 760, y: 42, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(sectionResizer, { button: 0, clientY: 320 });
    fireEvent.pointerMove(window, { clientY: 442 });
    fireEvent.pointerUp(window);
    expect(inspector.style.gridTemplateRows).toBe('400px auto 1fr');

    fireEvent.doubleClick(sectionResizer);
    expect(inspector.style.gridTemplateRows).toBe('');

    // Maximize Code -> Algorithm collapses to just its name title + Restore button.
    fireEvent.keyDown(window, { code: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Maximize code section' }));
    expect(document.querySelector('.algorithm-section.is-collapsed')?.textContent).toContain(
      'Breadth-First Search',
    );
    expect(screen.queryByText('Path Nodes')).toBeNull();
    expect(document.querySelector('.code-scroll')).toBeTruthy();

    // Restore split -> both sections visible again; then Maximize Algorithm -> Code collapses to title only.
    fireEvent.click(screen.getByRole('button', { name: 'Restore split view from code' }));
    expect(screen.getByText('Path Nodes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Maximize algorithm section' }));
    expect(document.querySelector('.code-scroll')).toBeNull();
    expect(document.querySelector('.code-header-title')?.textContent).toContain('algorithms/uninformed/bfs.ts');
    expect(screen.getByText('Path Nodes')).toBeTruthy();

    // Restoring split re-syncs code highlight immediately.
    fireEvent.click(screen.getByRole('button', { name: 'Restore split view from algorithm' }));
    expect(document.querySelectorAll('.code-table tr.is-active-line').length).toBeGreaterThan(0);
  });

  it('updates grid cursor hover highlight immediately during slow replay without rebuilding sidebar DOM', () => {
    let nowMs = 1000;
    let nextRafId = 1;
    let rafMap = new Map<number, FrameRequestCallback>();
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        const id = nextRafId;
        nextRafId += 1;
        rafMap.set(id, cb);
        return id;
      });
    const cancelSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id) => {
        rafMap.delete(id);
      });

    try {
      render(<App />);
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const legend = document.querySelector('.legend') as HTMLElement;
      const transportBar = document.querySelector('.transport-bar') as HTMLElement;
      expect(legend).toBeTruthy();
      expect(canvas.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        legend.compareDocumentPosition(transportBar) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      mockCanvasBox(canvas, 600, 400);

      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
      // Advance just enough for step 1; at 1x speed the next step won't fire for ~1000ms.
      nowMs += 16;
      const pending = Array.from(rafMap.values());
      rafMap = new Map();
      for (const cb of pending) cb(nowMs);

      const containerBefore = document.querySelector('.containers-panel .container-card');
      const hoverEl = document.querySelector('.hover-readout') as HTMLElement;

      fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60 });
      const firstHover = hoverEl.textContent;
      expect(firstHover).toMatch(/^cell \(\d+, \d+\)/);
      expect(hoverEl.title).toBe(firstHover);

      fireEvent.pointerMove(canvas, { clientX: 280, clientY: 220 });
      const secondHover = hoverEl.textContent;
      expect(secondHover).toMatch(/^cell \(\d+, \d+\)/);
      expect(secondHover).not.toBe(firstHover);
      expect(hoverEl.title).toBe(secondHover);

      // Container cards must not be rebuilt on pure pointer hover.
      expect(document.querySelector('.containers-panel .container-card')).toBe(containerBefore);

      fireEvent.pointerLeave(canvas);
      expect(hoverEl.textContent).toBe('hover: —');
      expect(hoverEl.title).toBe('hover: —');
    } finally {
      nowSpy.mockRestore();
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    }
  });
});
