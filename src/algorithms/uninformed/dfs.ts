import type { AlgorithmMeta, NodeId, SearchContext, SearchProblem } from '../../engine/types';

export const meta: AlgorithmMeta = {
  id: 'dfs',
  name: 'Depth-First Search',
  category: 'Uninformed',
  weighted: false,
  usesHeuristic: false,
  guaranteesOptimalUnweighted: false,
  description:
    'Explores the most recently discovered node first via a LIFO stack. Reaches deep goals with small frontier memory, but does not guarantee shortest hops or lowest cost.',
};

export function search(problem: SearchProblem, ctx: SearchContext): NodeId[] | null {
  const stack = ctx.stack('Stack');
  const visited = ctx.set('Visited');
  const parent = ctx.parentMap();

  stack.push(problem.start);

  while (!stack.isEmpty()) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (problem.isGoal(current)) {
      return ctx.reconstructPath(parent, current);
    }

    for (const { node: neighbor } of problem.neighbors(current)) {
      if (!visited.has(neighbor)) {
        parent.set(neighbor, current);
        stack.push(neighbor);
      }
    }
  }

  return null;
}
