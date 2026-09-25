# Visual DAG Workflows

## Dependencies

- **`@xyflow/react` 12.11.6** (MIT, peer `react >=17`) — the workflow editor canvas. React 19
  compatible; used by Dify, Langflow, Flowise, AutoGen Studio, orca-viz and orca-dag. Its
  stylesheet is imported from the editor component, following the `pdf_viewer.css` and
  `xterm.css` precedents; custom node and edge components use only `main.css` tokens.
- **`@dagrejs/dagre` 3.1.1** (MIT) — synchronous auto-layout for the editor's node graphs;
  sufficient for graphs of tens of nodes.
- **Justified duplication**: `@xyflow/react` bundles Zustand 4 internally while Orca uses
  Zustand 5. That copy is private to the library and does not touch Orca stores.

See `specs/001-visual-dag-workflows/research.md` (R10) for the full alternatives analysis
(Rete.js, tldraw, elkjs) and rationale.
