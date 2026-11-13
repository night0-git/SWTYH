import type { AlgorithmMeta, NodeId, SearchContext, SearchProblem } from '../../engine/types';

export const meta: AlgorithmMeta = {
  id: 'bfs',
  name: 'Breadth-First Search',
  category: 'Uninformed',
  weighted: false,
  usesHeuristic: false,
  description:
    'Explores nodes in FIFO layer order by hop count. Guarantees the fewest-hop path on unweighted graphs, ignoring edge weights.',
};

export function search(problem: SearchProblem, ctx: SearchContext): NodeId[] | null {
  const queue = ctx.queue('Queue');
  const visited = ctx.set('Visited');
  const parent = ctx.parentMap();

  queue.push(problem.start);
  visited.add(problem.start);

  while (!queue.isEmpty()) {
    const current = queue.pop()!;
    if (problem.isGoal(current)) {
      return ctx.reconstructPath(parent, current);
    }

    for (const { node: neighbor } of problem.neighbors(current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  return null;
}
