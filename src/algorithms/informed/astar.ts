import type { AlgorithmMeta, NodeId, SearchContext, SearchProblem } from '../../engine/types';

export const meta: AlgorithmMeta = {
  id: 'astar',
  name: 'A* Search',
  category: 'Informed',
  weighted: true,
  usesHeuristic: true,
  description:
    'Expands nodes in min-heap order of f(n) = g(n) + h(n). Guarantees a minimum-cost path when h(n) is admissible, pruning away unpromising branches.',
};

export function search(problem: SearchProblem, ctx: SearchContext): NodeId[] | null {
  const open = ctx.priorityQueue('Open');
  const closed = ctx.set('Closed');
  const parent = ctx.parentMap();
  const gScore = ctx.map<NodeId, number>();

  gScore.set(problem.start, 0);
  open.push(problem.start, problem.heuristic(problem.start));

  while (!open.isEmpty()) {
    const current = open.pop()!;
    if (closed.has(current)) continue;
    closed.add(current);

    if (problem.isGoal(current)) {
      return ctx.reconstructPath(parent, current);
    }

    const currentCost = gScore.get(current) ?? Infinity;
    for (const { node: neighbor, cost } of problem.neighbors(current)) {
      if (closed.has(neighbor)) continue;

      const tentativeG = currentCost + cost;
      if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
        parent.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        open.push(neighbor, tentativeG + problem.heuristic(neighbor));
      }
    }
  }

  return null;
}
