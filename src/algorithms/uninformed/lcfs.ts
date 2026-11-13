import type { AlgorithmMeta, NodeId, SearchContext, SearchProblem } from '../../engine/types';

export const meta: AlgorithmMeta = {
  id: 'lcfs',
  name: 'Lowest-Cost-First Search',
  category: 'Uninformed',
  weighted: true,
  usesHeuristic: false,
  supportsNegativeWeights: false,
  description:
    'Expands frontier paths in min-heap order of cumulative cost g(n) without pruning dominated pushes. Guarantees optimal paths for non-negative weights at higher frontier memory cost.',
  checkCompatibility({ hasCycles, problem }) {
    if (hasCycles && problem.nodeCount > 15) {
      return [
        {
          code: 'cycle-reexploration',
          message:
            'Lowest-Cost-First Search queues redundant frontier entries around cycles without eager edge relaxation, increasing heap size.',
        },
      ];
    }
    return [];
  },
};

export function search(problem: SearchProblem, ctx: SearchContext): NodeId[] | null {
  const frontier = ctx.priorityQueue('Frontier');
  const closed = ctx.set('Closed');
  const parent = ctx.parentMap();
  const bestCost = ctx.map<NodeId, number>();

  bestCost.set(problem.start, 0);
  frontier.push(problem.start, 0);

  while (!frontier.isEmpty()) {
    const current = frontier.pop()!;
    if (closed.has(current)) continue;
    closed.add(current);

    if (problem.isGoal(current)) {
      return ctx.reconstructPath(parent, current);
    }

    const currentCost = bestCost.get(current) ?? 0;
    for (const { node: neighbor, cost } of problem.neighbors(current)) {
      if (closed.has(neighbor)) continue;

      const nextCost = currentCost + cost;
      if (nextCost < (bestCost.get(neighbor) ?? Infinity)) {
        bestCost.set(neighbor, nextCost);
        parent.set(neighbor, current);
      }
      frontier.push(neighbor, nextCost);
    }
  }

  return null;
}
