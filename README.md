# SWTYH — Search Algorithm Visualizer

Interactive visualizer for uninformed and informed graph/grid search algorithms (`BFS`, `DFS`, `UCS`, `LCFS`, `IDS`, `A*`) with step-by-step live container state and synchronized textbook code highlighting.

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in your browser.

## Controls

- **Replay:** Click **Play** (`Space`), **+1** / **-1** (`ArrowRight` / `ArrowLeft`), **End**, **Reset**, or drag the timeline scrubber. Adjust playback speed from the speed selector.
- **Problems:** Switch between Grid, Maze, and Graph presets from the **Problem** menu, or click **Reset Preset** to restore the original layout.
- **Edit Grids & Graphs:** Paint walls/weights or drag **S**/**G** on grids; move vertices, add/remove nodes and edges, edit edge weights, or toggle **Directed** / **Weighted** on graphs.
- **Inspector:** Drag the vertical or horizontal dividers in the right sidebar (double-click to reset), or use **Full** / **Split** on either section.

## Adding Algorithms

Drop a TypeScript module into `src/algorithms/<category>/<id>.ts` exporting `meta` and `search(problem, ctx)`—it appears automatically in the **Algorithm** dropdown.
