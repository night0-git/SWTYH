import type { AlgorithmMeta, NodeId, SearchContext, SearchProblem } from '../../engine/types';

export const meta: AlgorithmMeta = {
  id: 'greedy-best-first',
  name: 'Greedy Best-First Search',
  category: 'Informed',
  weighted: false,
  usesHeuristic: true,
  requiresAdmissibleHeuristic: false,
  guaranteesOptimalUnweighted: false,
  description:
    'Expands the frontier node with the smallest heuristic h(n) to the goal. Reaches targets quickly, but ignores path cost g(n) and does not guarantee optimal paths.',
};

export function search(problem: SearchProblem, ctx: SearchContext): NodeId[] | null {
  const open = ctx.priorityQueue('Open');
  const visited = ctx.set('Visited');
  const parent = ctx.parentMap();

  visited.add(problem.start);
  open.push(problem.start, problem.heuristic(problem.start));

  while (!open.isEmpty()) {
    const current = open.pop()!;
    if (problem.isGoal(current)) {
      return ctx.reconstructPath(parent, current);
    }

    for (const { node: neighbor } of problem.neighbors(current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        open.push(neighbor, problem.heuristic(neighbor));
      }
    }
  }

  return null;
}
