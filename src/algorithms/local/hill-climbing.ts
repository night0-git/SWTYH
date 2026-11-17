import type { AlgorithmMeta, NodeId, SearchContext, SearchProblem } from '../../engine/types';

export const meta: AlgorithmMeta = {
  id: 'hill-climbing',
  name: 'Hill Climbing Search',
  category: 'Local',
  weighted: false,
  usesHeuristic: true,
  requiresAdmissibleHeuristic: false,
  guaranteesOptimalUnweighted: false,
  description:
    'Repeatedly moves to the neighbor with strictly lower heuristic h(n) in O(1) memory. Fast on open terrain, but incomplete and non-optimal because it stalls at local minima.',
  checkCompatibility({ hasPositions, problem, runResult }) {
    if (!hasPositions) {
      return [
        {
          code: 'algorithm-incompatibility',
          message:
            'Hill Climbing requires a non-flat heuristic gradient; without 2D coordinates, h(n) = 0 everywhere stalls immediately at Start.',
        },
      ];
    }

    if (problem.start < 0 || problem.start >= problem.nodeCount || problem.isGoal(problem.start)) {
      return [];
    }

    const startNeighbors = problem.neighbors(problem.start);
    const startH = problem.heuristic(problem.start);
    const canDescendFromStart = startNeighbors.some(
      ({ node }) => problem.heuristic(node) < startH,
    );
    const stalledAfterRun =
      runResult !== null && !runResult.error && !runResult.path && startNeighbors.length > 0;

    if (stalledAfterRun || (startNeighbors.length > 0 && !canDescendFromStart)) {
      return [
        {
          code: 'local-minimum',
          message:
            'Stalled at a local minimum or plateau where no neighbor strictly improves h(n); Hill Climbing cannot backtrack.',
        },
      ];
    }

    return [];
  },
};

export function search(problem: SearchProblem, ctx: SearchContext): NodeId[] | null {
  const parent = ctx.parentMap();
  const flags = ctx.flags();

  let current = problem.start;
  flags.set('stuck', false);

  while (true) {
    const currentH = problem.heuristic(current);
    flags.set('currentH', currentH);

    if (problem.isGoal(current)) {
      return ctx.reconstructPath(parent, current);
    }

    let bestNeighbor: NodeId | null = null;
    let bestH = currentH;

    for (const { node: neighbor } of problem.neighbors(current)) {
      const neighborH = problem.heuristic(neighbor);
      if (neighborH < bestH) {
        bestH = neighborH;
        bestNeighbor = neighbor;
      }
    }

    flags.set('bestH', bestH);

    if (bestNeighbor === null) {
      flags.set('stuck', true);
      return null;
    }

    parent.set(bestNeighbor, current);
    current = bestNeighbor;
  }
}
