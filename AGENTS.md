# AGENTS.md — SWTYH Search Algorithm Visualizer

## 1. Project Purpose

**SWTYH** is a fast, minimal React + TypeScript web application for visualizing search algorithms so students can immediately grasp how each search strategy behaves.

Core principles:
1. **Abundance with zero wiring:** Adding a new algorithm must mean dropping one TypeScript file into `src/algorithms/<category>/<id>.ts`. No manual imports, no switch statements, no registry arrays.
2. **What we write is what they see:** Each algorithm file is imported both as executable code and as raw text (`?raw`). The `search()` function must read like clean coursebook pseudocode/TypeScript—no `yield` boilerplate, no UI hooks, no framework noise.
3. **Absolute performance:** Algorithms run on dense integer node IDs (`0 .. N-1`) and record compact state deltas into typed arrays. Rendering runs directly on HTML5 Canvas 2D outside React's render loop.
4. **Resilience:** Any valid `search(problem, ctx)` export—even an experimental, heuristic-violating, or buggy ("bullshit") algorithm—must execute safely under a step limit and produce a scrubbable partial trace without hanging the tab.
5. **No slop:** Every file, UI control, and visual token must earn its place.

---

## 2. Tech Stack

- **Build / Bundler:** Vite 6 + TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- **UI Shell:** React 19 (controls, dropdown, stats, code panel only)
- **Viewport Rendering:** HTML5 Canvas 2D (`src/canvas/renderer.ts`) reading `Uint8Array` node states
- **Styling:** Plain CSS with CSS Custom Properties (`src/styles/tokens.css`, `src/styles/app.css`) — zero CSS-in-JS or utility-class runtime overhead

---

## 3. Source Architecture

```text
src/
├── main.tsx                     # App entry point + CSS imports
├── vite-env.d.ts                # Vite client types (?raw, import.meta.glob)
├── styles/
│   ├── tokens.css               # SINGLE SOURCE OF TRUTH for theme, palette, and typography
│   └── app.css                  # Minimal 1px-hairline structural layout
├── engine/
│   ├── types.ts                 # NodeId, SearchProblem, SearchContext, AlgorithmModule, Trace
│   ├── trace.ts                 # TraceRecorder (delta log + StepLimitError) & TracePlayer (O(1) seek)
│   ├── collections.ts           # Instrumented Queue, Stack, PriorityQueue, Set, Map, problem wrapper
│   ├── gridProblem.ts           # Grid2DProblem (4/8-way grid, walls, weights, Manhattan/Octile h)
│   ├── graphProblem.ts          # AdjacencyGraphProblem (general weighted graphs + optional 2D coords)
│   ├── presets.ts               # Built-in grid, maze, and graph test scenarios
│   ├── runner.ts                # Executes an algorithm safely and returns RunResult
│   └── registry.ts              # Auto-discovers src/algorithms/**/*.ts via import.meta.glob
├── algorithms/
│   ├── uninformed/              # BFS, DFS, UCS, LCFS, IDS
│   └── informed/
│       └── astar.ts             # Reference heuristic search
├── canvas/
│   └── renderer.ts              # React-free Canvas 2D renderer for Grid2DProblem & AdjacencyGraphProblem
├── components/
│   ├── App.tsx                  # Top bar, auto-populated algorithm dropdown, layout shell
│   ├── simulationState.ts       # Pure reducer & edit logic for replay, scrubbing, and editing
│   ├── Viewport.tsx             # <canvas> mount, pointer interaction, requestAnimationFrame loop
│   ├── ContainerView.tsx        # Live Stack / Queue / Priority Queue / Set inspector
│   └── CodeView.tsx             # Monospace textbook source display
└── test/
    ├── setup.ts                 # jsdom + Canvas 2D / pointer-capture test environment
    ├── simulationState.test.ts  # Unit tests for all UI reducer branches & edge cases
    ├── traceAndContainers.test.ts # Trace reversibility, containers, step limit & cycle guards
    ├── rendererAndHitTest.test.ts # Canvas hitTest, bounds clamping, Grid & Graph rendering
    └── app.integration.test.tsx # End-to-end UI interactions, scrubbing, edits & shortcuts
```

---

## 4. Adding a New Algorithm (One File = One Option)

Create `src/algorithms/<category>/<id>.ts`. `src/engine/registry.ts` automatically discovers every `.ts` file under `src/algorithms/` (ignoring files prefixed with `_` or ending in `.test.ts`) and adds it to the dropdown.

### Standard Template

```ts
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
```

### Mandatory `meta.description` Rule (Mechanism + Outcome)

Every algorithm's `meta.description` **must** contain exactly **two short sentences** (roughly 110–180 characters total) covering both **how it works** and **what outcome it guarantees or fails to guarantee**:

1. **Sentence 1 — Mechanism:** How the frontier picks or expands the next node (e.g., FIFO order, LIFO stack, lowest `g(n)`, lowest `f(n) = g(n) + h(n)`, or greedy `h(n)`).
2. **Sentence 2 — Outcome:** Whether the returned path is optimal (fewest hops vs. minimum cost), under what condition (e.g., unweighted edges, non-negative weights, admissible `h(n)`), and its main failure mode or tradeoff.

- **Good:** `"Expands nodes in min-heap order of f(n) = g(n) + h(n). Guarantees a minimum-cost path when h(n) is admissible, pruning away unpromising branches."`
- **Bad:** `"Finds paths using a heuristic."` *(missing mechanism details and outcome guarantees)*

### Mandatory Incompatibility Warnings Rule

Every algorithm added under `src/algorithms/` **must** surface accurate compatibility & correctness warnings for incompatible graphs or grids:

1. **Declare accurate capability flags on `meta`:** Set `weighted`, `usesHeuristic`, `supportsNegativeWeights` (defaults to `false`), `requiresAdmissibleHeuristic` (defaults to `usesHeuristic`), and `guaranteesOptimalUnweighted` (defaults to `true`; set `false` for non-optimal strategies such as DFS or greedy best-first). `src/engine/compatibility.ts` automatically derives pre-run and post-run warnings from these flags (`ignores-weights`, `negative-weights`, `negative-cycle`, `no-positions-heuristic`, `inadmissible-heuristic`, `non-optimal-strategy`, `suboptimal-result`, `incomplete-result`, `invalid-path`).
2. **Define `meta.checkCompatibility(ctx)` when warnings cannot be derived automatically:** Whenever an algorithm has domain/structural pitfalls not captured by the flags above (such as repeated shallow-pass blowup on deep/cyclic grids in IDS, redundant cyclic frontier growth in LCFS, cycle loops, or missing spatial/DAG assumptions), export `checkCompatibility(ctx)` on `meta` returning explicit `CompatibilityWarning[]` entries—and cover those warnings with automated tests in `src/test/`.

### Concrete Integration Checklist for `src/algorithms/`

1. **File & ID convention:** Place the file at `src/algorithms/<category>/<id>.ts` using kebab-case matching `meta.id` (categories: `uninformed`, `informed`, `local`, `custom`).
2. **Complete `meta` export & warnings:** Always export `meta: AlgorithmMeta` with accurate capability flags (`weighted`, `usesHeuristic`, `supportsNegativeWeights`, `requiresAdmissibleHeuristic`, `guaranteesOptimalUnweighted`), a Mechanism + Outcome `description`, and `checkCompatibility` if any incompatibility cannot be detected automatically.
3. **Textbook clarity ("What we write is what they see"):** Use clean textbook names (`open`, `closed`, `queue`, `stack`, `parent`, `gScore`) and flat loops—remember the raw file renders verbatim in the UI.
4. **Use instrumented `ctx` structures for flawless UI integration:**
   - Display **only textbook states** in the sidebar to avoid clutter. Use `ctx.queue(label?)`, `ctx.stack(label?)`, `ctx.priorityQueue(label?)`, `ctx.set(label?)`, and `ctx.flags()` for textbook containers and scalar/boolean flags (e.g., `limit`, `cutoff`).
   - Pass `{ raw: true }` (e.g., `ctx.stack<number>('Depth', { raw: true })`) for non-node containers so raw scalars are displayed without coloring canvas nodes.
   - Use `ctx.parentMap()` for parent pointers (`parent.set(child, current)`). Keep internal bookkeeping maps (`gScore`, `bestCost`, `bestDepth`) unlabeled in `ctx.map()` so they stay hidden; only pass a label to `ctx.map(label)` when the map itself is standard textbook state.
   - Check `problem.isGoal(current)` upon popping, return `ctx.reconstructPath(parent, current)` when found, and return `null` when exhausted.
5. **Problem-agnostic by default:** Program against `problem.neighbors(u)`, `problem.isGoal(u)`, `problem.heuristic(u)`, and `problem.nodeCount` so every algorithm works seamlessly on both 2D grids and general graphs (unless strictly spatial, in which case check `problem.position(u)`).
6. **Pure & resilient:** Never import React, DOM, or canvas modules inside `src/algorithms/`. `problem.isGoal()` and `problem.neighbors()` remain instrumented as fallback, and `runner.ts` stops infinite loops cleanly at `maxEvents`.

---

## 5. Performance Rules

1. **Dense integer IDs only:** `NodeId` is always `number` (`0 .. problem.nodeCount - 1`). Do not key hot-path maps or sets by `"x,y"` strings.
2. **Typed arrays for board/node state:** Render state is a flat `Uint8Array` indexed by `NodeId`.
3. **Zero per-frame React re-renders:** During playback, `Viewport.tsx` advances `TracePlayer` and redraws `<canvas>` inside `requestAnimationFrame` without calling `setState` on every frame.
4. **Delta-based trace playback:** `TracePlayer` applies and reverts single-node state deltas in O(1) per event. Never store full grid/graph snapshots per step.

---

## 6. Aesthetic Direction & Anti-Slop Rules

Visual direction: **Technical Textbook / Swiss Grid**.
The interface should feel like a crisp, interactive textbook diagram or drafting instrument—calm, legible, and utilitarian.

### Easy Theme Tuning
All surface colors, ink colors, borders, typography, and canvas node-state colors live in **`src/styles/tokens.css`**. `SearchCanvasRenderer` reads `--state-*` directly from CSS variables via `getComputedStyle`. To adjust or swap the palette, edit `src/styles/tokens.css` only.

### Strict Anti-Slop Ban List
Do **not** introduce any of the following:
- Gradients, glassmorphism (`backdrop-filter`), neon glows, or drop shadows (`box-shadow` decorations)
- Rounded-pill SaaS card clutter, marketing hero banners, or onboarding modals
- Decorative icons, pulsing badges, bouncing transitions, or gratuitous micro-animations
- Complex multi-theme UI toggles unless explicitly requested
- Placeholder "coming soon" dead buttons or fake metrics

Keep geometry sharp (`1px solid var(--border-hairline)`), contrast high, labels concise and monospace for technical telemetry.

---

## 7. UI & Replay Testing Policy

Algorithms do **not** need to be optimal or even correct—experimental or intentionally broken algorithms are expected. **The UI, replay state machine, and trace engine must never desync or break.**

Every logical branch and hot path in UI handling must have automated test coverage in `src/test/`:
1. **Editing during any replay state:** Painting/erasing walls, painting/clearing weights, moving Start/Goal, and dragging graph vertices while `player === null`, at `cursor === 0` (post-Reset), paused mid-replay (including when the new trace shrinks below `prevCursor`), at `End`, and while `playing === true`.
2. **Rapid pointer bursts & StrictMode idempotency:** Sequential `grid-edit` / `move-vertex` dispatches must never drop cells or rely on stale closures, and `simulationReducer` must stay idempotent under React `<StrictMode>` double-invocation.
3. **Trace & container reversibility:** Seeking forward, stepping `+1`/`-1`, scrubbing, and resetting must restore exact `states`, `parents`, `currentNode`, `activeEdge`, `Flags`, and live `Queue`/`Stack`/`PriorityQueue`/`Set`/`Map` snapshots.
4. **Canvas interaction & mode switching:** `SearchCanvasRenderer.hitTest` / `screenToGraphPosition` bounds clamping, Grid↔Graph mode UI transitions, and global keyboard shortcuts ignoring focused `<select>`/`<input>` controls.

When adding or modifying any UI control, pointer interaction, or replay transition, add or update tests covering every new branch before finishing.

---

## 8. Verification

Run after any code change:

```bash
npm test
npm run typecheck
npm run build
```
