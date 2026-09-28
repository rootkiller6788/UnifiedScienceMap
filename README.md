# UnifiedScienceMap

UnifiedScienceMap is an interactive map of formalized scientific knowledge. It merges Lean-based mathematics, physics, computer science, and scientific computing libraries into one explorable system map instead of showing each repository as a separate island.

The project is currently focused on a browser visualization with eleven mode buttons:

- `Overview`: a high-level subject map for seeing the shape of the knowledge base.
- `Hive`, `Atlas`, `Alluvial`, `UCSD`: four other views of the formalized-science
  corpus (see below).
- `Philosophy`: a cross-listing chord view of the PhilPapers category tree.
- `Coral`, `Interdisc`, `Mycelium`, `Evolution`: four views of science as a whole —
  the hierarchy grown as a branching structure, discipline connectivity, concept
  flow between disciplines, and two centuries of change as a stratigraphic column.
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

### Alluvial view (domain → dir → kind)

The **Alluvial** mode replaces the earlier Horizon ridge chart. Horizon read
`science-atlas-data.json`, where every record carries exactly one `category` and
there is no dimension to flow along — drawing that as a Sankey produces a row of
unrelated bars. The Alluvial view instead reads `unified-decls.json`, whose every
declaration already carries `domain`, `dir` and `kind`, so the three stages are
real fields with no truncation and no Top-N cutoff (4 domains, 52 dirs, 9 kinds;
65 + 318 = 383 ribbons over 170,974 declarations).

The whole chart rests on one invariant: **all three stages share a single
px-per-declaration scale**. A ribbon is therefore exactly as thick where it lands
as where it leaves, and every node's height equals the sum of its ribbons. Break
it and nodes and ribbons sit on two different rulers — the straight-line version
of a dual-axis chart. `web/check-alluvial.mjs` measures the invariant off the
emitted `Path2D` calls rather than trusting the layout's own bookkeeping, because
a layout that miscounts itself cannot be caught by a test that asks the layout.

```bash
node web/check-alluvial.mjs        # geometry invariants + API contract
node web/check-phil-chord.mjs      # the philosophy chord view, unchanged
```

Both also exercise the **legend-click → repaint** wiring that the newer
views needed, and that the older two were quietly missing. Rendering is on demand
(`requestRender` → one `rAF`), so a module that changes its own state on a legend
click has to tell the host, or the canvas keeps showing the frame from before the
click until some unrelated `mousemove` redraws it. Each module now takes an
`onChange` callback (`createAlluvialView({ onChange })`), defaulting to a no-op so a
view can still be constructed and tested alone. The old harnesses could not have
caught this: their legend stubs had `querySelectorAll: () => []`, so no handler was
ever installed and the assertion only proved the markup contained `class="item"`.
They now install a real row, click it, and assert the domain actually toggles and
`onChange` fires each time.

`web/mut-*.mjs` are the mutation runners, one per module (`mut-legend-onchange.mjs`,
`mut-interdisc.mjs`, `mut-evolution.mjs`). Each rewrites an anchor in the module source
and asserts the corresponding harness goes red: 8 + 16 + 15 mutants, all caught, none
"crash-only". Two standards are baked into them, both learned the hard way:

- **A mutant must be a legal program.** One early mutant left an unmatched `});`, so
  the mutated source failed to parse, the harness died in `new Function`, and the
  result was a crash rather than a failed assertion — it tested the parser, not the
  assertion. `mut-interdisc`/`mut-river` also count `skipped`, because an anchor that
  silently stops matching turns a mutant into a no-op that reads as a pass.
- **A test must not crash on the defect it reports.** The two harnesses originally
  called `row.onclick()` unconditionally, so the "no click handler installed" mutant
  killed the harness with a `TypeError` before any assertion ran. They now branch:
  report the missing handler, then skip the clicks.

`web/check-alluvial.html` is the browser companion: it loads only the chart
against the real dataset, wraps `fillText` to recover **real font metrics**, and
writes the label-overlap count to `document.title`. Node's stub `measureText`
can prove the avoidance algorithm separates every overlapping pair, but only a
real canvas can say whether the real font makes two labels touch. Verified
`overlaps=0` from 960×540 to 1600×900.

Known trade-offs, deliberately not hidden:

- 11 of the 52 `dir` nodes hold under 100 declarations. At the shared scale they
  are genuinely hairline and cannot be seen. Giving them a minimum height would
  break the invariant — i.e. trade an invisible lie for visible prettiness. They
  can still be hovered (hit targets have a minimum height) to read the numbers.
- Math is 89% of the dataset, so the other three domains are thin bands. That is
  the true shape of the data, not a rendering choice.
- This mode shows no bottom-left panel (see below), so the domain column is fully
  visible — but the panel held the only filter control (click a domain to hide
  it) and the hover readout, and both go with it.

### Coral, Interdisc and Evolution views

Five further modes. Each is built from `map_of_science` where that dataset supports
the question, and from OpenAlex where it demonstrably does not — decided per view by
inspecting the data first, not by assuming the requested source could answer the
requested question. Mycelium derives everything in the browser from `arcs` and adds
no data file at all.

| Mode | Button | Reads | Answers |
|---|---|---|---|
| **Coral** | `Coral` | `coral-data.json` (4.6 MB, cluster tier) | the hierarchy **grown as a branching structure** |
| Interdisc | `Interdisc` | `sunburst-data.json`, derived in-browser | which disciplines share vocabulary, and how much |
| Mycelium | `Mycelium` | `sunburst-data.json`, derived in-browser | how individual concepts flow between disciplines |
| Evolution | `Evolution` | `openalex-history.json` (34 KB) | two centuries of **uplift and erosion** in the composition of science |
| ~~River~~ | — | `openalex-history.json` | retired from the UI; file and harness kept |
| ~~Sunburst~~ | — | `sunburst-data.json` (9.3 MB) | retired from the UI; file and harness kept |

**Coral replaced Sunburst** (`web/knowledge-coral.js`, mode id `coral`). The
judgement was that a hierarchy is *already* a branching structure, and a sunburst
flattens it onto a ring where two adjacent arcs have no relation beyond "the angles
touch". Sunburst's module, data file and harness are **kept and unimported**, the
same way `interdisc-network.js` was kept after the matrix replaced it.

**Evolution replaced River** (`web/evolution-strata.js`, mode id `evolution`). A
streamgraph makes time a set of parallel bands and normalises every year to 100%,
so a year with 6,870 works and a year with 10,872,134 are drawn the same height —
the absolute growth of science, the one thing this snapshot measures well, is
normalised away. The replacement is a **geological cross-section**: time runs
vertically (1827 at the bottom, the way strata are laid down), a layer's *width* is
that year's volume, and the bands inside a layer split by subject share in a **fixed
order that never changes**. Fixed order is what makes uplift legible — a rising
subject thickens in place and reads as pushing up through its neighbours, whereas
re-sorting each year by size turns structure into noise. The button is `Evolution`,
not `Strata`, because the alluvial button is already labelled "Strata".
`?mode=river` still opens it — the mode id `river` is kept as an alias so old deep
links do not break. River's module, harness and mutation runner are **kept and
unimported**, same pattern again.

Generate the first two (one script, one pass over `asset/data.tsv` + `asset/keys.tsv`):

```powershell
node scripts/build-science-views-data.mjs
```

The third is a network snapshot, committed so that everything afterwards is offline
— the same one-shot-bootstrap pattern as `Philpapers-API/src/fetch_categories.py`:

```powershell
node scripts/fetch-openalex-history.mjs
```

```bash
node web/check-coral.mjs         # 169 checks
node web/mut-coral.mjs           # 27 ways to break knowledge-coral.js
node web/check-interdisc.mjs     # 199 checks
node web/check-mycelium.mjs      # 99 checks
node web/check-evolution.mjs     # 149 checks
node web/mut-evolution.mjs       # 18 ways to break evolution-strata.js
node web/check-river.mjs         # 125 checks (kept; the view is no longer imported)
node web/check-sunburst.mjs      # 141 checks (kept; the view is no longer imported)
```

`web/check-science-views.html?view=coral|interdisc|mycelium|evolution` is the shared
browser companion for all four: one page, not four near-duplicate files, because the
driver (world transform, legend, hover wiring, font-metric capture) is identical
and only the module, dataset and probe target differ. It wraps `fillText` to
recover **real font metrics** — the Node checks use a stub `measureText`, which
can prove the avoidance algorithm separates overlapping pairs but cannot know
whether the *real* font makes two labels touch. One detail is worth stealing:
`check-evolution.mjs`'s stub is **proportional to the font size** (6.5 px per
character at 11.5 px) rather than a flat 6.5 px, because the evolution band names
are drawn at a size that varies with the zoom. With a flat stub the "narrow window
→ the row overflows" path cannot be reproduced in Node at all, and the first
version of that fix passed every assertion while still being wrong.

**Coral.** The data has always had a third tier — `asset/data.tsv` carries
**85,643 clusters** with real dimensionality-reduced coordinates, a discipline
label and a recent-article count summing to **25,968,533** (exactly
`meta.totalArticles`), plus 426,647 (cluster, concept) pairs referencing all
274,422 keywords. So `Domain → Cluster → Concept` is the data's real hierarchy, and
the cluster tier is what the coral grows from. What it is **not**:

- **The topology is grown by an algorithm, not given by the data.** A cluster holds
  1–5 concepts and concepts are shared across clusters, so drawing the literal
  parent/child edges gives a hedgehog. The data supplies **position, weight and
  colour**; space colonisation supplies the branching.
- **The attractors are aggregated.** The 85,643 clusters average 1.18 map units
  apart — as attractors they smear into a single field, so clusters are merged per
  cell into ~500 attractors whose weight is their sum. A branch's article count is
  real; "one attractor" ≠ "one cluster".
- **There are not 11 tidy limbs, and they are not colour-pure.** A single base means
  one lineage is born first and wins: measured, the root's heaviest child carries
  97.4% of all articles (HHI 0.949) and the trunk does not truly fork until **depth
  33**. What forks there is no better — 4 branches, of which only 2 are ≥1%
  (5.8% and 2.6%; the other two sum to 0.04%), and **the four together hold 8.5%**.
  The other 91.5% is carried by tufts grown all the way up the trunk, so "the main
  branches" is inherently a weak summary of this object — the legend says so
  explicitly instead of smoothing it over.
  Disciplines are also interleaved in map space — growing each discipline
  separately yields 1–10 nodes each — so a branch's colour can only mean "who it
  served", and neighbouring limbs are often the same colour. Both facts are printed
  in the legend rather than smoothed over.
- **Thickness is article-weighted, and that weighting is extremely skewed**: 70% of
  nodes (95% of tips) sit on the 1.2 px floor, so the readable thickness lives in
  the trunk and the first few limbs (p90 2.6 px, p99 6.9 px, max 44 px). Real coral
  has an invisible capillary bed too; drawing it as grey fog would be blurrier, not
  more complete. This is also what pins the layer count: at 4 levels 79% of nodes
  are on the floor (p90 1.8 px), at 6 levels 87% are (p90 1.4 px) and the thickness
  channel is effectively dead.
- **The growth is frontier space colonisation with an angle gate.** Nearest-node
  assignment (Runions' original) degenerates into a single snake in a uniform dense
  field; no gate at all gives a fan exploding from the root. `check-coral.mjs` pins
  all three regimes with measured bands (depth ≤ 400 — the naive single-level run
  reaches 1,197; fork ratio ≥ 8% — the caterpillar measures 2–4%). The step size is
  **one cell, not two**: at two cells a node outruns the distance over which the
  attractors can turn it, so the trunk comes out as straight spokes (a dandelion,
  seen in a headless screenshot). Halving it gives 3,616 → 8,614 nodes, 608 → 1,486
  forks and a genuinely curved trunk, for ~170 ms of extra `setData`.

- **Rendering is tapered, so it goes through an offscreen layer.** Chained degree-2
  paths become miter-offset polygons with semicircular caps: 8,614 nodes → 3,445
  chains → **11 `fill()` calls** and one `drawImage` per frame, with the cached and
  direct paths asserted byte-identical.


**Sunburst** *(no longer reachable from the UI — replaced by Coral; the module, data
file and harness are kept, and the notes below still describe them).* Three real
tiers only: all of science → 11 `cluster_category` → the
299,286 (domain, keyword) arcs. There is no Field/Subfield tier to draw:
`key_concepts` is free text, `labels.tsv` holds 49 Polish labels, and
`foreground.svg` is decorative (`foreground.js` only calls `getBBox()` and never
joins it to a cluster). Inserting two invented middle tiers would be drawing my own
taxonomy, not the data.

All 299,286 arcs are drawn with no truncation. Angle is **article × topic pairs**
(129,731,896), not articles (25,968,533) — the two differ by 5× and using the wrong
one is invisible, since every arc's *relative* proportion stays right and only the
ring's absolute length is wrong. Article×topic is chosen because it is measured
directly, closes the two rings exactly, and yields percentages identical to the
article count to within 0.1% (every cluster carries 4.94–4.99 keywords in all 11
disciplines), so the choice moves no conclusion a reader can draw.

Each arc takes its **discipline's** hue (11 of them) and its weight's opacity — two
channels, two quantities, neither doing double duty: colour says *which* discipline,
opacity says *how heavy* that topic is. Colour follows the entity and never the
rank, so dimming one discipline does not repaint the others.

The 11 hues are the weakest claim this view makes, and nothing in it rests on them.
The identity channels are the on-ring direct labels (one per discipline), the radial
wedge dividers and the legend, and the header says as much in words — "Identity does
not rest on colour". It has to say it: 11 categorical hues on a dark surface in the
strictest all-pairs case (any two disciplines can end up adjacent) are exactly what
the dataviz validator exists for, and they have **not** been through it — see
"Colour validation status" below. A reader with deuteranopia may well be unable to
separate two neighbouring wedges by colour alone; the label is the fallback, and it
is always drawn.

Rendering: the 299,286 arcs are *drawn* with 430 `arc()` ops, not 598,572. Weights
are stored non-increasing within a discipline and `bucketOf` is monotone in weight,
so each (discipline, bucket) pair occupies one **contiguous** angular run — measured
at 299,275 descending pairs and 0 ascending. A run is therefore a single annulus
(one forward arc on the outer edge, one reversed on the inner), and the 11 × 24
possible buckets collapse to 215 non-empty `Path2D`s. That took the first frame from
**3,928 ms to 52 ms** (later frames 2.7 ms). The harness checks the merge by
**tiling rather than counting**: the emitted runs leave no gap and do not overlap,
so every topic arc is covered exactly once. Counting 430 or 598,572 ops would pass
either way — it cannot see the double-covering that the old per-arc loop would hide.

Known trade-off: the outer ring is about 1,670 px around for 299,286 arcs — roughly
179 per pixel — so the weight-1 arcs (263,881 of them, 88%) stack into a soft
uniform haze. That is the shape of "draw them all"; drawing only weight ≥ 2 would
drop about nine tenths of the arcs, against the explicit choice.

**Interdisc — a clustered adjacency matrix, not a network.** 11 nodes plus 55 edges
is 66 identifiable objects. Network already draws node-link at 211,391 objects, so a
second node-link diagram of 11 discs can only be a low-resolution copy of it — and it
discards the thing that actually varies, since each pair shares between 51 and 2,861
terms and one band width is a lossy summary of that. This mode therefore has **no
nodes and no edges**: the pair *is* the mark, and the interior of a pair is where the
detail lives.

Three levels, all matrices:

| Level | What | Cells |
|---|---|---|
| L0 | 11×11 symmetric matrix over `sunburst-data.json`, cluster-ordered | 121 |
| L1 | click a cell → that pair's shared terms × 11 disciplines | ≤ 2,861 × 11 = 31,471 |
| L2 | click a term → its 11 discipline weights, and where else it appears | 11 + 121 |

An L0 cell carries **two channels**, the same split the old diagram made between
width and colour: the base fill is a single-hue sequential ramp over `Jaccard(i,j) =
shared/(a+b−shared)`, and the inset square's **area** is `shared` — area rather than
side, so the second channel stays comparable across a 51-to-2,861 range. The diagonal
is drawn separately: it is a discipline's own term count, not a pair, and `describe()`
will not call it "shared". Both marginals are one numerator over two different
denominators — `OUTWARD_i = Σ_{j≠i} shared(i,j) / (10 · topics_i)` (how much of my
vocabulary leaves) and `INWARD_i = Σ_{j≠i} shared(i,j) / Σ_{j≠i} topics_j` (how much
of everyone else's arrives). Those are genuinely different numbers, and swapping the
INWARD denominator for `topics_i` collapses them into each other — which is one of the
mutants, not a hypothetical.

Rows and columns are reordered by **agglomerative clustering** (average linkage on
`d = 1 − Jaccard`) so that disciplines sharing vocabulary sit together. The order is
derived, not curated, and the legend says so. The 11 discipline hues appear only on
the axis labels, the marginal bars and the L1 column heads — never as the matrix's own
colour, which stays one hue.

The derivation runs in the browser off `arcs`: one pass over 299,286
`[discipline, topic, weight]` triples yields 35,313 shared-term pairs, 18,146 terms in
two or more disciplines, a maximum Jaccard of 3.81% and a maximum `shared` of 2,861 —
no new data file. `interdisc-data.json` survives as an **independent second source**:
its 55 precomputed `shared` values are compared cell by cell against the derivation,
and all 55 agree.

The lift/null-model result below is unchanged and still true — it is simply no longer
a visual channel, because the matrix spends its two channels on Jaccard and `shared`.
Edge width being dominated by volume, the old view's inherent cost, is gone with the
channel: Jaccard now leads and `shared` sits inside it, so a large discipline no longer
draws a thick line into everything it touches.

`lift` is deliberately *not* drawn anywhere, because it is inert here: all 55
pairs share fewer keywords than chance would predict (lift 0.05–0.57, none above
1). The expectation uses a permutation null model over cluster→discipline labels,
`P(kw ∈ A∩B) = 1 − C(N−a,f)/C(N,f) − C(N−b,f)/C(N,f) + C(N−a−b,f)/C(N,f)`, which is
identically zero at f=1 — a keyword in one cluster cannot be shared. Of 274,422
keywords, 237,325 (86.5%) are f=1 and structurally unshareable, so the naive
independence model overestimates expectation. `interdisc-data.json` ships the
frequency histogram; the lift arithmetic above was verified against it at the time
this was a visual channel (a Lanczos `lgamma` in that version of the harness), so
"every pair is below chance" is a verified result rather than an assertion — it is
just no longer drawn. The conclusion is real: the vocabulary is strongly
discipline-closed even for keywords as frequent as f=1,048.

The old node-link module (`interdisc-network.js`) is still on disk and no longer
imported; `main.js` points at `interdisc-matrix.js`. It was left in place rather than
deleted, so the two can be compared.

**Mycelium.** The question the matrix cannot answer is *which* concepts cross, not how
many. So this view draws **every one of them**: 35,313 micro-fibres, one per
(topic, unordered discipline pair), flowing between eleven irregular source fields.
It has no nodes and no edges. Network is object topology — 211,391 nodes, who connects
to whom; this is knowledge-transfer topology — where the vocabulary actually moves.
A second node-link diagram of eleven discs would just be Network at low resolution.

The fields are not placed by hand and not evenly spaced. A deterministic spring
relaxation on `d = 1 − Jaccard` pulls strongly-connected disciplines together
(Spearman **−0.77**; the strongest three pairs average 66 px apart, the weakest three
310). The module computes that number and prints it in the legend rather than quoting
a hard-coded figure — an earlier draft printed `−0.73` while the layout had already
moved to `−0.77`, which is exactly the second-account-that-diverges bug this codebase
keeps hitting, and `check-mycelium.mjs` now cross-checks the two.

Each fibre's endpoint inside a field comes from `hash(topic, discipline)`, so the
`C(k,2)` fibres of one topic leave each field it belongs to **from the same point** —
a topic shared by four disciplines forks, without any code that draws a fork. The path
is a blend of the straight chord and a **corridor**: a streamline integrated through a
flow field that attracts toward the target field and repels away from the other nine,
so no corridor is ever drawn through a third discipline's field. `β(s) = sin²(πs)`
keeps both endpoints exact while pulling the middle onto the corridor, which is what
turns 640 fibres into a visible bundle instead of a smear.

Two rendering decisions are load-bearing. The 35,313 fibres are stroked in **64
batches**, each with `globalCompositeOperation = 'lighter'` — a single `stroke()`
composites the whole path once, so interior self-overlap does not accumulate and a
bundle would come out exactly as bright as a stray fibre, which is why `BATCHES = 1`
is one of the mutants. And the fibres carry **one hue**: the eleven discipline hues
appear only on the field glows, so identity never depends on telling two hues apart
and the unvalidated categorical set is inherited without being load-bearing.

Honest boundaries, both in the legend: 256,276 of 274,422 topics (**93.4%**) belong to
exactly one discipline and emit no fibre at all — the mycelium grows from 6.6% of the
vocabulary, which is the shape of the data and not an omission. And 35,313 one-pixel
lines in a 1600×900 world overlap heavily, so **bundle width is a density, not a
channel you can read a count off**. Counts live in the hover readout.

Those two boundaries were also stamped **on the figure**, as a three-line caption at the
top-left: the fibre count, `bundle width is density, not a count`, and a `→ <field>` tag
on hover. Removed, for the same reason the science-mode title stamps were removed — it
restated the UI back at the reader. The legend already carries both sentences verbatim,
the hover tag was a shortened `describe()` whose full version lands in `#hoverInfo` on
every hover anyway, and the field names are drawn on the fields. Nothing is now said
once on the canvas that the legend or the hover readout does not also say.

**Evolution.** OpenAlex works per `primary_topic.field.id` per `publication_year`,
1827–2024 (198 years), 26 fields — the same snapshot River read. Each year is one
horizontal layer, oldest at the bottom the way strata are laid down. A layer's
**half-width** is `maxHalf · √(that year's works / the largest year's works)`, and
the bands inside it split by that year's subject share in a **fixed order**, so the
outline of the column is the absolute volume of science while the division inside a
layer is its composition. Two channels, one quantity each.

**Why √ and not linear — a deliberate departure from the requested geometry.** The
brief asked for absolute width. Measured: the widest year (2020, 11,473,511 works)
is **1,670×** the narrowest (1827, 6,870). On a linear scale 1827 would be **0.85 px**
wide, 71 of 198 years would fall under 8 px and 11 under 1 px — not "thin", but
literally unrenderable, with the entire 19th century a sub-pixel hairline. So the
width is the square root: 1827 becomes 34.6 px, the narrowest layer 32.9 px, and no
year is under 8 px. This is not a cosmetic compromise — it makes a layer's **area**
proportional to its volume, which is what area perception actually reads, and it is
the same rule Coral already uses (`r ∝ √W`). What is *not* changed is "absolute":
the outline is driven by absolute work counts, not by share — which is precisely
what River did and what was wrong with it. The cost is that lengths read off an edge
are not linear, and the legend says so. `check-evolution.mjs` asserts both halves:
the envelope is exactly `maxHalf · √(total/maxTotal)` for all 198 years, **and** 1827
is more than 8 px wide — the assertion a linear build would fail.

**The bands' order is fixed and that is load-bearing.** Top 8 by 2024 share +
`Other (18 fields)` + `Unclassified`, the same order in all 198 layers, never
re-sorted by the year being drawn. That is the whole mechanism by which uplift is
visible: a subject keeps its horizontal position, so a rising share thickens that
band in place and it reads as pushing up through its neighbours. Re-sorting per year
would shuffle the bands and turn structure into noise; one of the 15 mutants is
exactly that change, and `check-evolution.mjs` catches it by testing that most
layers are *not* sorted by size.

`Unclassified` is a separate grey band, never folded into `Other`: in 2024,
913,394 of 10,872,134 works (8.4%) have no `primary_topic` and therefore no field.
`check-evolution.mjs` decodes the drawn band widths back into absolute work counts
to confirm the normalisation denominator is the *total* work count, not the
classified one — the failure that would silently flatten the grey band while leaving
"the widths sum to the layer width" still perfectly true.

**Faults are annotations, not displacement.** A fault is a **run** of consecutive
years whose subject composition moved more than a threshold, computed at runtime as
the **90th percentile of the measured series** — not a chosen constant. The
statistic is the total-variation distance (half-L1) between consecutive 5-year
smoothed share vectors over the 26 classified fields. Unsmoothed, the leaders are
10.2% in 1850 and 8.5% in 1877, which are **sampling noise** — 1827 holds 6,870
works in total, so a handful of papers moves a share — so the series is smoothed
before the threshold is taken (p90 = **1.66%**), and runs averaging under 100,000
works are labelled **`low n`** rather than read as history. The measured runs are
1830–31, 1834–35, 1840, 1845–49 and 1851–52 (all `low n`) against 1943, 1946–49 and
2019–21 (all well-sampled). The year axis stays **linear**; a fault never bends the
layers, because bending them would destroy the linear axis that every reading off
this figure depends on.

2025 and 2026 are **excluded from the drawing**: the unclassified rate jumps to
24.4% and 70.3% because OpenAlex has indexed those works but not yet classified
them — an indexing artefact, not a change in science. The raw counts stay in the
JSON and `meta.excludedYears` records why. `check-evolution.mjs` asserts no vertex
of the column falls in either year.

Honest boundary: this data supports **uplift, erosion, revival, faults and
intrusions**, and the legend says exactly that — but **not birth and not
extinction**, because all 26 fields have a non-zero count in **every one of the 198
years**, so nothing is born or dies inside this window; what looks like an arrival
is a *share* rising from near 1% (Computer Science 0.77% → 6.74%). And it cannot
show **splitting or merging** — OpenAlex's field taxonomy is fixed over time and
every work carries exactly one `primary_topic`, so "one discipline split into two"
is not an observable event in it. Both negatives are asserted, not assumed:
`check-evolution.mjs` fails if any field ever reaches zero in the window. Reaching
the subfield tier (~250 subfields, ~500 more requests) would be follow-up work, not
done here — and the user explicitly chose the 26-field tier for this view.

**Colour validation status — an open gap.** The plan required running the dataviz
palette validator (`validate_palette.js`, six checks including CVD ΔE) over the
categorical sets rather than judging them by eye, and **that has not been done**:
the run was denied twice, and the denial covers the outcome, so it is not something
to route around. What that leaves unverified, honestly:

- Interdisc's **matrix** needs no categorical validation — it uses a **single hue**
  with lightness for magnitude, which is the sequential rule (one hue, light→dark),
  and identity is carried by the row/column position and the written axis labels, not
  by cell colour. Its 11 discipline hues do appear on the axis labels, the marginal
  bars and the L1 column heads, so those places inherit the sunburst's unvalidated set
  — but nothing there depends on telling two hues apart, because each is labelled.
- The Sunburst's **11 discipline hues are categorical**, on a dark surface, in the
  all-pairs case — and they are **not validated**. This is the largest thing left
  unverified in these three views. Their separation is the one job colour is doing
  here that no other channel repeats (the labels name each wedge but do not tell a
  reader that two *distant* wedges are the same discipline). Earlier the sunburst
  was single-hue and needed no validation; per-discipline hues were the explicit
  request, so the view moved *into* the unverified category rather than quietly out
  of it. ATLAS uses the same 11 hexes, so it carries the identical gap, and so does
  **Coral**, which inherited the set when it replaced the sunburst. Coral's exposure
  is deliberately smaller: a branch's identity is carried by its **position and
  thickness**, the legend names all 11 hues, and every discipline is labelled on the
  canvas — the colour is a reading aid, not the channel that separates anything. The
  gap is not smaller in principle; it is smaller in what depends on it.
- Evolution's **8 field hues** are `CATEGORICAL_8_DARK` from
  `scripts/science-categories.mjs`, and unlike the sunburst's set this one is
  claimed to be **verified for the relationship that is actually used**: those
  eight slots are the reference palette's dark set in which *adjacent* pairs pass
  every gate, and stacked bands are an adjacent-only relationship — a reader
  compares a band with the two it touches, never with one across the figure. That
  is a categorical claim (`scripts/science-categories.mjs` documents that 11
  categorical hues can never pass all-pairs) and it belongs to that script's own
  record, not to a run made here; what this view adds is that it only ever asks for
  the adjacent case. As before the compensating measures are in place regardless —
  every band is directly labelled at the top layer, the legend names all ten,
  hovering names it — and the 2 px surface spacer between stacked fills is again
  deliberately **not** used, because the invariant is that band widths sum to
  exactly the layer width. So identity does not rest on colour alone.

Directly labelling every band means the ten names share one row along the top of the
figure, and that row is the one place where a screen-space constant becomes a world-space
variable: the names are drawn at `FONT_LABEL / k` px so they keep their size on screen,
which makes a narrower window produce a *wider* row in world units. At 1600 px it fits; at
1280 px it did not, and because the placement only pushed neighbours apart it pushed the
outermost name — `Unclassified` — off the right edge, half cut. Nothing failed: the figure
drew, every readout was correct, and only a screenshot showed it. The row is now bounded:
the font shrinks until the names fit (never below 0.72×, so they stay legible) and the
widest are dropped only if that is still not enough — they remain readable in the legend
and on hover. The survivors are placed by blending the packed arrangement (left edge at
the world's left edge, packed tight; always fits, since the row width is checked first)
with the positions directly above their own bands, bisecting for the largest blend that
stays inside `[x0, x1]`. A one-sided greedy is not enough here: the *ideal* spacing
between names can exceed the packed width, so the row's right end lands outside the box
and shifting the whole row left pushes the leftmost name out instead — that was the first
version of this fix, and the check below caught it. `check-evolution.mjs` draws at
k = 1, 0.9, 0.8, 0.7, 0.6 and 0.5 and asserts that no name leaves the box and no two
overlap, that nothing is dropped while the row fits, and that at k = 0.5 at most the
widest couple are. `mut-evolution.mjs` breaks all three halves of that (unbounded
placement, no shrink-to-fit, no neighbour separation). Measured `edge ink = 0` with
`png-ink.mjs` at 1600×900, 1440×900 and 1280×720 through `_diag.html`, which is where the
framing claims below are made: at 1280×720 the same measurement read `0/16/0/0` before
the fix (the 16 was that clipped name).

**Where these three differ from the older science maps.** They keep the bottom-left
panel, and they are the only modes whose framing avoids it. The panel is a
fixed-size screen-space box pinned bottom-left; the figure is scaled world-space
content. So *which* part of the figure the panel covers changes with window size —
at 1280 px the panel buried 4 of the Interdisc view's 11 discipline labels, and widening
a view's left padding would only have moved the problem to another window size.
`freeViewport()` in `main.js` therefore measures the panel's actual rect and fits
the figure into what is left, which is correct at every size and also means that
collapsing the legend with `−` makes the figure grow. Verified `covered=0` labels
at 1600×900, 1440×900 and 1280×720 through `_diag.html`, which wraps `fillText`,
converts each label through its own draw-time transform matrix, and intersects it
with the panel's bounding box.

Two things make that `covered=0` mean something rather than nothing, and both are
worth copying for any future claim of this shape:

- **The probe reports a per-frame high-water mark, not a spot reading.** `clearRect`
  is the frame boundary; the number in the title is the worst frame seen, and the
  label count is that same frame's. A spot reading taken between `clearRect` and the
  first `fillText` says `covered=0 labels=0` — a vacuous zero, indistinguishable
  from the good result. `_diag.html`'s title was exactly that bug until it was
  fixed; the sweep now also refuses to accept any row where `labels=0`.
- **The fix has a negative control.** `?main=_mut-main.js` makes `_diag.html` load a
  copy of `main.js` with `panelAwareMode()` forced to `false`. Same probe, same
  window, one line different: the real build reports 0 covered labels at every size,
  the mutant reports 2–8 — `[Chemistry(5px) Engineering(28px)]`,
  `[Social Science(17px) Computer Science(81px) Engineering(65px) Physics(16px)]`.
  In 8 of the 9 mode×size combinations the control fires; the 9th (Interdisc at
  1440×900) reads 0 in both, so the control is simply invalid at that size — the
  panel would not have collided there either way. `_mut-main.js` is a generated
  diagnostic copy, untracked, like the `_app-*.png` screenshots beside it.

### Science-mode chrome

Atlas, UCSD and Alluvial share one rule: **the figure gets the whole canvas**. Two
pieces of chrome were removed for that:

- The on-canvas title stamp — `Atlas` / `research volume terrain` and its two
  siblings, drawn top-left by `drawScienceFrame`. The mode is already named by the
  highlighted toolbar button, so the stamp restated the UI back at the reader.
  What remains is `drawScienceVignette`, the radial glow that was always painted
  underneath it.
- The bottom-left HUD panel (the declaration/relation gauges plus the Subjects
  list), suppressed via `body.science-mode` in `index.html`. On a terrain map that
  list sat directly on top of the data to restate what the map already shows.
  The `−` toggle goes with it, since the panel was the only thing it toggled.

This is deliberately narrower than `isStaticMode`: overview, hive and philosophy
all need that legend to be usable, so they keep it. `body.science-mode` is set
from `isScienceMapMode()` in `web/main.js`.

Coral, Interdisc, Mycelium and Evolution are static modes but are **not** in
`isScienceMapMode()`, on purpose. Each carries its own long legend — 11 discipline
names and colours for three of them, ten band names plus the honesty notes for the
stratigraphic column — and that legend *is* the colour key. Hiding the panel as Atlas/UCSD/
Alluvial do would leave unlabelled hues with no way to read them. They pay for it
by framing around the panel (see above). Coral's legend carries four explicit
honesty boundaries (grown topology, aggregated attractors, colour-impure limbs, and
how many of the limbs are actually substantial), because it is the one view here
whose *shape* is produced by an algorithm rather than read off the data.

Coral draws each discipline name **twice** — a 0.6 px offset dark copy underneath
the coloured one, so the label survives sitting on a branch. The label-overlap
probe in `check-science-views.html` counts those two passes as two labels and
reported every one of them as a collision ("Biology / Biology 13.4px"). Two boxes
of the *same string* within 3 px are one label, so the probe now skips that pair;
two different disciplines can never share a string, so nothing real is masked.
With that, coral measures `overlaps=0 labels=22` at 1600×900, 1440×900 and
1280×720, and `overflow=no covered=0` through `_diag.html?mode=coral`.

One trap when screenshotting for that check: with `--headless=new`, `--window-size=1280,720`
is that build's *default* window size, so the flag is a no-op and the page is captured
against a fit computed for an earlier, wider layout — the figure then bleeds under the
panel and off the right edge. Measuring the ink bounding box of the PNG caught it
(154 px of ink in the last two columns, 19,145 px in the gutter beside the legend);
`--headless=old`, and every neighbouring size under either mode, fits correctly
(`edge ink = 0`, `gutter ink = 0`, coral widths 833 / 713 / 593 px at the three sizes).

Removing the panel also un-covered `drawScienceLegend` — a canvas-drawn category
key at the bottom-left of the *world*, which the HTML panel had been sitting on
top of. It was only ever visible on narrow windows where the panel did not reach,
and it is now deleted rather than left as a second, occasionally-appearing list.

### Atlas label placement

`drawScienceLabels` used to draw each cluster name **left-aligned starting 8 px to
the right of its anchor** (`x = p.x + 8 / k`), and never set `ctx.textAlign` — it
inherited the canvas default `start` while its collision box was written for left
alignment. The whole weight of a name therefore sat to the right of the point it
names: a 44-character label is ~310 screen px wide, so its centre sat ~160 px right
of the anchor, and the three right-most names (anchors at world x 1390–1404) ran
**past the 1600-wide world box by 75 / 111 / 117 px** — surviving only because
`SCIENCE_ZOOM = 0.92` leaves the box that much clear of the viewport edge. Canvas ink
at 1600×900 (band y ∈ [80, 830], clear of the chrome) reached x = **1596**, 11 px past
the search box's own right border at 1585.

That skew was the labels, not the data: the atlas points span world x ∈ [104, 1508] —
margins of 104 and 92 — so the figure was centred all along, while the drawn names
spanned [190, 1717]. `cleanScienceLabel`'s hard `slice(0, 44)` is a separate,
deliberate truncation and was left alone.

Names are now **centred on the density centroid of the cluster they name**
(`atlasLabelCentre`): the density-weighted mean x of every grid cell within
`ATLAS_BLOB_R = 80` world px of the anchor (80 ≈ 9 cells, at 1600/180 px per cell),
with `ctx.textAlign = 'center'` set explicitly. Across the 150 ranked candidates the
centroid moves a name a median of 7 px and at most 33 px off its anchor — the fix is
the *weight* of the name, not its address. The box is then clamped into `[0, WORLD_W]`,
which is inactive at the default fit (k ≈ 0.82 at 1600×900) and binds from k ≤ 0.7,
where the 1/k font makes the same name wider in world units.

| | names drawn | text spans world x | past the right edge |
|---|---|---|---|
| before (left-anchored) | 48 | [190, 1717] | 3 (75 / 111 / 117 px) |
| after (centred + clamped) | 45 | [26, 1540] | 0 |

Through `_diag.html?mode=atlas`, same ink band: right edge 1596 → **1437** at 1600×900,
and `[102, 1286]` / `[165, 1085]` at 1440×900 / 1280×720, edge ink 0 at all three. The
width coefficient 0.5652 px per character per px of font size is the same one the
evolution harness's font stub uses, and it reproduces the pre-fix screenshot to ~3 px.
Centring costs three names — they now collide with a neighbour's box and the greedy
placer drops them.

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
  alluvial-chart.js       Alluvial view: aggregation, layout, draw, hit-testing
  check-alluvial.mjs      Node harness for the alluvial geometry invariants
  check-alluvial.html     Browser render check (real font metrics)
  phil-chord.js           Philosophy cross-listing chord view
  check-phil-chord.mjs    Node harness for the chord geometry invariants
  check-phil-chord.html   Browser render check for the chord view
  sunburst-chart.js       Science sunburst: 11 domains, 299,286 topic arcs (retired from the UI)
  knowledge-coral.js      Knowledge coral: frontier space colonisation over 85,643 cluster attractors
  interdisc-matrix.js     Clustered adjacency matrix + pixel heatmap + marginals
  interdisc-network.js    The superseded node-link view; no longer imported
  evolution-strata.js     198-year stratigraphic column: √volume width, fixed band order (OpenAlex fields)
  evolution-river.js      The superseded share-of-year river; no longer imported
  mycelium.js             35,313 concept fibres between 11 source fields (flow field + bundling)
  check-coral.mjs         Node harness: 169 checks over growth, thickness, colour, cache
  check-sunburst.mjs      Node harness for the sunburst geometry invariants
  check-interdisc.mjs     Node harness: 199 checks over the matrix, marginals, clusters
  check-mycelium.mjs      Node harness: 99 checks over fibres, corridors, bundling, batches
  check-evolution.mjs     Node harness: 149 checks — decodes the √ envelope and band widths off the vertices
  check-river.mjs         Node harness: decodes band thickness back to counts (retired view)
  check-science-views.html Shared browser check for the four views above
  mut-legend-onchange.mjs Mutation runner: breaks the legend-click → repaint wiring
  mut-interdisc.mjs       Mutation runner: 25 ways to break interdisc-matrix.js
  mut-coral.mjs           Mutation runner: 27 ways to break knowledge-coral.js
  mut-mycelium.mjs        Mutation runner: 16 ways to break mycelium.js
  mut-evolution.mjs       Mutation runner: 18 ways to break evolution-strata.js
  mut-river.mjs           Mutation runner: 14 ways to break evolution-river.js
  _diag.html              Diagnostic page: layout probe + ERRS, reads out via <title>
  _mut-main.js            Generated diagnostic copy of main.js (panelAwareMode off)
  sunburst-data.json      Generated (9.3 MB, gitignored — see above)
  coral-data.json         Generated (4.6 MB, gitignored): the 85,643-cluster tier
  interdisc-data.json     Generated (10 KB, gitignored — see above)
  openalex-history.json   Committed OpenAlex snapshot (34 KB)

scripts/
  build-addon-decls.mjs   Shared extractor for addon Lean repositories
  build-history.mjs       Module-level Git history extractor
  build-unified-decls.mjs Unified dataset builder
  build-science-views-data.mjs Sunburst + interdisc + coral data (one pass, three files)
  fetch-openalex-history.mjs   One-shot OpenAlex snapshot (shared by River and Evolution)
  build-science-atlas-data.mjs Atlas/UCSD data (imports science-categories.mjs)
  science-categories.mjs  The 11 cluster_category names by id, plus palettes

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
