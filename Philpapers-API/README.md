# PhilPapers Taxonomy Map

Builds the complete PhilPapers philosophy category taxonomy into a local,
navigable tree — a JSON hierarchy, a flat lookup table, and a self-contained
HTML map you can open by double-clicking.

**6,135 categories · 8 levels deep · 1,295 cross-listed.**

---

## Scope and licensing — read this first

This project is for **personal, local research use only.**

PhilPapers' terms of use **severely restrict redistribution of their data.**
Everything derived from the taxonomy is written to `data/` and `output/`, both
of which are gitignored. Do not commit, publish, or redistribute them.

This repository contains **no scraping of philpapers.org** — no HTML parsing,
no headless browser, and no access to `/browse/all`. PhilPapers' `robots.txt`
prohibits automated collection of their content, and we respect that.

### Where the data comes from

The official API endpoint (`philpapers.org/philpapers/raw/categories.json`) sits
behind a Cloudflare JS challenge and returns **HTTP 403 regardless of whether
your credentials are valid**, so it is not usable — even with an API key. That
is why every project that used it now relies on a cached snapshot.

This project therefore reads a publicly hosted copy of the payload captured
while the API was still reachable:
`rookslog/sophotron` → `data/categories.json`.

That is a **third-party redistribution, not an official channel.** Using it
locally for research is the intent here; republishing it is not. If you need a
licensed copy, contact PhilPapers directly.

---

## Install

Requires Python 3.11+. Runtime is **standard library only** — there is nothing
to `pip install`.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -U pip pytest   # pytest only, for the tests
```

On macOS/Linux use `.venv/bin/python` instead of `.venv/Scripts/python`.

## Run

```bash
# Build from the local snapshot
.venv/Scripts/python src/pipeline.py

# Download the snapshot first, then build
.venv/Scripts/python src/pipeline.py --fetch

# Build from a snapshot you placed somewhere else
.venv/Scripts/python src/pipeline.py --raw path/to/categories.json
```

Once the snapshot is in `data/categories.raw.json`, **every later run is fully
offline.** Re-running never needs the network again.

Example summary:

```
records 6,134 | nodes 6,135 | roots 1 | max depth 8 | cross-listed 1,295
diagnostics: EMPTY_NAME=1, MOJIBAKE_REPAIRED=31, SYNTHETIC_ROOT=1
```

## Outputs

| File | Contents |
|---|---|
| `output/philpapers-taxonomy.json` | Nested tree — root node with recursive `children` |
| `output/taxonomy-flat.json` | `{id: {name, parentIds, primaryParentId, depth, path, childCount}}` |
| `output/report.json` | Diagnostics: stats and problems grouped by kind |
| `output/map.html` | Self-contained radial map of the whole taxonomy |
| `output/chord.json` | Cross-listings between branches, one chord per category |

Add `--web-dir ../web` to also write `philpapers-chord.json` into the sibling
`Unified Science Map` app, which serves it as its **Philosophy** mode.

`map.html` inlines its data rather than fetching it — browsers block `fetch()`
on `file://` URLs for CORS reasons, so inlining is what lets you just open the
file. It has no CDN, no framework and no external requests, and works offline
permanently.

### The map

All 6,135 categories are drawn at once as a **radial dendrogram**: the root sits
at the centre, depth is radius, and each leaf owns an equal slice of the circle —
so a domain's arc is proportional to how much taxonomy it actually contains.
The seven top-level domains take the seven categorical colours, in fixed order,
as a wedge tint, an edge colour, a ring segment and a labelled legend entry.

- **Drag** to pan, **scroll** to zoom, **`+` / `-` / `0`** for the keyboard.
- **Hover** any node to trace its full path back to the root; **click** to pin it.
- The **search box** filters by name (accent-insensitive, so `godel` finds
  `Gödelian`) and opens the results table; **Enter** jumps to the first match.
- **Domains** opens the domain table; clicking a legend chip isolates a domain.
- **Theme** cycles system / light / dark.

Colour is never the only channel: a legend, direct labels on the ring, and the
hover tooltip all name the domain. The palette is validated for colour-vision
deficiency on adjacent pairs in both modes — the all-pairs list does not clear
the floors, which is exactly why the direct labels are mandatory rather than
decorative.

It is drawn on a **canvas** rather than as SVG: six thousand SVG elements would
mean six thousand DOM nodes to relayout on every pan. The canvas redraws the
scene in a handful of batched calls.

### The taxonomy is a DAG, not a tree

About 21% of categories have more than one parent. Each record carries two edge
sets:

- `parentIds` — **all** parents (the DAG)
- `primaryParentId` — the one parent used for the main hierarchy

The nested output navigates by primary parent and **keeps `parentIds` on every
node**, so nothing is lost: walk `children` to browse, read `parentIds` for the
cross-links. The map reports them in the hover tooltip, under "also under".

The root (ID `1`) is **referenced by every top-level category but has no record
of its own** in the payload, so it is synthesized and flagged
`synthetic: true`.

### The chord view

The radial map draws the *generating tree*, so it shows how the taxonomy is
organised but not how its branches interpenetrate. `chord.json` throws the
interior away and keeps only the DAG edges that cross between branches.

**One chord = one category.** A category filed under more than one parent gets a
ribbon from the branch holding its primary parent to the branch holding each
extra parent. So each ribbon can name the specific category it stands for, and
hovering a bundle lists the categories in it.

Arcs are the **depth-2 branches** (42 of 49 take part), coloured in bands by
their top-level domain. Grouping by branch rather than by domain is the whole
point: of the 1,035 cross-branch chords, **441 (43%) join two branches inside the
same top-level domain**, and a domain-level chord diagram cannot draw any of
them — the edge never leaves the domain, so at that resolution it is not an edge
at all. The largest is `Applied Ethics ↔ Social and Political Philosophy` (39),
both under Value Theory, and it is the third largest pair in the taxonomy.

The largest pair overall is `Philosophy of Mind ↔ Philosophy of Cognitive
Science` (56), which *does* cross a domain boundary — Metaphysics and
Epistemology to Science, Logic and Mathematics. The two readings are different
questions and the branch level answers both.

The accounting closes exactly:

```
1,035 cross-branch chords  +  581 within a single branch  =  1,616 extra parent edges
```

The 581 are self-loops, which a chord diagram cannot draw as ribbons; they are
aggregated into one inward bulge per branch, still at the same width scale.

Arc length is **cross-listing weight, not category count**. That is load-bearing:
if arcs were sized by anything else, the ring and the ribbons would sit on two
different scales — the circular version of a dual-axis chart — and ribbon widths
would not match at the two ends. With one global radians-per-unit-weight, every
ribbon is exactly as wide where it lands as where it leaves.

A single chord is **sub-pixel wide at the ring** (0.79px at 1600×900): 2,070
endpoints around a circumference of about 1,900px. That is not a rendering
defect, it is what 1,035 chords around 42 arcs means. What you actually see is
the bundles; hover targets are therefore bundles, and a bundle holding exactly
one chord degrades to naming that single category.

Identity is never colour alone. The 34 heaviest arcs carry a direct label with
their cross-listing weight, and the 8 smallest are deliberately left unlabelled —
at 42 labels the ring becomes a wall of leader lines and the large branches lose
their names. Labels are pushed apart until none overlap, each drawing a leader
line back to its anchor if it had to move. And a branch's top-level domain is
always available by name in the legend and the tooltip, because the palette's
adjacent pairs are validated for colour-vision deficiency but its all-pairs list
is not.

## Diagnostics

`report.json` records anything unusual rather than silently dropping it.
A `CYCLE` or `DANGLING_PARENT` entry is worth reporting upstream instead of
patching locally; the others are expected properties of this data.

| Kind | Meaning |
|---|---|
| `SYNTHETIC_ROOT` | Root ID `1` had no record and was synthesized. Expected: exactly 1 |
| `MOJIBAKE_REPAIRED` | A name was CP1252-mangled in the snapshot and repaired. The original is kept in `nameRaw` |
| `EMPTY_NAME` | A source category has a blank name; kept as `(untitled <id>)` |
| `DUPLICATE_ID` | Same ID twice; first occurrence wins |
| `DANGLING_PARENT` | Parent ID with no record; node promoted to root rather than dropped |
| `SELF_PARENT` | Category is its own parent; promoted to root |
| `CYCLE` | Cycle detected; cut at the smallest ID so results are reproducible |
| `MULTIPLE_ROOTS` | More than one root, or nodes unreachable from any root |
| `PRIMARY_NOT_IN_PARENTS` | Primary parent missing from the node's own parent list |
| `BAD_RECORD` | Record was not a 4-element array; skipped |
| `SHAPE_NOTE` | Field types differed from the documented `(str, int, str, int)` |

### Encoding

The snapshot's non-ASCII names are CP1252-mangled — `Gödelian` is stored as
`GÃ¶delian`. All 31 affected names are repaired on import by inverting the
CP1252 table byte-by-byte, which handles the five undefined bytes that make the
obvious `encode('cp1252')` fail. ASCII names are never touched, and the repair
is idempotent.

## Testing

```bash
.venv/Scripts/python -m pytest                      # Python: 93 tests
node ../web/check-phil-chord.mjs                    # the chord renderer: 49 checks
```

Both are fully offline and need no API key or network. The Python suite takes a
`--web-dir` build for granted, so re-run `pipeline.py` first if you have changed
the taxonomy.

| File | Covers |
|---|---|
| `tests/test_build_tree.py` | parsing, cycles, dangling parents, hostile names — against a synthetic fixture |
| `tests/test_chord_layout.py` | the chord accounting and the branch/self-loop split |
| `tests/test_radial_layout.py` | the angle invariants and cluster wedges |
| `tests/test_render_map.py` | escaping, self-containment, the table view |
| `tests/test_pipeline.py` | hard assertions against the real snapshot (skips if not fetched) |
| `tests/check_map_js.mjs` | **runs the page's JavaScript** against a stub DOM |
| `../web/check-phil-chord.mjs` | **runs the chord renderer** against a stub canvas |
| `../web/check-phil-chord.html` | the same view in a real browser — the only place with real font metrics |

Those last two matter: browser JS that no Python test can reach, where a typo
produces a blank canvas rather than an error. `check_map_js.mjs` executes the
real script from the real `map.html` and asserts that nothing throws, that no
`NaN` reaches the canvas, that every domain is drawn, and that hover, search,
Enter-to-pin and domain isolation all work.

`check-phil-chord.mjs` measures the chord geometry **off the `Path2D` calls the
renderer actually made**, rather than trusting the layout's own bookkeeping — a
layout that has mis-counted itself cannot fail that check. It asserts the one
invariant the whole chart rests on: *every ribbon leaves one branch and lands on
the other at exactly the same width*. Plus: the arcs and gaps close the circle
to exactly 2π, each arc is exactly `degree × scale` and is fully tiled by its
bundles, no coordinate is `NaN`, every arc picks itself from its own midpoint,
hiding a domain leaves the ring still closed, and the bundle tooltips account
for every chord. It also guards the API surface the host page calls — a method
defined but never exported passes every geometry check and shows up only as a
blank screen in the browser.

It also asserts that **no two labels overlap**, which is not cosmetic: the labels
are the only channel naming the branches, so two labels on top of each other mean
neither branch has a name. That check exists because the separation pass used to
compare only neighbours in a y-sorted list — which silently fails whenever a
horizontally-disjoint label sorts between two that do collide. `Philosophy of the
Americas` and `European Philosophy` sat 63px inside each other at the bottom of
the ring for exactly that reason. The Node check uses approximate stub widths, so
it validates the algorithm; real font metrics are checked in
`check-phil-chord.html`, which reports `overlaps=0` in its `document.title` at
every size from 640×400 to 2560×1440.

## Layout

```
src/fetch_categories.py   download the snapshot verbatim (atomic, refuses non-JSON)
src/build_tree.py         pure functions: parse -> build -> diagnose. No I/O
src/chord_layout.py       pure functions: nested tree -> branch chords and self-loops
src/radial_layout.py      pure functions: nested tree -> angles and cluster wedges
src/render_map.py         layout -> one self-contained HTML page
src/pipeline.py           CLI orchestration
tests/                    unit + real-data tests, synthetic fixture
```

`build_tree.py` is deliberately pure — records in, result out, no disk, no
network, no `os.chdir`, fully deterministic — so the tree logic can be tested
without touching the filesystem.
