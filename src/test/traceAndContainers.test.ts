import { describe, expect, it } from 'vitest';
import { syncContainersDom } from '../components/ContainerView';
import { Grid2DProblem } from '../engine/gridProblem';
import { buildPreset } from '../engine/presets';
import { getAlgorithm } from '../engine/registry';
import { runAlgorithm } from '../engine/runner';
import {
  compactVisualTrace,
  rawCursorToVisualCursor,
  stepHasVisualChange,
  TracePlayer,
  visualCursorToRawCursor,
} from '../engine/trace';
import { NodeState, type NodeId, type SearchContext, type SearchProblem } from '../engine/types';

describe('TracePlayer & ContainerView DOM sync', () => {
  it('renders empty prompt before playback and live Queue/Visited items during playback', () => {
    const host = document.createElement('div');
    const grid = buildPreset('open-field', false) as Grid2DProblem;

    syncContainersDom(host, null, grid);
    expect(host.textContent).toContain('step or play');

    const res = runAlgorithm((p, ctx) => {
      const q = ctx.queue('Queue');
      const v = ctx.set('Visited');
      const parent = ctx.parentMap();
      q.push(p.start);
      v.add(p.start);
      const cur = q.pop()!;
      for (const { node } of p.neighbors(cur)) {
        parent.set(node, cur);
        q.push(node);
      }
      return null;
    }, grid);

    const player = new TracePlayer(res.trace);
    player.seek(player.length);
    syncContainersDom(host, player, grid);

    expect(host.textContent).toContain('Queue');
    expect(host.textContent).toContain('[FIFO]');
    expect(host.textContent).toContain('Visited');
    expect(host.textContent).toContain('[SET]');
    const nextItems = host.querySelectorAll('.container-item.is-next');
    expect(nextItems.length).toBe(1);

    // Scrub back to 0 clears live containers to empty and hides op badges.
    player.seek(0);
    syncContainersDom(host, player, grid);
    expect(host.textContent).toContain('empty');
    expect(host.querySelector('.container-op-badge')).toBeNull();
  });

  it('spawns boxed PUSH/POP/ADD/DEL/CLEAR badges next to the container that just changed', () => {
    const host = document.createElement('div');
    const graph = buildPreset('sample-graph', false);

    const res = runAlgorithm((p, ctx) => {
      const q = ctx.queue('Queue');
      const v = ctx.set('Visited');
      q.push(p.start); // step 1: coalesces PUSH S (Queue) + ADD S (Visited)
      v.add(p.start);
      q.pop();         // step 2: POP S on Queue
      v.delete(p.start); // step 3: DEL S on Visited
      v.add(1);        // step 4: ADD #1 on Visited
      v.clear();       // step 5: CLEAR on Visited
      return null;
    }, graph);

    const player = new TracePlayer(res.trace);
    const badgeTexts = () =>
      Array.from(host.querySelectorAll('.container-op-badge')).map((el) => el.textContent);

    player.seek(1);
    syncContainersDom(host, player, graph);
    expect(badgeTexts()).toEqual(['PUSH S', 'ADD S']);
    expect(host.querySelectorAll('.container-op-badge')[0]?.classList.contains('is-push')).toBe(true);
    expect(host.querySelectorAll('.container-op-badge')[1]?.classList.contains('is-push')).toBe(true);

    player.seek(2);
    syncContainersDom(host, player, graph);
    expect(badgeTexts()).toEqual(['POP S']);
    expect(host.querySelector('.container-op-badge')?.classList.contains('is-pop')).toBe(true);

    player.seek(3);
    syncContainersDom(host, player, graph);
    expect(badgeTexts()).toEqual(['DEL S']);

    player.seek(5);
    syncContainersDom(host, player, graph);
    expect(badgeTexts()).toEqual(['CLEAR']);

    // Step backward restores previous badge deterministically.
    player.stepBackward(3);
    syncContainersDom(host, player, graph);
    expect(badgeTexts()).toEqual(['POP S']);
  });

  it('truncates containers above limit and formats PriorityQueue priorities on graph', () => {
    const host = document.createElement('div');
    const graph = buildPreset('sample-graph', false);

    const res = runAlgorithm((_p, ctx) => {
      const pq = ctx.priorityQueue('Open');
      for (let i = 0; i < 30; i += 1) {
        pq.push(i % 10, 100 - i);
      }
      return null;
    }, graph);

    const player = new TracePlayer(res.trace);
    player.seek(player.length);
    syncContainersDom(host, player, graph);

    expect(host.textContent).toContain('size: 30');
    expect(host.textContent).toContain('+6');
    expect(host.querySelector('.container-item.is-next')?.textContent).toContain(':71');
  });

  it('reverses Set add/delete/clear, PriorityQueue ties, and parent pointers cleanly', () => {
    const graph = buildPreset('sample-graph', false);

    const algo = (p: SearchProblem, ctx: SearchContext): NodeId[] | null => {
      const pq = ctx.priorityQueue('Open');
      const seen = ctx.set('Seen');
      const parent = ctx.parentMap();

      pq.push(p.start, 10);
      pq.push(2, 10); // equal priority tie-break
      pq.push(1, 5);
      seen.add(p.start);
      seen.add(2);
      seen.delete(p.start);
      seen.clear();
      const first = pq.pop()!;
      parent.set(first, p.start);
      return [p.start, first];
    };

    const res = runAlgorithm(algo, graph);
    const player = new TracePlayer(res.trace);

    const normalizeContainers = () =>
      player.getContainers(30).map((c) =>
        c.info.kind === 'set'
          ? {
              ...c,
              entries: [...c.entries].sort((a, b) =>
                String(a.value).localeCompare(String(b.value)),
              ),
            }
          : c,
      );

    const snapshots: string[] = [];
    for (let t = 0; t <= player.length; t += 1) {
      player.seek(t);
      snapshots.push(
        JSON.stringify({
          states: Array.from(player.states),
          parents: Array.from(player.parents),
          cur: player.currentNode,
          ef: player.activeEdgeFrom,
          et: player.activeEdgeTo,
          containers: normalizeContainers(),
        }),
      );
    }

    // Scrub backwards one by one and confirm exact equality at every step.
    for (let t = player.length; t >= 0; t -= 1) {
      player.seek(t);
      const now = JSON.stringify({
        states: Array.from(player.states),
        parents: Array.from(player.parents),
        cur: player.currentNode,
        ef: player.activeEdgeFrom,
        et: player.activeEdgeTo,
        containers: normalizeContainers(),
      });
      expect(now).toBe(snapshots[t]);
    }
  });

  it('stops runaway loops via StepLimitError and breaks cycles in reconstructPath', () => {
    const graph = buildPreset('sample-graph', false);

    const infiniteRes = runAlgorithm(
      (p) => {
        while (true) {
          p.neighbors(p.start);
        }
      },
      graph,
      { maxEvents: 50 },
    );
    expect(infiniteRes.stats.truncated).toBe(true);
    expect(infiniteRes.error).toContain('step limit');

    const cycleRes = runAlgorithm((_p, ctx) => {
      const parent = ctx.parentMap();
      parent.set(1, 2);
      parent.set(2, 1);
      return ctx.reconstructPath(parent, 2);
    }, graph);
    expect(cycleRes.error).toBeNull();
    expect(cycleRes.path).toEqual([1, 2]);
  });

  it('tracks Map containers, raw-value stacks, and compact Flags with full forward/backward reversibility', () => {
    const host = document.createElement('div');
    const graph = buildPreset('sample-graph', false);

    const res = runAlgorithm((p, ctx) => {
      const stack = ctx.stack('Frontier');
      const depths = ctx.stack<number>('Depth', { raw: true });
      const scores = ctx.map<NodeId, number>('gScore');
      const flags = ctx.flags();

      flags.set('limit', 1);
      flags.set('cutoff', false);
      scores.set(p.start, 0);
      stack.push(p.start);
      depths.push(0);

      const cur = stack.pop()!;
      const d = depths.pop()!;
      flags.set('depth', d);

      // Overwrite existing map key, delete, then clear; toggle flag to true then delete.
      scores.set(p.start, 5);
      scores.set(2, 22);
      scores.delete(p.start);
      flags.set('cutoff', true);
      scores.clear();
      flags.delete('depth');
      flags.clear();
      return [cur];
    }, graph);

    const player = new TracePlayer(res.trace);
    const normalizeContainers = () =>
      player.getContainers(30).map((c) =>
        c.info.kind === 'map'
          ? {
              ...c,
              entries: [...c.entries].sort((a, b) =>
                String(a.value).localeCompare(String(b.value)),
              ),
            }
          : c,
      );
    const snapshots: string[] = [];

    for (let t = 0; t <= player.length; t += 1) {
      player.seek(t);
      snapshots.push(
        JSON.stringify({
          states: Array.from(player.states),
          containers: normalizeContainers(),
          flags: player.getFlags(),
        }),
      );
    }

    // Raw stack push/pop (0) must never mark node 0 (Start) or any other node as Frontier/Current via raw values.
    player.seek(1);
    syncContainersDom(host, player, graph);
    expect(host.querySelector('.flags-row')?.textContent).toBe('limit: 1, cutoff: false');
    expect(host.querySelectorAll('.flag-item.is-changed').length).toBe(2);

    // Step 2: scores.set(S, 0) + stack.push(S) + depths.push(0) coalesced into one step.
    player.seek(2);
    syncContainersDom(host, player, graph);
    expect(host.textContent).toContain('[MAP]');
    expect(host.textContent).toContain('SET S:0');
    expect(host.textContent).toContain('PUSH 0');
    // Depth stack displays raw integer '0', not 'S'.
    const depthBlock = Array.from(host.querySelectorAll('.container-block')).find((el) =>
      el.textContent?.includes('Depth'),
    );
    expect(depthBlock?.querySelector('.container-item')?.textContent).toBe('0');

    // Step 3: stack.pop() + depths.pop() + flags.set('depth', 0) coalesced into one step.
    player.seek(3);
    syncContainersDom(host, player, graph);
    expect(host.querySelector('.flags-row')?.textContent).toBe(
      'limit: 1, cutoff: false, depth: 0',
    );
    const depthBlockAfterPop = Array.from(host.querySelectorAll('.container-block')).find((el) =>
      el.textContent?.includes('Depth'),
    );
    expect(depthBlockAfterPop?.textContent).toContain('POP 0');

    // Verify cutoff: true gets blue .is-changed highlight on change.
    player.seek(7);
    syncContainersDom(host, player, graph);
    const changedItems = Array.from(host.querySelectorAll('.flag-item.is-changed')).map(
      (el) => el.textContent,
    );
    expect(changedItems).toEqual(['cutoff: true']);

    // Scrub backwards step by step and confirm exact equality with forward pass.
    for (let t = player.length; t >= 0; t -= 1) {
      player.seek(t);
      const now = JSON.stringify({
        states: Array.from(player.states),
        containers: normalizeContainers(),
        flags: player.getFlags(),
      });
      expect(now).toBe(snapshots[t]);
    }
  });

  it('keeps raw-value stacks isolated from canvas NodeState transitions', () => {
    const grid = buildPreset('open-field', false) as Grid2DProblem;
    const res = runAlgorithm((_p, ctx) => {
      const rawStack = ctx.stack<number>('Depth', { raw: true });
      rawStack.push(5);
      rawStack.push(10);
      rawStack.pop();
      return null;
    }, grid);

    const player = new TracePlayer(res.trace);
    const initial = Array.from(grid.initialStates());
    for (let t = 0; t <= player.length; t += 1) {
      player.seek(t);
      expect(Array.from(player.states)).toEqual(initial);
      expect(player.states[5]).toBe(NodeState.Unvisited);
      expect(player.states[10]).toBe(NodeState.Unvisited);
    }
  });

  it('exposes complete sidebar containers and reversible flags across all built-in algorithms', () => {
    const graph = buildPreset('unweighted-graph', false);

    const expectedContainers: Record<string, string[]> = {
      bfs: ['Queue', 'Visited'],
      dfs: ['Stack', 'Visited'],
      ucs: ['Open', 'Closed'],
      lcfs: ['Frontier', 'Closed'],
      ids: ['Frontier', 'Depth', 'Visited'],
      astar: ['Open', 'Closed'],
      'greedy-best-first': ['Open', 'Visited'],
    };

    for (const [id, labels] of Object.entries(expectedContainers)) {
      const entry = getAlgorithm(id)!;
      const res = runAlgorithm(entry.search, graph);
      expect(res.error).toBeNull();
      expect(res.trace.containers.map((c) => c.label)).toEqual(labels);

      const player = new TracePlayer(res.trace);
      player.seek(player.length);
      if (id === 'ids') {
        const flags = player.getFlags();
        expect(flags.map((f) => f.name)).toEqual(
          expect.arrayContaining(['limit', 'cutoff', 'depth']),
        );
      }

      // Reset restores empty containers and clears flags cleanly.
      player.reset();
      expect(player.getFlags()).toEqual([]);
      for (const c of player.getContainers()) {
        expect(c.size).toBe(0);
      }
    }
  });

  it('compacts non-visual intermediate steps while keeping exact state & container reversibility', () => {
    const graph = buildPreset('unweighted-graph', false);
    const idsEntry = getAlgorithm('ids')!;
    const rawRun = runAlgorithm(idsEntry.search, graph);
    const visualTrace = compactVisualTrace(rawRun.trace, {
      includeParents: true,
      includeActiveEdge: true,
    });

    expect(visualTrace.length).toBeGreaterThan(0);
    expect(visualTrace.length).toBeLessThan(rawRun.trace.length);
    for (const step of visualTrace.steps) {
      expect(
        stepHasVisualChange(step, { includeParents: true, includeActiveEdge: true }),
      ).toBe(true);
    }

    const rawPlayer = new TracePlayer(rawRun.trace);
    const visualPlayer = new TracePlayer(visualTrace);
    rawPlayer.seek(rawPlayer.length);
    visualPlayer.seek(visualPlayer.length);

    expect(Array.from(visualPlayer.states)).toEqual(Array.from(rawPlayer.states));
    expect(Array.from(visualPlayer.parents)).toEqual(Array.from(rawPlayer.parents));
    expect(visualPlayer.currentNode).toBe(rawPlayer.currentNode);
    expect(visualPlayer.getFlags()).toEqual(rawPlayer.getFlags());
    expect(visualPlayer.getContainers(50)).toEqual(rawPlayer.getContainers(50));

    // Step forward and backward through every compacted step and verify exact reversibility.
    visualPlayer.reset();
    const forwardSnapshots: string[] = [];
    for (let t = 0; t <= visualPlayer.length; t += 1) {
      visualPlayer.seek(t);
      forwardSnapshots.push(
        JSON.stringify({
          states: Array.from(visualPlayer.states),
          parents: Array.from(visualPlayer.parents),
          cur: visualPlayer.currentNode,
          ef: visualPlayer.activeEdgeFrom,
          et: visualPlayer.activeEdgeTo,
          flags: visualPlayer.getFlags(),
          containers: visualPlayer.getContainers(50),
        }),
      );
    }
    for (let t = visualPlayer.length; t >= 0; t -= 1) {
      visualPlayer.seek(t);
      const snap = JSON.stringify({
        states: Array.from(visualPlayer.states),
        parents: Array.from(visualPlayer.parents),
        cur: visualPlayer.currentNode,
        ef: visualPlayer.activeEdgeFrom,
        et: visualPlayer.activeEdgeTo,
        flags: visualPlayer.getFlags(),
        containers: visualPlayer.getContainers(50),
      });
      expect(snap).toBe(forwardSnapshots[t]);
    }
  });

  it('respects includeParents / includeActiveEdge and handles trailing or all-non-visual traces', () => {
    const grid = buildPreset('open-field', false) as Grid2DProblem;

    // Algorithm with only non-visual steps produces 0 replay steps when compacted.
    const noVisualRun = runAlgorithm((_p, ctx) => {
      const flags = ctx.flags();
      const raw = ctx.stack<number>('Depth', { raw: true });
      flags.set('a', 1);
      raw.push(42);
      return null;
    }, grid);
    expect(compactVisualTrace(noVisualRun.trace).length).toBe(0);

    // Algorithm with parent update on an already-frontier cell + trailing flag update.
    const rawRun = runAlgorithm((p, ctx) => {
      const q = ctx.queue('Queue');
      const parent = ctx.parentMap();
      const flags = ctx.flags();
      const n1 = p.neighbors(p.start)[0]!.node;
      const n2 = p.neighbors(p.start)[1]!.node;
      q.push(n1); // visual: n1 -> Frontier
      q.push(n2); // visual: n2 -> Frontier
      parent.set(n2, n1); // visual ONLY when includeParents is true (on grid with Tree ON)
      flags.set('done', true); // trailing non-visual step
      return null;
    }, grid);

    const gridNoTree = compactVisualTrace(rawRun.trace, {
      includeParents: false,
      includeActiveEdge: false,
    });
    expect(gridNoTree.length).toBe(3);
    const noTreePlayer = new TracePlayer(gridNoTree);
    noTreePlayer.seek(noTreePlayer.length);
    expect(noTreePlayer.getFlags()).toEqual([{ name: 'done', value: true }]);

    const gridWithTree = compactVisualTrace(rawRun.trace, {
      includeParents: true,
      includeActiveEdge: false,
    });
    expect(gridWithTree.length).toBe(4);
  });

  it('maps cursors bidirectionally between raw and compacted traces with identical canvas state', () => {
    const graph = buildPreset('unweighted-graph', false);
    const idsEntry = getAlgorithm('ids')!;
    const rawRun = runAlgorithm(idsEntry.search, graph);
    const filter = { includeParents: true, includeActiveEdge: true };
    const visualTrace = compactVisualTrace(rawRun.trace, filter);

    const rawPlayer = new TracePlayer(rawRun.trace);
    const visualPlayer = new TracePlayer(visualTrace);

    // Every visual cursor maps to a raw cursor with identical canvas states, currentNode, and parents.
    for (let vc = 0; vc <= visualTrace.length; vc += 1) {
      const rc = visualCursorToRawCursor(rawRun.trace, vc, filter);
      expect(rawCursorToVisualCursor(rawRun.trace, rc, filter)).toBe(vc);
      visualPlayer.seek(vc);
      rawPlayer.seek(rc);
      expect(Array.from(rawPlayer.states)).toEqual(Array.from(visualPlayer.states));
      expect(Array.from(rawPlayer.parents)).toEqual(Array.from(visualPlayer.parents));
      expect(rawPlayer.currentNode).toBe(visualPlayer.currentNode);
      expect(rawPlayer.activeEdgeFrom).toBe(visualPlayer.activeEdgeFrom);
      expect(rawPlayer.activeEdgeTo).toBe(visualPlayer.activeEdgeTo);
    }

    // Every raw cursor maps to a visual cursor with identical canvas visual state.
    for (let rc = 0; rc <= rawRun.trace.length; rc += 1) {
      const vc = rawCursorToVisualCursor(rawRun.trace, rc, filter);
      rawPlayer.seek(rc);
      visualPlayer.seek(vc);
      expect(Array.from(visualPlayer.states)).toEqual(Array.from(rawPlayer.states));
      expect(Array.from(visualPlayer.parents)).toEqual(Array.from(rawPlayer.parents));
      expect(visualPlayer.currentNode).toBe(rawPlayer.currentNode);
      expect(visualPlayer.activeEdgeFrom).toBe(rawPlayer.activeEdgeFrom);
      expect(visualPlayer.activeEdgeTo).toBe(rawPlayer.activeEdgeTo);
    }
  });
});
