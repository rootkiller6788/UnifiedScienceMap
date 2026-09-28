"""Render the whole taxonomy as one self-contained HTML radial map.

All 6,135 categories are drawn at once as a radial dendrogram: the root sits at
the centre, depth is radius, and each leaf owns an equal slice of the circle --
so a cluster's arc is proportional to how much taxonomy it actually contains.
The seven top-level domains get the seven categorical slots, in fixed order.

Canvas rather than SVG. Six thousand nodes as SVG elements means six thousand
DOM nodes, and every pan would relayout them; the canvas redraws the whole scene
in a handful of batched calls and stays smooth.

The layout itself is computed in :mod:`radial_layout` so it is deterministic and
testable; this module only formats it into a page. The page is inlined with its
data rather than fetching it -- browsers refuse ``fetch()`` on ``file://`` URLs
for CORS reasons, and inlining is what lets you just double-click the file. No
CDN, no framework, no external requests, offline forever.

Colour: slots 1-7 of the validated reference palette, in the documented order.
Adjacent pairs clear the CVD and normal-vision floors in both modes; the
all-pairs list does not (slot 2 orange and slot 4 yellow are the failing pair),
which is why hue is never the only channel here -- a legend, direct ring labels
and the hover tooltip all name the domain too. Three light-mode slots sit under
3:1 on the light surface, so the direct labels are mandatory, not decorative.
"""

from __future__ import annotations

import html
import json
from pathlib import Path

import radial_layout

# Fixed categorical order -- assigned by domain index, never cycled.
LIGHT_SERIES = ("#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7")
DARK_SERIES = ("#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9")

LIGHT_SURFACE = "#fcfcfb"
DARK_SURFACE = "#1a1a19"


def _series_vars(values: tuple[str, ...]) -> str:
    return "\n".join(f"  --series-{i + 1}: {value};" for i, value in enumerate(values))


def inline_json(obj) -> str:
    """JSON that is safe to embed inside a ``<script>`` element.

    Escaping ``<``, ``>`` and ``&`` keeps a category name like ``</script>`` or
    a stray ``<!--`` from ending the block early. U+2028/2029 are legal in JSON
    strings but were line terminators in older JS parsers, so they are escaped
    too. Quotes and backslashes are already handled by :func:`json.dumps`.
    """
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    for char, code in (("<", "003c"), (">", "003e"), ("&", "0026"),
                       ('\u2028', "2028"), ('\u2029', "2029")):
        text = text.replace(char, '\\u' + code)
    return text


def render_map(
    nested: list[dict],
    *,
    stats: dict | None = None,
    source: str = "",
    title: str = "PhilPapers Taxonomy",
) -> str:
    """Build the complete, self-contained HTML page as a string."""
    layout = radial_layout.build_layout(nested)
    return _PAGE.replace("@@TITLE@@", html.escape(title)) \
                .replace("@@META@@", html.escape(_meta(layout, source))) \
                .replace("@@SERIES_LIGHT@@", _series_vars(LIGHT_SERIES)) \
                .replace("@@SERIES_DARK@@", _series_vars(DARK_SERIES)) \
                .replace("@@DATA@@", inline_json(layout))


def _meta(layout: dict, source: str) -> str:
    # Categories that appear under more than one parent, matching the count in
    # report.json and the README -- not the larger number of spare parent edges.
    cross = sum(1 for extra in layout["crossParents"] if extra)
    parts = [
        f"{len(layout['names']):,} categories",
        f"{layout['maxDepth']} levels deep",
        f"{cross:,} cross-listed",
        f"{len(layout['clusters'])} top-level domains",
    ]
    if source:
        parts.append(f"source {Path(source).name}")
    return " · ".join(parts)


_PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@@TITLE@@</title>
<style>
:root {
  color-scheme: light;
  --surface: #fcfcfb;
  --plane: #f9f9f7;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --muted: #898781;
  --grid: #e1e0d9;
  --baseline: #c3c2b7;
  --border: rgba(11, 11, 11, 0.10);
@@SERIES_LIGHT@@
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface: #1a1a19;
    --plane: #0d0d0d;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --muted: #898781;
    --grid: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255, 255, 255, 0.10);
@@SERIES_DARK@@
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19;
  --plane: #0d0d0d;
  --ink: #ffffff;
  --ink-2: #c3c2b7;
  --muted: #898781;
  --grid: #2c2c2a;
  --baseline: #383835;
  --border: rgba(255, 255, 255, 0.10);
@@SERIES_DARK@@
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--plane); color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  display: flex; flex-direction: column; overflow: hidden;
}
header {
  flex: none; background: var(--surface); border-bottom: 1px solid var(--border);
  padding: 10px 16px 8px;
}
h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.meta { color: var(--ink-2); font-size: 12px; margin: 1px 0 8px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row + .row { margin-top: 8px; }
input[type=search] {
  flex: 1 1 240px; min-width: 160px; padding: 6px 10px; font: inherit; font-size: 13px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--plane); color: var(--ink);
}
input[type=search]:focus-visible { outline: 2px solid var(--series-1); outline-offset: 1px; }
button {
  padding: 6px 10px; font: inherit; font-size: 12px; cursor: pointer;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--plane); color: var(--ink-2);
}
button:hover { border-color: var(--baseline); color: var(--ink); }
button[aria-pressed=true] { color: var(--ink); border-color: var(--baseline); background: var(--surface); }
button:focus-visible { outline: 2px solid var(--series-1); outline-offset: 1px; }

.legend { gap: 6px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px 3px 7px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--plane);
  font-size: 12px; color: var(--ink-2); cursor: pointer;
}
.chip:hover { border-color: var(--baseline); color: var(--ink); }
.chip[aria-pressed=true] { color: var(--ink); border-color: var(--baseline); }
.chip.off { opacity: 0.35; }
.swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.count { color: var(--muted); font-variant-numeric: tabular-nums; }
.crumb {
  margin-top: 8px; font-size: 12px; color: var(--ink-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.crumb b { color: var(--ink); font-weight: 600; }

main { position: relative; flex: 1 1 auto; min-height: 0; background: var(--surface); }
canvas { display: block; touch-action: none; cursor: grab; }
canvas.dragging { cursor: grabbing; }

.tip {
  position: absolute; z-index: 5; pointer-events: none; max-width: 380px;
  padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--border); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
}
.tip .t-name { font-weight: 600; font-size: 13px; }
.tip .t-path { color: var(--ink-2); margin-top: 3px; }
.tip .t-facts { color: var(--muted); margin-top: 4px; font-variant-numeric: tabular-nums; }

.panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 46vw);
  background: var(--surface); border-left: 1px solid var(--border);
  overflow: auto; z-index: 4;
}
.panel[hidden] { display: none; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--border); }
th {
  position: sticky; top: 0; background: var(--surface); z-index: 1;
  font-weight: 600; color: var(--ink-2); font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
td.name { color: var(--ink); }
td.path { color: var(--ink-2); max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
td.num { color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--plane); }
.panel .empty { padding: 12px 10px; color: var(--muted); font-size: 12px; }
.panel .rowmark { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 7px; }

.steps { display: flex; gap: 3px; align-items: center; }
.steps button { padding: 5px 9px; }
</style>
</head>
<body>

<header>
  <h1>@@TITLE@@</h1>
  <div class="meta">@@META@@</div>
  <div class="row">
    <input type="search" id="q" placeholder="Search categories…" autocomplete="off" spellcheck="false" aria-label="Search categories">
    <div class="steps">
      <button id="zin" title="Zoom in (+)" aria-label="Zoom in">+</button>
      <button id="zout" title="Zoom out (-)" aria-label="Zoom out">&minus;</button>
      <button id="reset" title="Fit to view (0)">Reset</button>
    </div>
    <button id="labels" aria-pressed="true">Labels</button>
    <button id="table" aria-pressed="false">Domains</button>
    <button id="theme" title="Cycle light / dark / system">Theme: auto</button>
  </div>
  <div class="row legend" id="legend"></div>
  <div class="crumb" id="crumb">Drag to pan &middot; scroll to zoom &middot; hover a node to trace its path &middot; click to pin</div>
</header>

<main id="main">
  <canvas id="map"></canvas>
  <div class="tip" id="tip" hidden></div>
  <aside class="panel" id="panel" hidden></aside>
</main>

<script type="application/json" id="layout">@@DATA@@</script>
<script>
"use strict";
(function () {
  var L = JSON.parse(document.getElementById("layout").textContent);
  var N = L.names.length;
  var C = L.clusters.length;
  var MAXD = L.maxDepth || 1;
  var STEP = 2 * Math.PI / Math.max(L.totalLeaves, 1);

  // ---------------------------------------------------------------- geometry
  var WORLD = 2048, CX = WORLD / 2, CY = WORLD / 2;
  var PAD = 190, RMAX = WORLD / 2 - PAD, R0 = 52;
  function radius(d) { return R0 + (RMAX - R0) * (d / MAXD); }

  var PX = new Float64Array(N), PY = new Float64Array(N);
  for (var i = 0; i < N; i++) {
    var r = radius(L.depth[i]), a = L.angle[i];
    PX[i] = CX + r * Math.cos(a);
    PY[i] = CY + r * Math.sin(a);
  }

  var kids = new Array(N);
  for (i = 0; i < N; i++) kids[i] = [];
  for (i = 0; i < N; i++) { var p = L.parent[i]; if (p >= 0) kids[p].push(i); }

  // Edges batched by cluster into one path each: seven stroke calls per frame
  // instead of six thousand. This is what keeps panning smooth.
  var edges = [];
  for (var c = 0; c <= C; c++) edges.push(new Path2D());
  for (i = 0; i < N; i++) {
    var ch = kids[i];
    if (!ch.length) continue;
    var path = edges[L.cluster[i] >= 0 ? L.cluster[i] : C];
    var ra = radius(L.depth[i]), rb = radius(L.depth[i] + 1);
    var a0 = L.angle[ch[0]], a1 = L.angle[ch[ch.length - 1]];
    path.moveTo(CX + ra * Math.cos(a0), CY + ra * Math.sin(a0));
    path.arc(CX, CY, ra, a0, a1);
    for (var k = 0; k < ch.length; k++) {
      var ang = L.angle[ch[k]];
      var cs = Math.cos(ang), sn = Math.sin(ang);
      path.moveTo(CX + ra * cs, CY + ra * sn);
      path.lineTo(CX + rb * cs, CY + rb * sn);
    }
  }

  // Each cluster owns the contiguous arc of its leaves -- that is the wedge.
  var cStart = new Float64Array(C).fill(Infinity);
  var cEnd = new Float64Array(C).fill(-Infinity);
  var cLeaf = new Int32Array(C);
  for (i = 0; i < N; i++) {
    var ci = L.cluster[i];
    if (ci < 0 || L.leafCount[i] !== 1) continue;
    cLeaf[ci]++;
    if (L.angle[i] < cStart[ci]) cStart[ci] = L.angle[i];
    if (L.angle[i] > cEnd[ci]) cEnd[ci] = L.angle[i];
  }
  for (c = 0; c < C; c++) {
    if (cStart[c] === Infinity) { cStart[c] = 0; cEnd[c] = 0; continue; }
    cStart[c] -= STEP / 2; cEnd[c] += STEP / 2;
  }

  var byId = new Map();
  for (i = 0; i < N; i++) byId.set(L.ids[i], i);

  var folded = new Array(N);
  for (i = 0; i < N; i++) {
    folded[i] = L.names[i].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  // ------------------------------------------------------------------- state
  var cv = document.getElementById("map");
  var ctx = cv.getContext("2d");
  var main = document.getElementById("main");
  var tip = document.getElementById("tip");
  var panel = document.getElementById("panel");
  var crumb = document.getElementById("crumb");
  var W = 800, H = 600, dpr = 1;
  var view = { k: 1, x: 0, y: 0 };
  var fitK = 1;
  var touched = false;
  var hover = -1, selected = -1, matchSet = null, matches = null;
  var hidden = new Set();
  var showLabels = true;
  var wantDraw = false;

  function vars() {
    var cs = getComputedStyle(document.documentElement);
    var out = { series: [] };
    var names = ["surface", "plane", "ink", "ink-2", "muted", "grid", "baseline"];
    for (var n = 0; n < names.length; n++) {
      out[names[n]] = cs.getPropertyValue("--" + names[n]).trim();
    }
    for (n = 1; n <= C; n++) out.series.push(cs.getPropertyValue("--series-" + n).trim());
    return out;
  }
  var V = vars();

  function seriesVar(i) {
    var slot = i % V.series.length;
    return slot < V.series.length ? "var(--series-" + (slot + 1) + ")" : V.series[slot];
  }
  function clusterColor(i) {
    if (i < 0) return V["ink-2"];
    if (hidden.has(i)) return V.grid;
    return V.series[i % V.series.length];
  }

  // ------------------------------------------------------------------ layout
  function resize() {
    var rect = main.getBoundingClientRect();
    W = Math.max(320, Math.round(rect.width));
    H = Math.max(220, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    fitK = Math.min(W, H) / WORLD;
    if (!touched) fit();
    draw();
  }
  function fit() {
    view.k = fitK;
    view.x = W / 2 - CX * view.k;
    view.y = H / 2 - CY * view.k;
  }
  function clampView() {
    var lo = fitK * 0.6, hi = fitK * 60;
    view.k = Math.max(lo, Math.min(hi, view.k));
  }
  function screen(i) { return [PX[i] * view.k + view.x, PY[i] * view.k + view.y]; }

  function zoomAt(sx, sy, factor) {
    var wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k;
    view.k *= factor;
    clampView();
    view.x = sx - wx * view.k;
    view.y = sy - wy * view.k;
    touched = true;
    draw();
  }

  function centerOn(i, k) {
    if (k) view.k = Math.max(fitK * 0.6, Math.min(fitK * 60, k));
    view.x = W / 2 - PX[i] * view.k;
    view.y = H / 2 - PY[i] * view.k;
    touched = true;
    draw();
  }

  // ------------------------------------------------------------------ drawing
  function draw() {
    if (wantDraw) return;
    wantDraw = true;
    requestAnimationFrame(function () { wantDraw = false; render(); });
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = V.surface;
    ctx.fillRect(0, 0, W, H);

    var k = view.k;
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(k, k);

    // Visible world rectangle, padded so marks on the edge still draw.
    var pad = 40 / k;
    var vx0 = -view.x / k - pad, vy0 = -view.y / k - pad;
    var vx1 = (W - view.x) / k + pad, vy1 = (H - view.y) / k + pad;
    function visible(i) {
      return PX[i] >= vx0 && PX[i] <= vx1 && PY[i] >= vy0 && PY[i] <= vy1;
    }

    var dim = matchSet ? 0.3 : 1;

    // 1. Domain wedges -- the seven-way split, readable before any zooming.
    ctx.globalAlpha = 0.055 * dim;
    for (c = 0; c < C; c++) {
      if (hidden.has(c)) continue;
      ctx.fillStyle = V.series[c % V.series.length];
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.arc(CX, CY, RMAX, cStart[c], cEnd[c]);
      ctx.closePath();
      ctx.fill();
    }

    // 2. Depth rings, only while they are far enough apart to read.
    if ((RMAX - R0) / MAXD * k > 7) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = V.grid;
      ctx.lineWidth = 1 / k;
      for (var d = 1; d <= MAXD; d++) {
        ctx.beginPath();
        ctx.arc(CX, CY, radius(d), 0, 2 * Math.PI);
        ctx.stroke();
      }
    }

    // 3. Edges, one stroke per domain.
    ctx.globalAlpha = 0.5 * dim;
    ctx.lineWidth = 1.1 / k;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (c = 0; c <= C; c++) {
      ctx.strokeStyle = c === C ? V["ink-2"] : (hidden.has(c) ? V.grid : V.series[c]);
      ctx.stroke(edges[c]);
    }

    // 4. The outermost ring. Zoomed out, 5,026 leaves are under a pixel apart,
    //    so the ring is drawn as one arc per domain instead of 5,026 dots --
    //    which is also the clearest possible read of "one colour per class".
    var slotPx = STEP * RMAX * k;
    ctx.globalAlpha = 1;
    if (slotPx < 1.6) {
      var lw = Math.max(4, Math.min(9, slotPx * 2.6));
      ctx.lineWidth = lw / k;
      ctx.lineCap = "butt";
      for (c = 0; c < C; c++) {
        if (hidden.has(c)) continue;
        ctx.strokeStyle = V.series[c % V.series.length];
        ctx.beginPath();
        ctx.arc(CX, CY, RMAX, cStart[c], cEnd[c]);
        ctx.stroke();
      }
      ctx.lineCap = "round";
    } else {
      var dotR = Math.min(3.4, Math.max(1.25, slotPx * 0.34)) / k;
      for (c = 0; c < C; c++) {
        if (hidden.has(c)) continue;
        var dots = new Path2D();
        var any = false;
        for (i = 0; i < N; i++) {
          if (L.leafCount[i] !== 1 || L.cluster[i] !== c || !visible(i)) continue;
          dots.moveTo(PX[i] + dotR, PY[i]);
          dots.arc(PX[i], PY[i], dotR, 0, 2 * Math.PI);
          any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = 0.95 * dim;
        ctx.fillStyle = V.series[c % V.series.length];
        ctx.fill(dots);
      }
    }

    // 5. Interior nodes, once they are far enough apart to be worth a mark.
    if ((RMAX - R0) / MAXD * k > 26) {
      ctx.globalAlpha = 0.85 * dim;
      for (c = 0; c <= C; c++) {
        var mid = new Path2D();
        var anyMid = false;
        for (i = 0; i < N; i++) {
          if (L.leafCount[i] === 1 || L.cluster[i] !== (c === C ? -1 : c)) continue;
          if (!visible(i)) continue;
          var mr = Math.min(4, Math.max(1.8, Math.sqrt(L.size[i]) * 0.5)) / k;
          mid.moveTo(PX[i] + mr, PY[i]);
          mid.arc(PX[i], PY[i], mr, 0, 2 * Math.PI);
          anyMid = true;
        }
        if (!anyMid) continue;
        ctx.fillStyle = c === C ? V["ink-2"] : V.series[c];
        ctx.fill(mid);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- screen-space passes: highlight, labels, ring labels --------------
    drawPathHighlight();
    if (showLabels) drawLabels();
    drawRingLabels();
    drawSelection();
  }

  function drawPathHighlight() {
    var node = hover >= 0 ? hover : selected;
    if (node < 0) return;
    var chain = [];
    for (var n = node; n >= 0; n = L.parent[n]) chain.push(n);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = V.ink;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (var i = chain.length - 1; i > 0; i--) {
      var a = screen(chain[i]), b = screen(chain[i - 1]);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Progressive disclosure: a node earns a label once its slice of the circle
  // is wide enough on screen to hold text. Zooming in reveals more depth.
  function drawLabels() {
    var k = view.k;
    var shown = [];
    var budget = 260;
    for (var i = 0; i < N; i++) {
      if (L.cluster[i] < 0 || hidden.has(L.cluster[i])) continue;
      var r = radius(L.depth[i]);
      if (r * k < 24) continue;
      var sx = PX[i] * k + view.x, sy = PY[i] * k + view.y;
      if (sx < -160 || sx > W + 160 || sy < -24 || sy > H + 24) continue;
      var arc = L.leafCount[i] * STEP * r * k;
      var need = L.names[i].length * 6.2 + 16;
      if (arc < need) continue;
      shown.push([i, sx, sy, arc]);
    }
    // Wide slices first, so a collision drops the least important label.
    shown.sort(function (a, b) { return b[3] - a[3]; });
    if (shown.length > budget) shown.length = budget;
    shown.sort(function (a, b) { return a[2] - b[2]; });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "500 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    var placed = [];
    for (var s = 0; s < shown.length; s++) {
      var idx = shown[s][0], x = shown[s][1], y = shown[s][2];
      var w = ctx.measureText(L.names[idx]).width;
      var clash = false;
      for (var q = 0; q < placed.length; q++) {
        if (Math.abs(y - placed[q][1]) < 13 && Math.abs(x - placed[q][0]) < (w + placed[q][2]) / 2) {
          clash = true; break;
        }
      }
      if (clash) continue;
      placed.push([x, y, w]);
      var text = L.names[idx];
      if (text.length > 44) text = text.slice(0, 42) + "…";
      ctx.strokeStyle = V.surface;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = (idx === hover || idx === selected) ? V.ink : V["ink-2"];
      ctx.fillText(text, x, y);
    }
    ctx.textAlign = "start";
  }

  // Direct labels on the outer ring: the relief the light-mode contrast warning
  // requires, so a domain is never identified by hue alone.
  //
  // Drawn horizontally rather than rotated onto the tangent -- rotated ring text
  // ends up mirrored on one half of the circle and upside down on the other,
  // which is worse than no label at all.
  //
  // A wedge narrower than its own name cannot hold the text inside its arc, so
  // the label steps outward until it clears its neighbours and a leader line
  // ties it back to the wedge. That is what gets all seven domains named,
  // instead of only the four wide ones.
  function drawRingLabels() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "600 12.5px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.5;

    var todos = [];
    for (var c = 0; c < C; c++) {
      if (hidden.has(c) || cEnd[c] <= cStart[c]) continue;
      var mid = (cStart[c] + cEnd[c]) / 2;
      var label = L.clusters[c].name;
      todos.push({
        c: c, mid: mid, w: ctx.measureText(label).width, text: label,
        left: Math.cos(mid) < 0,
        room: (cEnd[c] - cStart[c]) * RMAX * view.k,
      });
    }
    todos.sort(function (a, b) { return b.room - a.room; });   // widest first

    var placed = [];
    for (var n = 0; n < todos.length; n++) {
      var t = todos[n];
      for (var step = 0; step < 6; step++) {
        var r = RMAX + (30 + step * 24) / view.k;
        var x = (CX + r * Math.cos(t.mid)) * view.k + view.x;
        var y = (CY + r * Math.sin(t.mid)) * view.k + view.y;
        var x0 = t.left ? x - t.w : x;
        if (x0 > W + 40 || x0 + t.w < -40 || y < -20 || y > H + 20) break;
        var clash = false;
        for (var q = 0; q < placed.length; q++) {
          var prev = placed[q];
          if (Math.abs(y - prev.y) < 15 && x0 < prev.x1 && x0 + t.w > prev.x0) {
            clash = true; break;
          }
        }
        if (clash) continue;
        placed.push({ x0: x0, x1: x0 + t.w, y: y });
        drawRingLabel(t, x, y, step > 0 || t.room < t.w);
        break;
      }
    }
    ctx.textAlign = "start";
  }

  function drawRingLabel(t, x, y, leader) {
    var color = V.series[t.c % V.series.length];
    var dot = t.left ? 9 : -9;
    if (leader) {
      // A radial tick back to the wedge's own arc, so the name never floats
      // free of the thing it names.
      var ax = (CX + RMAX * Math.cos(t.mid)) * view.k + view.x;
      var ay = (CY + RMAX * Math.sin(t.mid)) * view.k + view.y;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(x + dot, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3.5;
    }
    ctx.beginPath();
    ctx.arc(x + dot, y, 3.6, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.textAlign = t.left ? "right" : "left";
    ctx.strokeStyle = V.surface;
    ctx.strokeText(t.text, x, y);
    ctx.fillStyle = V.ink;
    ctx.fillText(t.text, x, y);
  }

  function drawSelection() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var list = [];
    if (hover >= 0) list.push([hover, 4.5]);
    if (selected >= 0 && selected !== hover) list.push([selected, 5.5]);
    for (var n = 0; n < list.length; n++) {
      var i = list[n][0];
      var p = screen(i);
      ctx.beginPath();
      ctx.arc(p[0], p[1], list[n][1], 0, 2 * Math.PI);
      ctx.lineWidth = 2;
      ctx.strokeStyle = V.ink;
      ctx.stroke();
    }
    if (matchSet) {
      ctx.globalAlpha = 0.9;
      for (var m = 0; m < matches.length && m < 400; m++) {
        var mi = matches[m];
        var mp = screen(mi);
        if (mp[0] < -20 || mp[0] > W + 20 || mp[1] < -20 || mp[1] > H + 20) continue;
        ctx.beginPath();
        ctx.arc(mp[0], mp[1], 4.5, 0, 2 * Math.PI);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = V.ink;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------- paths
  function pathOf(i) {
    var out = [];
    for (var n = i; n >= 0; n = L.parent[n]) out.push(L.names[n]);
    out.reverse();
    return out;
  }
  function facts(i) {
    var f = [];
    if (L.parent[i] < 0) f.push("root");
    else f.push("depth " + L.depth[i]);
    if (L.leafCount[i] > 1) f.push(L.leafCount[i].toLocaleString() + " leaves");
    if (kids[i].length) f.push(kids[i].length + " children");
    var extra = L.crossParents[i];
    if (extra && extra.length) f.push(extra.length + " more parent" + (extra.length > 1 ? "s" : ""));
    return f.join(" · ");
  }
  function namesOf(ids) {
    var out = [];
    for (var n = 0; n < ids.length; n++) {
      var idx = byId.get(String(ids[n]));
      out.push(idx === undefined ? ids[n] : L.names[idx]);
    }
    return out;
  }

  // ------------------------------------------------------------------ pointer
  function pick(sx, sy) {
    var best = -1, bestD = 15 * 15, bestDepth = -1;
    for (var i = 0; i < N; i++) {
      var dx = PX[i] * view.k + view.x - sx;
      if (dx > 15 || dx < -15) continue;
      var dy = PY[i] * view.k + view.y - sy;
      if (dy > 15 || dy < -15) continue;
      var dist = dx * dx + dy * dy;
      if (dist < bestD || (dist === bestD && L.depth[i] > bestDepth)) {
        bestD = dist; best = i; bestDepth = L.depth[i];
      }
    }
    return best;
  }

  var drag = null;
  cv.addEventListener("pointerdown", function (e) {
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: false };
    cv.classList.add("dragging");
  });
  cv.addEventListener("pointermove", function (e) {
    var rect = cv.getBoundingClientRect();
    if (drag) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      view.x += dx; view.y += dy;
      drag.x = e.clientX; drag.y = e.clientY;
      touched = true;
      hideTip();
      draw();
      return;
    }
    var hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== hover) { hover = hit; draw(); }
    if (hit >= 0) showTip(hit, e.clientX - rect.left, e.clientY - rect.top);
    else hideTip();
  });
  cv.addEventListener("pointerup", function (e) {
    cv.classList.remove("dragging");
    var wasDrag = drag && drag.moved;
    drag = null;
    if (wasDrag) return;
    var rect = cv.getBoundingClientRect();
    var hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    selected = hit === selected ? -1 : hit;
    if (selected >= 0) centerOn(selected);
    showCrumb();
    draw();
  });
  cv.addEventListener("pointerleave", function () {
    drag = null;
    cv.classList.remove("dragging");
    hover = -1; hideTip(); draw();
  });
  cv.addEventListener("wheel", function (e) {
    e.preventDefault();
    var rect = cv.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.pow(1.0016, -e.deltaY));
  }, { passive: false });

  function showTip(i, sx, sy) {
    var html = '<div class="t-name"></div><div class="t-path"></div><div class="t-facts"></div>';
    tip.innerHTML = html;
    var n = tip.firstChild;
    n.textContent = L.names[i] + (L.cluster[i] >= 0 ? "" : "  (synthetic root)");
    var extra = L.crossParents[i];
    var line = pathOf(i).join(" › ");
    var pathEl = tip.children[1];
    pathEl.textContent = line;
    var factText = facts(i);
    if (extra && extra.length) {
      factText += "\nalso under: " + namesOf(extra).slice(0, 3).join(", ") +
                  (extra.length > 3 ? "…" : "");
    }
    tip.children[2].textContent = factText;
    tip.hidden = false;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = sx + 14, top = sy + 14;
    if (left + tw > W - 8) left = sx - tw - 14;
    if (top + th > H - 8) top = Math.max(4, sy - th - 14);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { tip.hidden = true; }

  function showCrumb() {
    if (selected < 0) return;
    crumb.innerHTML = "";
    crumb.appendChild(document.createTextNode("Pinned: "));
    var b = document.createElement("b");
    b.textContent = L.names[selected];
    crumb.appendChild(b);
    crumb.appendChild(document.createTextNode(" · " + pathOf(selected).join(" › ")));
  }

  // ---------------------------------------------------------------- controls
  document.getElementById("zin").onclick = function () { zoomAt(W / 2, H / 2, 1.35); };
  document.getElementById("zout").onclick = function () { zoomAt(W / 2, H / 2, 1 / 1.35); };
  document.getElementById("reset").onclick = function () {
    touched = false; fit(); hideTip(); draw();
  };
  document.getElementById("labels").onclick = function () {
    showLabels = !showLabels;
    this.setAttribute("aria-pressed", String(showLabels));
    draw();
  };
  var tableBtn = document.getElementById("table");
  function setPanel(open) {
    panel.hidden = !open;
    tableBtn.setAttribute("aria-pressed", String(open));
  }
  tableBtn.onclick = function () { setPanel(panel.hidden); };

  var themeBtn = document.getElementById("theme");
  function currentTheme() {
    try { return localStorage.getItem("philpapers-theme") || "auto"; } catch (e) { return "auto"; }
  }
  function applyTheme(t) {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    themeBtn.textContent = "Theme: " + t;
    try { localStorage.setItem("philpapers-theme", t); } catch (e) { /* file:// may refuse */ }
    V = vars();
    draw();
  }
  themeBtn.onclick = function () {
    var order = ["auto", "light", "dark"];
    applyTheme(order[(order.indexOf(currentTheme()) + 1) % 3]);
  };
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onScheme = function () { V = vars(); draw(); };
    if (mq.addEventListener) mq.addEventListener("change", onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }

  // Legend: identity never rests on hue alone, and clicking isolates a domain.
  var legend = document.getElementById("legend");
  for (c = 0; c < C; c++) {
    (function (ci) {
      var chip = document.createElement("button");
      chip.className = "chip";
      chip.setAttribute("aria-pressed", "true");
      var sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = seriesVar(ci);
      chip.appendChild(sw);
      chip.appendChild(document.createTextNode(L.clusters[ci].name));
      var cnt = document.createElement("span");
      cnt.className = "count";
      cnt.textContent = L.clusters[ci].leafCount.toLocaleString();
      chip.appendChild(cnt);
      chip.onclick = function () {
        if (hidden.has(ci)) hidden.delete(ci); else hidden.add(ci);
        chip.classList.toggle("off", hidden.has(ci));
        chip.setAttribute("aria-pressed", String(!hidden.has(ci)));
        draw();
      };
      legend.appendChild(chip);
    })(c);
  }

  // ---------------------------------------------------------------- search
  var q = document.getElementById("q");
  function runSearch() {
    var needle = q.value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!needle) {
      matchSet = null; matches = null;
      hover = -1; hideTip();
      renderPanel();
      draw();
      return;
    }
    matches = [];
    for (var i = 0; i < N; i++) if (folded[i].indexOf(needle) >= 0) matches.push(i);
    matchSet = new Set(matches);
    renderPanel();
    setPanel(true);
    draw();
  }
  q.addEventListener("input", runSearch);

  function renderPanel() {
    var rows, head, empty;
    if (matchSet) {
      rows = matches.slice(0, 500);
      head = ["Name", "Path", "Depth", "Links"];
    } else {
      rows = [];
      for (c = 0; c < C; c++) rows.push(c);
      head = ["Domain", "Leaves", "Nodes", "—"];
    }
    var h = "<table><thead><tr>";
    for (var n = 0; n < head.length; n++) h += "<th>" + head[n] + "</th>";
    h += "</tr></thead><tbody></tbody></table>";
    panel.innerHTML = h;
    var tb = panel.querySelector("tbody");
    for (var r = 0; r < rows.length; r++) {
      var tr = document.createElement("tr");
      var i = matchSet ? rows[r] : null;
      if (matchSet) {
        tr.appendChild(cell("name", L.names[i], true));
        // The last few ancestors, not the head of the path: every row starts
        // "All Philosophy > ...", which tells the reader nothing.
        var up = pathOf(i).slice(0, -1);
        var tail = up.slice(-3);
        tr.appendChild(cell("path",
          (up.length > tail.length ? "… › " : "") + tail.join(" › "), false));
        tr.appendChild(cell("num", String(L.depth[i]), false));
        var extra = L.crossParents[i];
        tr.appendChild(cell("num", extra && extra.length ? "+" + extra.length : "", false));
        tr.onclick = function (idx) {
          return function () { selected = idx; centerOn(idx, Math.max(view.k, fitK * 6)); showCrumb(); draw(); };
        }(i);
        tr.onmouseenter = function (idx) {
          return function () { hover = idx; draw(); };
        }(i);
      } else {
        var ci = rows[r];
        var td = cell("name", "", false);
        var sw = document.createElement("span");
        sw.className = "rowmark";
        sw.style.background = seriesVar(ci);
        td.appendChild(sw);
        td.appendChild(document.createTextNode(L.clusters[ci].name));
        tr.appendChild(td);
        tr.appendChild(cell("num", L.clusters[ci].leafCount.toLocaleString(), false));
        tr.appendChild(cell("num", L.clusters[ci].nodeCount.toLocaleString(), false));
        tr.appendChild(cell("num", "", false));
      }
      tb.appendChild(tr);
    }
    if (matchSet && matches.length === 0) {
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No category matches that.";
      panel.appendChild(e);
    } else if (matchSet && matches.length > 500) {
      var e2 = document.createElement("div");
      e2.className = "empty";
      e2.textContent = "Showing the first 500 of " + matches.length.toLocaleString() + " matches.";
      panel.appendChild(e2);
    }
    crumb.textContent = matchSet
      ? matches.length.toLocaleString() + " match" + (matches.length === 1 ? "" : "es")
      : "Drag to pan · scroll to zoom · hover a node to trace its path · click to pin";
  }
  function cell(cls, text, strong) {
    var td = document.createElement("td");
    td.className = cls;
    td.textContent = text;
    if (strong) td.style.color = "var(--ink)";
    return td;
  }

  document.addEventListener("keydown", function (e) {
    if (e.target === q) {
      if (e.key === "Enter" && matches && matches.length) {
        selected = matches[0];
        centerOn(selected, Math.max(view.k, fitK * 6));
        showCrumb(); draw();
      }
      if (e.key === "Escape") { q.value = ""; runSearch(); }
      return;
    }
    if (e.key === "+" || e.key === "=") zoomAt(W / 2, H / 2, 1.35);
    else if (e.key === "-") zoomAt(W / 2, H / 2, 1 / 1.35);
    else if (e.key === "0") { touched = false; fit(); draw(); }
    else if (e.key === "/") { e.preventDefault(); q.focus(); }
  });

  if (window.ResizeObserver) new ResizeObserver(resize).observe(main);
  else window.addEventListener("resize", resize);
  applyTheme(currentTheme());
  resize();
  renderPanel();
  setPanel(false);
})();
</script>
</body>
</html>
"""
