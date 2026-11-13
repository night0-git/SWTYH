import type { AlgorithmMeta, NodeId, SearchContext, SearchProblem } from '../../engine/types';

export const meta: AlgorithmMeta = {
  id: 'ids',
  name: 'Iterative Deepening Search',
  category: 'Uninformed',
  weighted: false,
  usesHeuristic: false,
  supportsNegativeWeights: false,
  guaranteesOptimalUnweighted: true,
  description:
    'Runs depth-limited DFS with depth limits increasing from 0 upward. Guarantees fewest-hop paths on unweighted graphs, trading repeated shallow passes for DFS memory.',
  checkCompatibility({ problem, hasCycles, runResult }) {
    if (problem.kind === 'grid' || (hasCycles && problem.nodeCount > 15) || runResult?.stats.truncated) {
      return [
        {
          code: 'step-budget-risk',
          message:
            'Iterative Deepening Search re-explores shallow depths on every limit increase and may exceed the step budget on deep or cyclic grids/graphs.',
        },
      ];
    }
    return [];
  },
};

export function search(problem: SearchProblem, ctx: SearchContext): NodeId[] | null {
  const stack = ctx.stack('Frontier');
  const visited = ctx.set('Visited');
  const parent = ctx.parentMap();
  const bestDepth = new Map<NodeId, number>();

  for (let limit = 0; limit < problem.nodeCount; limit += 1) {
    visited.clear();
    bestDepth.clear();
    let cutoff = false;

    const depths: number[] = [0];
    bestDepth.set(problem.start, 0);
    stack.push(problem.start);

    while (!stack.isEmpty()) {
      const current = stack.pop()!;
      const depth = depths.pop()!;
      if (depth > (bestDepth.get(current) ?? Infinity)) continue;
      visited.add(current);

      if (problem.isGoal(current)) {
        return ctx.reconstructPath(parent, current);
      }

      if (depth >= limit) {
        cutoff = true;
        continue;
      }

      const edges = problem.neighbors(current);
      for (let i = edges.length - 1; i >= 0; i -= 1) {
        const neighbor = edges[i]!.node;
        if (depth + 1 < (bestDepth.get(neighbor) ?? Infinity)) {
          bestDepth.set(neighbor, depth + 1);
          parent.set(neighbor, current);
          depths.push(depth + 1);
          stack.push(neighbor);
        }
      }
    }

    if (!cutoff) break;
  }

  return null;
}
