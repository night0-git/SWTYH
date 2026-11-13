import { describe, expect, it } from 'vitest';
import { syncContainersDom } from '../components/ContainerView';
import { Grid2DProblem } from '../engine/gridProblem';
import { buildPreset } from '../engine/presets';
import { runAlgorithm } from '../engine/runner';
import { TracePlayer } from '../engine/trace';
import type { NodeId, SearchContext, SearchProblem } from '../engine/types';

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
});
