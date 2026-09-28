/*
 * Execute the map's JavaScript against a stub DOM.
 *
 * The page's script is ~500 lines that no test can reach from Python, and a
 * typo in it produces a blank canvas rather than an error. This harness runs
 * the real script -- extracted from the real output/map.html -- and asserts the
 * things that actually break: a throw, a NaN reaching the canvas, a missing
 * domain, or a branch that never runs.
 *
 * Usage: node check_map_js.mjs <path-to-map.html>
 */

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node check_map_js.mjs <map.html>");
  process.exit(2);
}

const html = readFileSync(path, "utf8");
const dataBlock = html.split('<script type="application/json" id="layout">')[1].split("</script>")[0];
const script = html.split("<script>")[1].split("</script>")[0];

// --------------------------------------------------------------- assertions
const failures = [];
function check(ok, label) {
  if (!ok) failures.push(label);
}

const NUMERIC = new Set([
  "setTransform", "fillRect", "clearRect", "translate", "scale",
  "moveTo", "lineTo", "arc", "fillText", "strokeText", "rect",
]);
const nan = [];

// ------------------------------------------------------------------- stubs
class Path2D {
  constructor() { this.ops = 0; }
  moveTo(...a) { record("Path2D.moveTo", a); this.ops++; }
  lineTo(...a) { record("Path2D.lineTo", a); this.ops++; }
  arc(...a) { record("Path2D.arc", a); this.ops++; }
}
const calls = [];
function record(name, args) {
  calls.push([name, args]);
  if (!NUMERIC.has(name)) return;
  for (const a of args) {
    if (typeof a === "number" && !Number.isFinite(a)) nan.push([name, args]);
  }
}

function makeCtx() {
  const ctx = {
    canvas: null,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    setTransform(...a) { record("setTransform", a); },
    fillRect(...a) { record("fillRect", a); },
    clearRect(...a) { record("clearRect", a); },
    translate(...a) { record("translate", a); },
    scale(...a) { record("scale", a); },
    moveTo(...a) { record("moveTo", a); },
    lineTo(...a) { record("lineTo", a); },
    arc(...a) { record("arc", a); },
    arcTo(...a) { record("arcTo", a); },
    ellipse(...a) { record("ellipse", a); },
    quadraticCurveTo(...a) { record("quadraticCurveTo", a); },
    bezierCurveTo(...a) { record("bezierCurveTo", a); },
    rotate(...a) { record("rotate", a); },
    transform(...a) { record("transform", a); },
    resetTransform() {},
    setLineDash() {},
    clip() {},
    fill() { record("fill", []); },
    stroke(p) { record("stroke", []); strokes.push(p); },
    measureText(t) { measure.push(t); return { width: String(t).length * 6.2 }; },
    fillText(t) { record("fillText", []); texts.push(t); },
    strokeText(t) { record("strokeText", []); },
  };
  let strokeStyle = "", fillStyle = "", lineWidth = 1, globalAlpha = 1;
  Object.defineProperty(ctx, "strokeStyle", {
    get: () => strokeStyle,
    set: (v) => { strokeStyle = v; styles.push(String(v)); },
  });
  Object.defineProperty(ctx, "fillStyle", {
    get: () => fillStyle,
    set: (v) => { fillStyle = v; styles.push(String(v)); },
  });
  Object.defineProperty(ctx, "lineWidth", {
    get: () => lineWidth,
    set: (v) => { lineWidth = v; if (!Number.isFinite(v)) nan.push(["lineWidth", [v]]); },
  });
  Object.defineProperty(ctx, "globalAlpha", {
    get: () => globalAlpha,
    set: (v) => { globalAlpha = v; if (!Number.isFinite(v)) nan.push(["globalAlpha", [v]]); },
  });
  return ctx;
}
const strokes = [], measure = [], texts = [], styles = [];

function makeEl(id) {
  const el = {
    id, hidden: false, textContent: "", innerHTML: "", children: [],
    firstChild: null, style: {}, offsetWidth: 120, offsetHeight: 60,
    onclick: null, onmouseenter: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { this.children.push(c); if (!this.firstChild) this.firstChild = c; return c; },
    addEventListener(type, fn) {
      (this._on || (this._on = {}))[type] = fn;
    },
    dispatch(type, ev) { if (this._on && this._on[type]) this._on[type](ev || {}); }, removeEventListener() {}, focus() {}, setPointerCapture() {},
    querySelector() {
      // Cached, so rows appended through it can be counted afterwards.
      if (!this._sub) this._sub = makeEl("tbody");
      return this._sub;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1400, height: 900 }),
  };
  if (id === "map") {
    el.getContext = () => makeCtx();
    el.width = 0; el.height = 0;
  }
  Object.defineProperty(el, "innerHTML", {
    get() { return this._html || ""; },
    set(v) {
      this._html = v;
      // Enough parsing for the tip (three divs) and the panel (a table).
      const n = (String(v).match(/<div/g) || []).length;
      this.children = Array.from({ length: n }, () => makeEl("child"));
      if (n === 3) {
        this.children = [makeEl("t-name"), makeEl("t-path"), makeEl("t-facts")];
      }
      this.firstChild = this.children[0] || null;
    },
  });
  return el;
}

const elements = new Map();
const document = {
  documentElement: makeEl("root"),
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  createElement: (tag) => makeEl(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  addEventListener(type, fn) { docHandlers[type] = fn; },
};

const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];
const getComputedStyle = () => ({
  getPropertyValue(name) {
    if (name === "--series-1") return SERIES[0];
    const m = /^--series-(\d+)$/.exec(name);
    if (m) return SERIES[(Number(m[1]) - 1) % SERIES.length];
    return "#123456";
  },
});

const window = {
  devicePixelRatio: 2,
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};

const docHandlers = {};
const docEl = makeEl("root");

globalThis.window = window;
globalThis.document = document;
globalThis.getComputedStyle = getComputedStyle;
globalThis.devicePixelRatio = 2;
globalThis.requestAnimationFrame = (cb) => { cb(0); return 1; };
globalThis.localStorage = {
  _v: {},
  getItem(k) { return this._v[k] ?? null; },
  setItem(k, v) { this._v[k] = v; },
};
globalThis.Path2D = Path2D;

// ------------------------------------------------------------------- run it
let threw = null;
try {
  // The data block the script reads on startup.
  document.getElementById("layout").textContent = dataBlock;
  new Function(script)();
} catch (err) {
  threw = err;
}
check(!threw, `script threw: ${threw && threw.stack ? threw.stack.split("\n").slice(0, 3).join(" | ") : threw}`);

// ------------------------------------------------------------------ results
check(nan.length === 0, `non-finite number reached the canvas: ${JSON.stringify(nan.slice(0, 3))}`);

const edgeStrokes = strokes.filter((s) => s instanceof Path2D);
const bandArcs = calls.filter(([n]) => n === "arc").length;
check(edgeStrokes.length >= 8, `expected 8 batched edge strokes, saw ${edgeStrokes.length}`);
check(edgeStrokes.every((p) => p.ops > 0), "an edge path was stroked empty");
check(bandArcs > 0, "nothing was drawn");
check(texts.length > 0, "no labels were drawn at fit scale");

const legend = document.getElementById("legend");
check(legend.children.length === 7, `legend has ${legend.children.length} domains, expected 7`);

// The panel is a drawer holding the domain table -- the table view that keeps
// the chart from being the only way to read the data. It starts closed so it
// does not sit on top of the map, and the Domains button opens it.
const panel = document.getElementById("panel");
check(String(panel.innerHTML).includes("<table>"), "the panel rendered no table");
check(panel.hidden === true, "the panel should start closed");
const tbody = panel.querySelector("tbody");
check(tbody.children.length === 7, `domain table has ${tbody.children.length} rows, expected 7`);

const tableBtn = document.getElementById("table");
check(typeof tableBtn.onclick === "function", "the Domains button is not wired up");
if (typeof tableBtn.onclick === "function") {
  tableBtn.onclick();
  check(panel.hidden === false, "the Domains button did not open the panel");
  tableBtn.onclick();
  check(panel.hidden === true, "the Domains button did not close the panel");
}

// Zoom in far enough that the leaf ring resolves into individual dots, and make
// sure that branch is also clean -- it is a different code path.
const zin = document.getElementById("zin");
check(typeof zin.onclick === "function", "zoom control is not wired up");
const before = calls.length;
if (typeof zin.onclick === "function") {
  for (let i = 0; i < 8; i++) zin.onclick();
}
check(calls.length > before, "zooming drew nothing");

// --------------------------------------------------------------- interaction
const layout = JSON.parse(dataBlock);
const namesBefore = texts.length;

// Hovering: sweep a grid and require that some positions land on a node and
// produce a tooltip naming a real category. A blank tooltip or a crash here is
// the failure this is looking for.
const cv = document.getElementById("map");
const tip = document.getElementById("tip");
let hitName = null;
for (let gy = 40; gy < 900 && !hitName; gy += 18) {
  for (let gx = 80; gx < 1400 && !hitName; gx += 18) {
    cv.dispatch("pointermove", { clientX: gx, clientY: gy, pointerId: 1 });
    if (tip.hidden !== true && tip.children.length) {
      const candidate = String(tip.children[0].textContent).replace(/ {2}\(synthetic root\)$/, "");
      if (layout.names.includes(candidate)) {
        hitName = candidate;
        check(String(tip.children[1].textContent).includes("›"), "the tooltip has no path line");
        check(/depth|root/.test(String(tip.children[2].textContent)), "the tooltip has no depth line");
      }
    }
  }
}
check(hitName !== null, "hovering never landed on a category");
cv.dispatch("pointerleave", {});

// Search: the panel opens itself and fills a table with the matches.
const q = document.getElementById("q");
const crumb = document.getElementById("crumb");
q.value = "ethics";
q.dispatch("input", {});
check(panel.hidden === false, "searching did not open the results panel");
const rows = panel.querySelector("tbody").children.length;
check(rows > 0, `searching "ethics" produced ${rows} rows`);

docHandlers.keydown({ target: q, key: "Enter", preventDefault() {} });
// showCrumb builds the line with appendChild, so read its child nodes.
const pinned = (crumb.children || []).map((c) => String(c.textContent)).join("");
check(pinned.startsWith("Pinned:"), `Enter did not pin the first match (crumb="${pinned}")`);
check(pinned.includes("›"), "the pinned breadcrumb has no path");
check(texts.length >= namesBefore, "labelling changed nothing after search");

// Isolating a domain redraws without it.
const chip = legend.children[0];
check(chip && typeof chip.onclick === "function", "legend chips are not clickable");
if (chip && typeof chip.onclick === "function") {
  const beforeIso = calls.length;
  chip.onclick();
  check(calls.length > beforeIso, "isolating a domain drew nothing");
}

// Clearing the search must not leave the map dimmed.
q.value = "";
q.dispatch("input", {});
check(String(crumb.textContent).includes("Drag to pan"), "clearing the search did not reset the hint");

if (failures.length) {
  console.error("FAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`ok  edges=${edgeStrokes.length} draws=${calls.length} labels=${texts.length} legend=7`);
