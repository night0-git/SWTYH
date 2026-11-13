import { createSearchContext, instrumentProblem } from './collections';
import { StepLimitError, TraceRecorder } from './trace';
import { setActiveLineRecorder } from './traceLine';
import type {
  AlgorithmSearchFn,
  NodeId,
  RunResult,
  SearchProblem,
} from './types';

export interface RunOptions {
  readonly maxEvents?: number;
}

function computePathCost(problem: SearchProblem, path: readonly NodeId[] | null): number {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const u = path[i]!;
    const v = path[i + 1]!;
    let best = Infinity;
    for (const edge of problem.neighbors(u)) {
      if (edge.node === v && edge.cost < best) {
        best = edge.cost;
      }
    }
    if (!Number.isFinite(best)) return Number.NaN;
    total += best;
  }
  return total;
}

export function runAlgorithm(
  search: AlgorithmSearchFn,
  problem: SearchProblem,
  options: RunOptions = {},
): RunResult {
  const recorder = new TraceRecorder(
    problem.initialStates(),
    options.maxEvents ?? 120_000,
  );
  const instrumented = instrumentProblem(problem, recorder);
  const ctx = createSearchContext(problem, recorder);

  let path: NodeId[] | null = null;
  let error: string | null = null;
  const startTime = performance.now();

  setActiveLineRecorder(recorder);
  try {
    const result = search(instrumented, ctx);
    if (Array.isArray(result) && result.length > 0) {
      path = result;
      recorder.recordPath(result);
    }
  } catch (err) {
    if (err instanceof StepLimitError) {
      error = err.message;
    } else if (err instanceof Error) {
      error = err.message;
    } else {
      error = String(err);
    }
  } finally {
    setActiveLineRecorder(null);
  }

  const durationMs = performance.now() - startTime;
  const trace = recorder.build();

  return {
    trace,
    path,
    stats: {
      steps: trace.length,
      visitedCount: recorder.visitedCount,
      pathLength: path ? path.length : 0,
      pathCost: computePathCost(problem, path),
      durationMs,
      truncated: recorder.truncated,
    },
    error,
  };
}
