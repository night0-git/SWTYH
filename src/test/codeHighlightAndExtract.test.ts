import { describe, expect, it } from 'vitest';
import { syncCodeHighlightDom } from '../components/CodeView';
import { instrumentAlgorithmSource } from '../engine/algorithmInstrument';
import { extractAlgorithmCode } from '../engine/codeExtract';
import { buildPreset } from '../engine/presets';
import { getAlgorithm } from '../engine/registry';
import { runAlgorithm } from '../engine/runner';
import { TracePlayer } from '../engine/trace';

describe('extractAlgorithmCode', () => {
  it('strips multiline imports and meta object while preserving helpers, search, and rawLine mapping', () => {
    const sample = [
      'import type {',
      '  AlgorithmMeta,',
      '  NodeId,',
      "} from '../../engine/types';",
      '',
      'export const meta: AlgorithmMeta = {',
      "  id: 'demo',",
      "  description: 'Contains {braces}; and text.',",
      '};',
      '',
      'function helper(x: number): number {',
      '  return x + 1;',
      '}',
      '',
      'export function search(problem, ctx) {',
      '  return [helper(0)];',
      '}',
    ].join('\n');

    const lines = extractAlgorithmCode(sample);
    expect(lines[0]).toEqual({
      displayLine: 1,
      rawLine: 11,
      text: 'function helper(x: number): number {',
    });
    expect(lines.some((l) => l.text.includes('import'))).toBe(false);
    expect(lines.some((l) => l.text.includes('export const meta'))).toBe(false);
    expect(lines[lines.length - 1]).toEqual({
      displayLine: 7,
      rawLine: 17,
      text: '}',
    });
  });
});

describe('instrumentAlgorithmSource and runtime TraceStep.lines', () => {
  it('instruments nested/brace-less bodies and leaves meta functions untouched', () => {
    const raw = [
      "export const meta = { id: 'x', fn: () => 1 };",
      'export function search(p, ctx) {',
      '  const q = ctx.queue();',
      '  if (true) q.push(p.start);',
      '  return null;',
      '}',
    ].join('\n');

    const instrumented = instrumentAlgorithmSource(raw, '/src/algorithms/custom/x.ts');
    expect(instrumented).toContain("import { __traceLine } from '/src/engine/traceLine';");
    expect(instrumented).toContain('fn: () => 1');
    expect(instrumented).toContain('__traceLine(3); const q = ctx.queue();');
    expect(instrumented).toContain('{ __traceLine(4); q.push(p.start); }');
    expect(instrumented).toContain('__traceLine(5); return null;');
  });

  it('captures accurate BFS raw line numbers per beat and updates DOM highlights reversibly', () => {
    const bfs = getAlgorithm('bfs')!;
    expect(bfs.search.toString()).toContain('__traceLine');
    const graph = buildPreset('sample-graph', false);
    const run = runAlgorithm(bfs.search, graph);
    const player = new TracePlayer(run.trace);

    const extracted = extractAlgorithmCode(bfs.source);
    const tbody = document.createElement('tbody');
    for (const row of extracted) {
      const tr = document.createElement('tr');
      tr.dataset.rawLine = String(row.rawLine);
      tbody.appendChild(tr);
    }

    const activeRowLines = () =>
      Array.from(tbody.querySelectorAll('tr.is-active-line')).map((el) =>
        Number((el as HTMLElement).dataset.rawLine),
      );

    // Beat 0: nothing highlighted yet.
    syncCodeHighlightDom(tbody, player);
    expect(activeRowLines()).toEqual([]);

    // Beat 1: queue.push(problem.start) + visited.add(problem.start) -> raw lines 18 & 19 in bfs.ts.
    player.seek(1);
    syncCodeHighlightDom(tbody, player);
    expect(activeRowLines()).toEqual([18, 19]);

    // Beat 2: const current = queue.pop()! -> raw line 22.
    player.seek(2);
    syncCodeHighlightDom(tbody, player);
    expect(activeRowLines()).toEqual([22]);

    // Beat 3: visited.add(neighbor) + parent.set(neighbor, current) + queue.push(neighbor) -> lines 29, 30, 31.
    player.seek(3);
    syncCodeHighlightDom(tbody, player);
    expect(activeRowLines()).toEqual([29, 30, 31]);

    // Final beat (path reconstructed): return ctx.reconstructPath(parent, current) -> line 24.
    player.seek(player.length);
    syncCodeHighlightDom(tbody, player);
    expect(activeRowLines()).toEqual([24]);

    // Stepping backward restores exact line highlight for beat 2.
    player.seek(2);
    syncCodeHighlightDom(tbody, player);
    expect(activeRowLines()).toEqual([22]);
  });

  it('auto-scrolls active lines smartly without jittering when already visible', () => {
    const scroller = document.createElement('div');
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    scroller.appendChild(table);

    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
    scroller.scrollTop = 0;
    scroller.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 100,
        left: 0,
        right: 300,
        width: 300,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const rawLines = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    for (let i = 0; i < rawLines.length; i += 1) {
      const tr = document.createElement('tr');
      tr.dataset.rawLine = String(rawLines[i]);
      const rowTop = i * 20;
      tr.getBoundingClientRect = () =>
        ({
          top: rowTop - scroller.scrollTop,
          bottom: rowTop + 20 - scroller.scrollTop,
          left: 0,
          right: 300,
          width: 300,
          height: 20,
          x: 0,
          y: rowTop - scroller.scrollTop,
          toJSON: () => ({}),
        }) as DOMRect;
      tbody.appendChild(tr);
    }

    const mockPlayer = (lines: number[]) =>
      ({
        lastStep: { lines },
      }) as unknown as TracePlayer;

    // Already inside [0, 100] (row 3 -> 40..60): keeps scrollTop at 0.
    syncCodeHighlightDom(tbody, mockPlayer([3]));
    expect(scroller.scrollTop).toBe(0);

    // Jumping down to distant two-line beat [11, 13] (200..220 and 240..260): aligns maxBottom near bottom edge
    // while keeping both lines completely visible inside [scrollTop, scrollTop + 100].
    syncCodeHighlightDom(tbody, mockPlayer([11, 13]));
    expect(scroller.scrollTop).toBe(168);
    expect(200).toBeGreaterThanOrEqual(scroller.scrollTop);
    expect(260).toBeLessThanOrEqual(scroller.scrollTop + 100);

    // Moving to [10] (180..200), already inside [168, 268]: leaves scrollTop unchanged.
    syncCodeHighlightDom(tbody, mockPlayer([10]));
    expect(scroller.scrollTop).toBe(168);

    // Tight full-viewport beat [9, 13] (160..260, exactly clientHeight=100): clamps so minTop stays completely visible.
    scroller.scrollTop = 0;
    syncCodeHighlightDom(tbody, mockPlayer([9, 13]));
    expect(scroller.scrollTop).toBe(160);

    // Jumping up to [4] (60..80): aligns minTop near upper edge so later nearby lines also stay in view.
    syncCodeHighlightDom(tbody, mockPlayer([4]));
    expect(scroller.scrollTop).toBe(52);
    expect(60).toBeGreaterThanOrEqual(scroller.scrollTop);
    expect(80).toBeLessThanOrEqual(scroller.scrollTop + 100);

    // Tall span exceeding viewport height ([15, 20] -> 280..400): keeps top active row visible without clipping.
    syncCodeHighlightDom(tbody, mockPlayer([15, 20]));
    expect(scroller.scrollTop).toBe(280);
  });

  it('extracts clean source and traces valid line numbers for all built-in algorithms', () => {
    const graph = buildPreset('sample-graph', false);
    for (const id of ['astar', 'greedy-best-first', 'bfs', 'dfs', 'ucs', 'lcfs', 'ids']) {
      const entry = getAlgorithm(id)!;
      expect(entry).toBeTruthy();
      const extracted = extractAlgorithmCode(entry.source);
      expect(extracted.length).toBeGreaterThan(5);
      expect(extracted[0]?.text).toContain('export function search');
      const rawLineSet = new Set(extracted.map((r) => r.rawLine));

      const run = runAlgorithm(entry.search, graph);
      expect(run.error).toBeNull();
      expect(run.trace.steps.some((step) => step.lines.length > 0)).toBe(true);
      for (const step of run.trace.steps) {
        for (const line of step.lines) {
          expect(rawLineSet.has(line)).toBe(true);
        }
      }
    }
  });
});
