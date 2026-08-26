# UnifiedScienceMap

UnifiedScienceMap is an interactive map of formalized scientific knowledge. It merges Lean-based mathematics, physics, computer science, and scientific computing libraries into one explorable system map instead of showing each repository as a separate island.

The project is currently focused on a browser visualization with two main views:

- `Overview`: a high-level subject map for seeing the shape of the knowledge base.
- `Network`: a large-scale WebGL graph for exploring declarations, dependencies, labels, and local relationship chains.

The goal is to make a "system science map": math, physics, computation, scientific computing, and later control theory or research metadata should live in the same coordinate system, with repository identity kept as metadata rather than as the visible organizing principle.

## Data Sources

The current unified dataset is built from:

- `mathlib`: the core mathematical library for Lean 4.
- `physlib`: formalized physics and quantum information material.
- `cslib`: formalized computer science material.
- `SciLean`: scientific computing, analysis, automatic differentiation, numerics, and related modules.

External source repositories are preserved under `external/` so their Git history and author metadata remain part of this repository after merge:

```text
external/
  SciLean/
  cslib/
  physlib/
```

This is intentional: GitHub can attribute imported commits to their original authors when the commits are part of the repository history.

## Current Dataset

The main browser dataset is:

```text
web/unified-decls.json
```

It is generated from the individual declaration datasets and module-level Git history files. The current unified map is approximately:

- 170k declaration nodes
- 40k graph edges
- 50+ subject clusters
- math, physics, computer science, and scientific computing sources

Each node follows a shared schema:

```json
{
  "label": "LinearMap.ker",
  "kind": "def",
  "dir": "LinearAlgebra",
  "module": "Mathlib.LinearAlgebra.Basic",
  "depth": 3,
  "x": 0.42,
  "y": -0.15,
  "year": 2024.2,
  "sourceRepo": "mathlib",
  "sourcePackage": "Mathlib",
  "domain": "Math",
  "subject": "LinearAlgebra",
  "createdAt": "2023-08-10T12:34:56Z",
  "lastTouchedAt": "2026-01-20T08:15:00Z",
  "commitCount": 12,
  "firstAuthor": "Example Author",
  "contributors": ["Example Author", "Another Contributor"]
}
```

The frontend uses this metadata for search and local inspection, but contributor/history data is not shown as a separate visual layer by default.

## Visualization Architecture

The visualization is split across three layers:

- WebGL renders the large node cloud.
- WebGL renders default edges underneath nodes.
- Canvas 2D renders labels, axes, HUD text, hover details, and hover relationship chains.

The Network view is designed for very large data. Default edges start nearly invisible and become clearer as the user zooms in, while hover relationship chains remain explicit and readable.

Key files:

```text
web/index.html
web/main.js
web/gl-renderer.js
web/wasm-index.js
web/spatial-index.wasm
web/unified-decls.json
```

## Build Pipeline

The project keeps raw per-source declaration files and builds one unified dataset for the frontend.

Input declaration datasets:

```text
web/decls.json
web/physlib-decls.json
web/cslib-decls.json
web/scilean-decls.json
```

Git history datasets:

```text
web/mathlib-history.json
web/physlib-history.json
web/cslib-history.json
web/scilean-history.json
```

Build scripts:

```text
scripts/build-addon-decls.mjs
scripts/build-physlib-decls.mjs
scripts/build-history.mjs
scripts/build-unified-decls.mjs
```

Regenerate addon declaration datasets:

```powershell
node scripts/build-addon-decls.mjs physlib
node scripts/build-addon-decls.mjs cslib
node scripts/build-addon-decls.mjs scilean
```

Regenerate module-level Git history:

```powershell
node scripts/build-history.mjs mathlib
node scripts/build-history.mjs physlib
node scripts/build-history.mjs cslib
node scripts/build-history.mjs scilean
```

Build the final unified map:

```powershell
node scripts/build-unified-decls.mjs
```

## Local Development

Serve the static web app from the repository root:

```powershell
python -m http.server 8756 --directory web
```

Then open:

```text
http://localhost:8756/
```

No bundler is required for the current static app.

## Repository Layout

```text
web/
  index.html              Browser UI
  main.js                 App state, interaction, labels, Canvas overlays
  gl-renderer.js          WebGL renderer for nodes and default edges
  unified-decls.json      Main generated map data
  *-decls.json            Per-source declaration datasets
  *-history.json          Module-level Git history metadata

scripts/
  build-addon-decls.mjs   Shared extractor for addon Lean repositories
  build-history.mjs       Module-level Git history extractor
  build-unified-decls.mjs Unified dataset builder

external/
  SciLean/                Imported source tree with history
  cslib/                  Imported source tree with history
  physlib/                Imported source tree with history
```

## Design Direction

UnifiedScienceMap should stay visually centered on the map itself:

- The visible map is organized by subject and knowledge relationships.
- Repositories are metadata, not continents.
- Contribution history supports GitHub attribution and future detail panels, but it should not dominate the main view.
- New sources should be merged into the same schema before they are visualized.

The preferred growth path is to add more formal science libraries, keep the extractor consistent, and improve the mixed layout so related ideas naturally sit near each other across math, physics, computation, and scientific computing.

## Attribution

This project builds on public Lean ecosystem work, including:

- [mathlib4](https://github.com/leanprover-community/mathlib4)
- [SciLean](https://github.com/lecopivo/SciLean)
- [cslib](https://github.com/leanprover/cslib)
- the imported `physlib` source tree in this repository

Original commits imported into `external/` retain their historical authorship in Git.
