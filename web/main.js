// main.js — 数学声明「科研地图」渲染器 v3（统一坐标公式版，15 万级节点）。
// 数据 unified-decls.json（列式 SoA）：nodes.label/kind/dir/module/depth/x/y + metadata + edges + dirs。
//   X = 数学形式化时间（模块首次进库，2021→2026）
//   Y = 0.7·社区深度 + 0.2·模块深度 + 0.05·类型权重 + 0.05·局部扰动（基础低、构造高）
// 网络模式另做轴向重映射（NET_PLOT）：只纵向压缩（横向不变），让学科簇变扁呈横向长条（整体模式不变）。
// LOD：两种干净模式——远视图画 25 学科聚合块；放大后全矢量绘制声明网络（无模糊栅格）。
// 性能：空间索引（hover 查邻居 + 节点视口裁剪都 O(视口内) 而非 O(n)）；邻接表 O(deg)；
//      屏幕格位图去重 + 复用数组（无每帧 GC）；15 万节点任意缩放流畅。
// 连线：不悬停一律灰；悬停时同领域连线用领域色、跨领域连线用两色渐变，节点/线发光。

import { zoom, zoomIdentity } from 'https://cdn.jsdelivr.net/npm/d3-zoom@3/+esm';
import { select } from 'https://cdn.jsdelivr.net/npm/d3-selection@3/+esm';
import { GlRenderer } from './gl-renderer.js';
import { createWasmSpatialIndex } from './wasm-index.js';

// ---- 常量 ----
const LOD_K = 3.0;             // 模式由按钮切换；该值仅作搜索定位的放大目标缩放
const LABEL_K = 8.0;           // 缩放 ≥ 该值显示声明名标签
const NODE_R_SCREEN = 2.2;     // 节点基准屏幕半径
const EDGE_ALPHA = 0.055;      // 默认边透明度，网络模式走暗色荧光风格
const EDGE_COLOR = '150,160,180';
const CULL_MARGIN = 60;
const WORLD_W = 1600;
const WORLD_H = 900;
const GRID_CELL = 26;          // hover 空间网格单元（世界像素）
const MAX_LABELS = 220;        // 每帧最多绘制的标签数
const MAX_EDGES = 6000;        // 每帧最多 stroke 的可见边数（低缩放边太密时降噪+提速）
const EDGE_CURVE = 0.16;

// 整体模式（学科聚合）绘图范围：原始 1600×900 世界内的 plot 区 [70,1530]×[70,830]。
const PLOT_OVERVIEW = { left: 70, right: 1530, top: 70, bottom: 830 };
// 网络模式（声明网络）绘图范围：横向保持原始范围不变，只纵向压缩（Y 压成一条横带），
// 让每个学科簇从「竖向长条」变成「横向长条」。只改纵轴刻度/范围，不改横轴与相对次序。
const NET_PLOT = { left: 70, right: 1530, top: 330, bottom: 570 };
const NET_CLUSTER_PULL_X = 0.58;
const NET_CLUSTER_PULL_Y = 0.66;
const NET_FIT_WORLD = { left: 110, right: 1490, top: 265, bottom: 635 };
const NET_DEFAULT_ZOOM = 1.196;
const OVERVIEW_ZOOM_OUT = 0.9;  // 整体模式取景后移 10%，避免边缘学科圆被视口裁切
const GIF_MODE = new URLSearchParams(location.search).has('gif') || location.hash.includes('gif');
const GIF_MANUAL = new URLSearchParams(location.search).has('manualGif');
const GIF_OVERVIEW_MS = 2500;
const GIF_CLASS_MS = 1200;
const GIF_END_MS = 1000;

const DIR_PALETTE = new Map(Object.entries({
  Algebra: '#ffff00',
  RingTheory: '#ff8a00',
  GroupTheory: '#ff1744',
  Combinatorics: '#ff1744',
  InformationTheory: '#f8ff45',
  FieldTheory: '#f8ff45',
  RepresentationTheory: '#ff8a00',
  ModelTheory: '#6a5cff',
  NumberTheory: '#32ff3f',
  LinearAlgebra: '#25ff45',
  AlgebraicGeometry: '#9a80ff',
  Geometry: '#ff65ff',
  Analysis: '#26fff4',
  Condensed: '#ff9aa4',
  MeasureTheory: '#7b28ff',
  Probability: '#0038ff',
  Dynamics: '#00b978',
  Topology: '#ff00f5',
  AlgebraicTopology: '#c74cff',
  CategoryTheory: '#8eb2ff',
  Computability: '#ff7888',
  SetTheory: '#ff9aa4',
  Logic: '#1e90ff',
  Order: '#b05b25',
  Data: '#9a9a9a',
  Structures: '#f7f7a1',
  Systems: '#70d6ff',
  Matter: '#b967ff',
  Fields: '#ffd166',
  Computation: '#4cc9f0',
  Optimization: '#f8961e',
  Learning: '#f72585',
  Measurement: '#c7d2fe',
  Foundations: '#b9fbc0',
  Languages: '#80ffdb',
  Logics: '#4cc9f0',
  MachineLearning: '#f72585',
  Crypto: '#ffd166',
  Algorithms: '#90be6d',
  AD: '#ff7b00',
  Modules: '#06d6a0',
  Numerics: '#f8961e',
  SpecialFunctions: '#00bbf9',
  ClassicalMechanics: '#ffcf5a',
  SpaceAndTime: '#58d6ff',
  Relativity: '#4ea2ff',
  Electromagnetism: '#ffd166',
  Optics: '#fff275',
  FluidDynamics: '#45f0c1',
  Thermodynamics: '#ff8f5a',
  StatisticalMechanics: '#ff6f91',
  CondensedMatter: '#a28cff',
  QuantumMechanics: '#b967ff',
  QuantumInfo: '#6ee7ff',
  QFT: '#ff4fd8',
  Particles: '#ff5a7a',
  StringTheory: '#d77cff',
  Cosmology: '#7aa2ff',
  Units: '#c7d2fe',
  ClassicalFieldTheory: '#ff9fdb',
  PhysicsAlpha: '#9ca3af',
  Meta: '#7f8c8d',
}));

const NETWORK_LABELS = new Set([
  'Control',
  'Combinatorics',
  'InformationTheory',
  'FieldTheory',
  'GroupTheory',
  'RingTheory',
  'RepresentationTheory',
  'ModelTheory',
  'Algebra',
  'NumberTheory',
  'LinearAlgebra',
  'AlgebraicGeometry',
  'Geometry',
  'Analysis',
  'Condensed',
  'MeasureTheory',
  'Probability',
  'Dynamics',
  'Topology',
  'AlgebraicTopology',
  'CategoryTheory',
  'Computability',
  'SetTheory',
  'Logic',
  'Order',
  'Data',
  'Foundations',
  'Languages',
  'Logics',
  'MachineLearning',
  'Crypto',
  'Algorithms',
  'AD',
  'Modules',
  'Numerics',
  'SpecialFunctions',
  'ClassicalMechanics',
  'SpaceAndTime',
  'Relativity',
  'Electromagnetism',
  'FluidDynamics',
  'Thermodynamics',
  'StatisticalMechanics',
  'CondensedMatter',
  'QuantumMechanics',
  'QuantumInfo',
  'QFT',
  'Particles',
  'StringTheory',
  'Cosmology',
  'ClassicalFieldTheory',
]);

// 节点世界半径：屏幕尺寸随缩放温和增长（放大视图节点也变大，而非恒定 2.2px 显得缩小）
// k=1→2.2px，k=3→3.4px，k=8→5px，k=20→7.3px，k=40→9.7px
const nodeR = (k) => NODE_R_SCREEN * Math.pow(k, 0.4) / k;

const glCanvas = document.getElementById('glgraph');
const glRenderer = new GlRenderer(glCanvas, { onError: showToast });
const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  dirColor: new Map(),      // dirName -> {color, rgb}
  nodeDirIdx: [],           // 节点 -> dir 索引
  domains: [],
  dirMembers: [],           // dir 索引 -> [节点索引]
  degrees: null,            // Int32Array
  maxDegree: 1,
  dirEdges: [],             // 学科间聚合边 [{s,t,w}]
  dirCenters: [],           // 网络模式压缩后的学科标签中心
  networkBounds: null,      // 网络模式真实节点范围
  drawnList: [],            // 本帧实际绘制的高保真节点（标签/悬停用）
  hoverGrid: new Map(),     // 'cx,cy' -> [节点索引]（空间索引，桶内按度降序）
  adj: null,                // 邻接表（hover 查邻居 O(deg)，不再全量扫边）
  listPool: [],             // 标签/hover 可见节点列表复用缓存
  transform: { x: 0, y: 0, k: 1 },
  fitK: 1,                  // 最远视图缩放（整图铺满屏）＝缩放下限
  mode: 'overview',         // 'overview' 整体模式（学科聚合）| 'network' 网络模式（声明网络）
  hover: -1,
  focusDir: '',
  presentation: {
    enabled: GIF_MODE,
    timer: 0,
    dirs: [],
    index: 0,
  },
  hiddenDirs: new Set(),
  dpr: 1,
  glRenderer,
  wasmIndex: null,
  fpsLast: 0,
  fpsAvg: 0,
  fpsLastPaint: 0,
};

// ---- 初始化 ----
async function init() {
  resize();
  window.addEventListener('resize', resize);
  setupZoom();
  setupUI();

  try {
    state.data = await loadDatasets();
  } catch (err) {
    showToast('Failed to load map data: ' + err.message);
    return;
  }
  buildGraph();
  await initWasmIndex();
  buildLegend();
  $('loading').classList.add('hidden');
  fitView(0);
  if (state.presentation.enabled && !GIF_MANUAL) startGifPresentation();
  if (state.presentation.enabled && GIF_MANUAL) installGifRecorder();
  requestAnimationFrame(render);
}

async function loadDatasets() {
  try {
    const unified = await fetch('unified-decls.json');
    if (unified.ok) return await unified.json();
  } catch {
    // Fall back to the older split files during local iteration.
  }

  const res = await fetch('decls.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();

  await loadOptionalPhysicsLayer(data);

  return data;
}

async function loadOptionalPhysicsLayer(data) {
  for (const name of ['physlib-decls.json', 'physlib-preview.json']) {
    try {
      const res = await fetch(name);
      if (!res.ok) continue;
      mergePhysicsLayer(data, await res.json(), name);
      return;
    } catch {
      // Physics layers are optional; the base math map should still load.
    }
  }
}

function mergePhysicsLayer(data, layer, layerName) {
  const offset = data.nodes.label.length;
  for (const d of layer.dirs || []) {
    if (!data.dirs.some((existing) => existing.name === d.name)) data.dirs.push(d);
  }

  for (const key of Object.keys(data.nodes)) {
    const incoming = layer.nodes?.[key];
    if (Array.isArray(incoming)) data.nodes[key].push(...incoming);
    else data.nodes[key].push(...new Array(layer.nodes.label.length).fill(null));
  }

  for (const [s, t] of layer.edges || []) {
    data.edges.push([s + offset, t + offset]);
  }

  data.meta.conceptCount = data.nodes.label.length;
  data.meta.edgeCount = data.edges.length;
  data.meta.dirCount = data.dirs.length;
  data.meta.physicsLayer = layerName;
  data.meta.physicsNodeCount = layer.nodes.label.length;
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (glCanvas) {
    state.glRenderer.resize(innerWidth, innerHeight, state.dpr);
  }
  canvas.width = Math.floor(innerWidth * state.dpr);
  canvas.height = Math.floor(innerHeight * state.dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  // 最远视图＝整图铺满屏，是缩放下限，不能再缩小
  updateFitK();
  if (state.mode === 'overview' && state.data) {
    state.transform = fitTransformForCurrentWorld();
    syncD3();
    requestRender();
    return;
  }
  if (state.transform.k < state.fitK) {
    state.transform.k = state.fitK;
    syncD3();
    requestRender();
  }
  requestRender();
}

// ---- 数据整理 ----
function buildGraph() {
  const { nodes, edges, dirs } = state.data;
  const n = nodes.label.length;

  const dirIndex = new Map(dirs.map((d, i) => [d.name, i]));
  state.nodeDirIdx = new Uint16Array(n);
  for (let i = 0; i < n; i++) state.nodeDirIdx[i] = dirIndex.get(nodes.dir[i]);
  state.domains = state.data.domains?.length
    ? state.data.domains
    : [...new Set(nodes.domain || [])].filter(Boolean).map((name) => ({ name, count: nodes.domain.filter((d) => d === name).length }));

  dirs.forEach((d, i) => {
    const color = DIR_PALETTE.get(d.name);
    if (color) {
      state.dirColor.set(d.name, { color, rgb: hexToRgb(color) });
    } else {
      const h = Math.round((i * 137.5) % 360);
      state.dirColor.set(d.name, { color: `hsl(${h},88%,58%)`, rgb: hslToRgb(h) });
    }
  });

  state.dirMembers = Array.from({ length: dirs.length }, () => []);
  for (let i = 0; i < n; i++) state.dirMembers[state.nodeDirIdx[i]].push(i);

  const deg = new Int32Array(n);
  const adj = new Array(n).fill(null);
  for (const [s, t] of edges) {
    deg[s]++; deg[t]++;
    if (adj[s] === null) adj[s] = [];
    adj[s].push(t);
    if (adj[t] === null) adj[t] = [];
    adj[t].push(s);
  }
  let maxDeg = 1;
  for (let i = 0; i < n; i++) if (deg[i] > maxDeg) maxDeg = deg[i];
  state.degrees = deg;
  state.maxDegree = maxDeg;
  state.adj = adj;
  state.listPool = [];

  const agg = new Map();
  for (const [s, t] of edges) {
    const a = state.nodeDirIdx[s], b = state.nodeDirIdx[t];
    if (a === b) continue;
    const k = a < b ? a + '|' + b : b + '|' + a;
    agg.set(k, (agg.get(k) || 0) + 1);
  }
  state.dirEdges = [...agg.entries()].map(([k, w]) => {
    const [a, b] = k.split('|').map(Number);
    return { s: a, t: b, w };
  });

  applyNetLayout();   // 网络模式轴向重映射（只纵向压缩；整体模式用 dirs.cx/cy，不受影响）
  computeDirCenters();
  computeNetworkBounds();
  state.glRenderer.init({
    data: state.data,
    dirColor: state.dirColor,
    nodeDirIdx: state.nodeDirIdx,
    degrees: state.degrees,
    maxDegree: state.maxDegree,
  });
  buildHoverGrid();   // 空间索引（桶内已按度降序，替代全局 degreeOrder）
}

async function initWasmIndex() {
  state.wasmIndex = await createWasmSpatialIndex({ onError: showToast });
  if (!state.wasmIndex) return;
  try {
    state.wasmIndex.init({
      data: state.data,
      nodeDirIdx: state.nodeDirIdx,
      degrees: state.degrees,
    });
  } catch (err) {
    state.wasmIndex = null;
    showToast('WASM index disabled: ' + err.message);
  }
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function hslToRgb(h) {
  const s = 0.72, l = 0.58;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return `${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)}`;
}

// 网络模式：把节点坐标从原始 plot 线性重映射到 NET_PLOT（横向不变、纵向压缩）。
// 只改纵轴度量/范围，不改相对次序；整体模式的学科圆圈用 dirs.cx/cy（未改），故不受影响。
function applyNetLayout() {
  const xs = state.data.nodes.x, ys = state.data.nodes.y;
  const ox = PLOT_OVERVIEW.left, ow = PLOT_OVERVIEW.right - PLOT_OVERVIEW.left;
  const oy = PLOT_OVERVIEW.top, oh = PLOT_OVERVIEW.bottom - PLOT_OVERVIEW.top;
  const nw = NET_PLOT.right - NET_PLOT.left, nh = NET_PLOT.bottom - NET_PLOT.top;
  for (let i = 0; i < xs.length; i++) {
    xs[i] = NET_PLOT.left + (xs[i] - ox) / ow * nw;
    ys[i] = NET_PLOT.top + (ys[i] - oy) / oh * nh;
  }
  softenNetworkSeparation();
}

function softenNetworkSeparation() {
  const { nodes } = state.data;
  const centerX = (NET_PLOT.left + NET_PLOT.right) / 2;
  const centerY = (NET_PLOT.top + NET_PLOT.bottom) / 2;
  for (let i = 0; i < nodes.x.length; i++) {
    const hash = hash01(nodes.label[i] + nodes.module[i]);
    const hash2 = hash01(nodes.module[i] + nodes.label[i]);
    const waveX = (hash - 0.5) * 70;
    const waveY = (hash2 - 0.5) * 42;
    nodes.x[i] = centerX + (nodes.x[i] - centerX) * NET_CLUSTER_PULL_X + waveX;
    nodes.y[i] = centerY + (nodes.y[i] - centerY) * NET_CLUSTER_PULL_Y + waveY + Math.sin(nodes.x[i] * 0.025 + hash * 6.28) * 16;
  }
}

function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function computeDirCenters() {
  const { nodes, dirs } = state.data;
  const sums = Array.from({ length: dirs.length }, () => ({ x: 0, y: 0, n: 0 }));
  for (let i = 0; i < nodes.x.length; i++) {
    const s = sums[state.nodeDirIdx[i]];
    s.x += nodes.x[i];
    s.y += nodes.y[i];
    s.n++;
  }
  state.dirCenters = sums.map((s, i) => ({
    name: dirs[i].name,
    x: s.n ? s.x / s.n : dirs[i].cx,
    y: s.n ? s.y / s.n : dirs[i].cy,
    count: dirs[i].count,
  }));
}

function computeNetworkBounds() {
  const { x: xs, y: ys } = state.data.nodes;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < left) left = xs[i];
    if (xs[i] > right) right = xs[i];
    if (ys[i] < top) top = ys[i];
    if (ys[i] > bottom) bottom = ys[i];
  }
  state.networkBounds = { left, right, top, bottom };
}

// hover 空间网格：cell -> [节点索引]，hover 只查指针附近 3×3 格。
// 视口节点筛选优先交给 WASM；这个网格保留给鼠标近邻和 WASM 不可用时的标签列表。
function buildHoverGrid() {
  const xs = state.data.nodes.x, ys = state.data.nodes.y;
  const deg = state.degrees;
  const grid = new Map();
  for (let i = 0; i < xs.length; i++) {
    const cx = Math.floor(xs[i] / GRID_CELL), cy = Math.floor(ys[i] / GRID_CELL);
    const k = cx + ',' + cy;
    let b = grid.get(k);
    if (!b) { b = []; grid.set(k, b); }
    b.push(i);
  }
  for (const b of grid.values()) b.sort((a, z) => deg[z] - deg[a]);
  state.hoverGrid = grid;
}

// ---- 缩放/平移 ----
const zoomBehavior = zoom().scaleExtent([0.25, 120]).on('zoom', (ev) => {
  const t = ev.transform;
  // 永远不能缩到最远视图以下（硬下限，双保险）
  if (t.k < state.fitK) t.k = state.fitK;
  state.transform = t;
  requestRender();
});
function setupZoom() {
  const sel = select(canvas);
  // 整体模式是静态总览；网络模式才允许缩放/拖拽。
  zoomBehavior.filter((ev) => {
    if (state.presentation.enabled) return false;
    if (state.mode === 'overview') return false;
    if (ev.type === 'mousedown') return state.transform.k > state.fitK + 1e-3;
    if (ev.type === 'touchstart' && (!ev.touches || ev.touches.length === 1)) {
      return state.transform.k > state.fitK + 1e-3;
    }
    return true; // 滚轮缩放等始终允许
  });
  sel.call(zoomBehavior);
  updateCanvasCursor();
  zoomBehavior.on('start', () => { canvas.style.cursor = 'grabbing'; });
  zoomBehavior.on('end', updateCanvasCursor);
}

function updateCanvasCursor() {
  canvas.style.cursor = state.presentation.enabled || state.mode === 'overview' ? 'default' : 'grab';
}

function nodeVisible(i) {
  const nodes = state.data.nodes;
  return !state.hiddenDirs.has(nodes.dir[i]);
}

function dirVisible(dir) {
  return !state.hiddenDirs.has(dir.name);
}

// 让 d3-zoom 内部状态与 state.transform 同步，防止程序化改视图后下次交互跳变/突破下限
function syncD3() {
  const t = state.transform;
  select(canvas).property('__zoom', zoomIdentity.translate(t.x, t.y).scale(t.k));
}

let tweenRAF = 0;
function animateTransformTo(target, dur = 600) {
  cancelAnimationFrame(tweenRAF);
  const s = { ...state.transform };
  const t0 = performance.now();
  const ease = (u) => 1 - Math.pow(1 - u, 3);
  const step = (now) => {
    const u = Math.min(1, (now - t0) / dur);
    const e = ease(u);
    state.transform = { x: s.x + (target.x - s.x) * e, y: s.y + (target.y - s.y) * e, k: s.k + (target.k - s.k) * e };
    requestRender();
    if (u < 1) tweenRAF = requestAnimationFrame(step);
    else syncD3(); // 动画结束：同步 d3 内部状态，保证下限/锁定永久生效
  };
  tweenRAF = requestAnimationFrame(step);
}

// 当前模式的「世界」边界与中心：整体=1600×900；网络=纵向压缩后的 NET_PLOT 范围。
function currentWorld() {
  if (state.mode === 'overview') {
    return { cx: WORLD_W / 2, cy: WORLD_H / 2, w: WORLD_W, h: WORLD_H };
  }
  if (state.networkBounds) {
    const b = state.networkBounds;
    const padX = 120, padY = 70;
    return {
      cx: (b.left + b.right) / 2,
      cy: (b.top + b.bottom) / 2,
      w: b.right - b.left + padX * 2,
      h: b.bottom - b.top + padY * 2,
    };
  }
  return {
    cx: (NET_FIT_WORLD.left + NET_FIT_WORLD.right) / 2,
    cy: (NET_FIT_WORLD.top + NET_FIT_WORLD.bottom) / 2,
    w: NET_FIT_WORLD.right - NET_FIT_WORLD.left,
    h: NET_FIT_WORLD.bottom - NET_FIT_WORLD.top,
  };
}

// 最远视图缩放（缩放下限）：按当前模式的世界尺寸铺满屏。
function currentFitK() {
  const r = currentWorld();
  const k = Math.min((innerWidth - 80) / r.w, (innerHeight - 60) / r.h);
  return state.mode === 'network' ? k * NET_DEFAULT_ZOOM : k * OVERVIEW_ZOOM_OUT;
}

// 重算并应用缩放下限（模式切换或窗口缩放时调用）。
function updateFitK() {
  state.fitK = currentFitK();
  zoomBehavior.scaleExtent([state.fitK, 120]);
}

function fitTransformForCurrentWorld() {
  const k = state.fitK;
  const { cx, cy } = currentWorld();
  return zoomIdentity.translate(innerWidth / 2 - cx * k, innerHeight / 2 - cy * k).scale(k);
}

function fitView(dur = 500) {
  animateTransformTo(fitTransformForCurrentWorld(), dur);
}

// 模式切换：整体模式（学科聚合）↔ 网络模式（声明网络）。只切渲染内容，不动视图（不自动缩放）。
// 网络模式轴向范围不同，故切换后重算缩放下限；若当前缩放低于新下限则抬到下限（仅保下限，非"缩放到适配"）。
function switchMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  state.hover = -1;
  if (mode === 'overview') state.focusDir = '';
  $('btnOverview').classList.toggle('active', mode === 'overview');
  $('btnNetwork').classList.toggle('active', mode === 'network');
  updateFitK();
  updateCanvasCursor();
  if (mode === 'overview') {
    fitView(350);
    return;
  }
  fitView(350);
}

// ---- UI ----
function setupUI() {
  $('btnFit').onclick = () => fitView();
  $('btnOverview').onclick = () => switchMode('overview');
  $('btnNetwork').onclick = () => switchMode('network');
  $('btnHudToggle').onclick = () => {
    const collapsed = $('hud').classList.toggle('collapsed');
    $('btnHudToggle').textContent = collapsed ? '+' : '−';
    $('btnHudToggle').title = collapsed ? 'Show legend' : 'Hide legend';
  };
  $('search').addEventListener('input', (e) => onSearch(e.target.value));
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', () => { state.hover = -1; $('hoverInfo').textContent = ''; requestRender(); });
  if (state.presentation.enabled) {
    document.body.classList.add('gif-mode');
  }
}

function startGifPresentation() {
  document.body.classList.add('gif-mode');
  state.presentation.dirs = [...state.data.dirs]
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((d) => d.name);
  state.presentation.index = 0;
  playGifLoop();
}

function installGifRecorder() {
  const params = new URLSearchParams(location.search);
  document.body.classList.add('gif-mode');
  state.presentation.dirs = [...state.data.dirs]
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((d) => d.name);
  document.body.dataset.gifReady = '1';
  document.body.dataset.gifDirs = JSON.stringify(state.presentation.dirs);
  new MutationObserver(() => {
    const mode = document.body.dataset.frameMode;
    if (!mode) return;
    setGifFrame(mode, document.body.dataset.frameFocus || '');
  }).observe(document.body, { attributes: true, attributeFilter: ['data-frame-mode', 'data-frame-focus'] });
  document.body.addEventListener('science-map-frame', (event) => {
    const detail = event.detail || {};
    setGifFrame(detail.mode, detail.focusDir || '');
  });
  setGifFrame(params.get('frameMode') || 'overview', params.get('frameFocus') || '');
}

function setGifFrame(mode, focusDir = '') {
  state.mode = mode;
  state.hover = -1;
  state.focusDir = focusDir;
  updateFitK();
  state.transform = fitTransformForCurrentWorld();
  syncD3();
  updateCanvasCursor();
  render();
}

function playGifLoop() {
  clearTimeout(state.presentation.timer);
  state.focusDir = '';
  if (state.mode !== 'overview') switchMode('overview');
  else fitView(450);
  state.presentation.timer = setTimeout(() => {
    switchMode('network');
    state.presentation.timer = setTimeout(playNextGifClass, 650);
  }, GIF_OVERVIEW_MS);
}

function playNextGifClass() {
  const dirs = state.presentation.dirs;
  if (!dirs.length) {
    state.presentation.timer = setTimeout(playGifLoop, GIF_END_MS);
    return;
  }
  if (state.presentation.index >= dirs.length) {
    state.presentation.index = 0;
    state.focusDir = '';
    switchMode('overview');
    state.presentation.timer = setTimeout(playGifLoop, GIF_END_MS);
    return;
  }
  state.focusDir = dirs[state.presentation.index++];
  requestRender();
  state.presentation.timer = setTimeout(playNextGifClass, GIF_CLASS_MS);
}

function onSearch(q) {
  q = q.trim().toLowerCase();
  $('searchHint').textContent = '';
  if (!q) { state.hover = -1; requestRender(); return; }
  const nodes = state.data.nodes;
  let match = -1, count = 0;
  for (let i = 0; i < nodes.label.length; i++) {
    const haystack = `${nodes.label[i]} ${nodes.module[i]} ${nodes.dir[i]}`.toLowerCase();
    if (nodeVisible(i) && haystack.includes(q)) {
      if (match === -1) match = i;
      count++;
      if (count >= 100) break;
    }
  }
  if (match >= 0) {
    if (state.mode !== 'network') { state.mode = 'network'; $('btnNetwork').classList.add('active'); $('btnOverview').classList.remove('active'); }
    state.hover = match;
    $('searchHint').textContent = `Found ${count}+ matches; showing the first`;
    flyToNode(match);
  } else { $('searchHint').textContent = 'No matches'; state.hover = -1; }
  requestRender();
}

function flyToNode(idx) {
  const x = state.data.nodes.x[idx], y = state.data.nodes.y[idx];
  const k = Math.max(state.transform.k, LOD_K * 1.6);
  animateTransformTo(zoomIdentity.translate(innerWidth / 2 - x * k, innerHeight / 2 - y * k).scale(k), 600);
}

// hover：空间网格索引，O(近邻) 而非 O(n)
function onMouseMove(ev) {
  if (state.presentation.enabled) return;
  if (state.mode !== 'network') { state.hover = -1; requestRender(); return; }
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
  const { x, y, k } = state.transform;
  const wx = (sx - x) / k, wy = (sy - y) / k;
  const hitR = 14 / k;
  const px = Math.floor(wx / GRID_CELL), py = Math.floor(wy / GRID_CELL);
  const xs = state.data.nodes.x, ys = state.data.nodes.y;
  const nodeDir = state.data.dirs.length > 0 ? state.nodeDirIdx : null;
  let best = -1, bestD = hitR * hitR;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = state.hoverGrid.get((px + dx) + ',' + (py + dy));
      if (!bucket) continue;
      for (const i of bucket) {
        if (!nodeVisible(i)) continue;
        const dxw = xs[i] - wx, dyw = ys[i] - wy, d2 = dxw * dxw + dyw * dyw;
        if (d2 < bestD) { bestD = d2; best = i; }
      }
    }
  }
  state.hover = best;
  requestRender();
}

// ---- 渲染 ----
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function render() {
  updateFps();
  const { dpr } = state;
  const w = innerWidth, h = innerHeight;
  const aggregate = state.mode === 'overview';
  if (glCanvas) glCanvas.style.display = aggregate ? 'none' : 'block';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const glRendered = !aggregate && state.glRenderer.render({
    transform: state.transform,
    dpr: state.dpr,
    hiddenDirs: state.hiddenDirs,
    basePoint: NODE_R_SCREEN * Math.pow(state.transform.k, 0.4),
    edgeStartK: state.fitK,
    width: innerWidth,
    height: innerHeight,
    dirs: state.data?.dirs || [],
  });
  if (aggregate || !glRendered) drawBackground(w, h);
  if (!state.data) return;

  const { x, y, k } = state.transform;
  const vLeft = -x / k, vRight = (w - x) / k, vTop = -y / k, vBottom = (h - y) / k;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);

  // 模式由按钮决定（不随缩放自动切），两种模式干净切换
  if (aggregate) drawDirLevel(vLeft, vRight, vTop, vBottom, k);
  else drawCrisp(vLeft, vRight, vTop, vBottom, k);
  if (state.hover >= 0 && !aggregate) drawHover(k);

  ctx.restore();

  if (aggregate) drawAxes(k);
  $('nodeCount').textContent = state.data.meta.conceptCount.toLocaleString();
  $('edgeCount').textContent = state.data.meta.edgeCount.toLocaleString();
  if (state.mode === 'network' && !state.presentation.enabled) requestRender();
}

function updateFps() {
  const panel = $('fpsPanel');
  if (!panel) return;
  const network = state.mode === 'network' && !state.presentation.enabled;
  panel.style.display = network ? 'block' : 'none';
  if (!network) {
    state.fpsLast = 0;
    return;
  }

  const now = performance.now();
  if (state.fpsLast > 0) {
    const instant = 1000 / Math.max(1, now - state.fpsLast);
    state.fpsAvg = state.fpsAvg ? state.fpsAvg * 0.88 + instant * 0.12 : instant;
  }
  state.fpsLast = now;

  if (now - state.fpsLastPaint > 180) {
    const value = $('fpsValue');
    if (value) value.textContent = state.fpsAvg ? Math.round(state.fpsAvg).toString() : '--';
    state.fpsLastPaint = now;
  }
}

function drawBackground(w, h) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w * 0.52, h * 0.47, Math.min(w, h) * 0.08, w * 0.52, h * 0.47, Math.max(w, h) * 0.66);
  g.addColorStop(0, 'rgba(18,22,28,0.38)');
  g.addColorStop(0.58, 'rgba(2,4,7,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// 远视图：25 学科聚合块 + 学科间依赖（小圆大陆样式）。GIF/录制模式可高亮单个学科。
function drawDirLevel(vLeft, vRight, vTop, vBottom, k) {
  const dirs = state.data.dirs;
  const focus = state.focusDir;
  const focusInfo = focus ? state.dirColor.get(focus) : null;
  const focusRgb = focusInfo ? focusInfo.rgb : EDGE_COLOR;
  const maxW = Math.max(1, ...state.dirEdges.map((e) => e.w));
  for (const e of state.dirEdges) {
    const a = dirs[e.s], b = dirs[e.t];
    if (!dirVisible(a) || !dirVisible(b)) continue;
    const touches = focus && (a.name === focus || b.name === focus);
    if (focus && !touches) continue;   // 高亮时只画连到焦点学科的边
    const f = e.w / maxW;
    if (touches) {
      ctx.strokeStyle = `rgba(${focusRgb},${0.35 + 0.4 * f})`;
      ctx.lineWidth = Math.max(1.2, 2.6 * f) / k;
    } else {
      ctx.strokeStyle = `rgba(${EDGE_COLOR},${0.07 + 0.22 * f})`;
      ctx.lineWidth = Math.max(0.5, 2.0 * f) / k;
    }
    ctx.beginPath(); ctx.moveTo(a.cx, a.cy); ctx.lineTo(b.cx, b.cy); ctx.stroke();
  }
  for (const d of dirs) {
    if (!dirVisible(d)) continue;
    const isFocus = focus && d.name === focus;
    const dimmed = focus && !isFocus;
    const r = ((14 + Math.sqrt(d.count) * 1.4) * (isFocus ? 1.3 : 1)) / k;
    if (d.cx < vLeft - r || d.cx > vRight + r || d.cy < vTop - r || d.cy > vBottom + r) continue;
    const info = state.dirColor.get(d.name);
    ctx.beginPath(); ctx.arc(d.cx, d.cy, r, 0, Math.PI * 2);
    ctx.fillStyle = dimmed ? 'rgba(72,82,96,0.10)' : `rgba(${info.rgb},${isFocus ? 0.30 : 0.18})`;
    ctx.fill();
    ctx.lineWidth = (isFocus ? 4 : 2) / k;
    ctx.strokeStyle = dimmed ? 'rgba(90,104,124,0.35)' : `rgba(${info.rgb},${isFocus ? 1 : 0.9})`;
    ctx.stroke();
    ctx.fillStyle = isFocus ? '#ffffff' : (dimmed ? '#69727e' : '#e6edf3');
    ctx.font = `${(isFocus ? 17 : 13) / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.name, d.cx, d.cy);
    ctx.fillStyle = isFocus ? 'rgba(255,255,255,0.9)' : '#8b949e';
    ctx.font = `${10 / k}px "Segoe UI",sans-serif`;
    ctx.fillText(`${d.count.toLocaleString()}`, d.cx, d.cy + r + 11 / k);
  }
}

// 声明网络视图：默认边和节点由 WebGL 绘制；Canvas 只保留标签/hover 层。
function drawCrisp(vLeft, vRight, vTop, vBottom, k) {
  collectVisibleNodes(k);
  if (!state.glRenderer.supported) {
    drawEdgesLive(vLeft, vRight, vTop, vBottom, k);
  }
  if (state.presentation.enabled) drawPresentationNodes(vLeft, vRight, vTop, vBottom, k);
  drawNetworkDirLabels(k);
  if (k >= LABEL_K) drawCrispLabels(k);
}

function drawPresentationNodes(vLeft, vRight, vTop, vBottom, k) {
  const { nodes } = state.data;
  const focus = state.focusDir;
  const margin = 26 / k;
  const left = vLeft - margin;
  const right = vRight + margin;
  const top = vTop - margin;
  const bottom = vBottom + margin;
  const base = Math.max(1.0 / k, 1.25 / k);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < nodes.x.length; i++) {
    if (!nodeVisible(i)) continue;
    const px = nodes.x[i];
    const py = nodes.y[i];
    if (px < left || px > right || py < top || py > bottom) continue;
    const info = state.dirColor.get(nodes.dir[i]);
    ctx.fillStyle = `rgba(${info.rgb},0.34)`;
    ctx.fillRect(px - base * 0.5, py - base * 0.5, base, base);
  }

  if (focus) {
    const idx = focusDirIndex();
    const members = idx >= 0 ? state.dirMembers[idx] : [];
    const r = Math.max(2.4 / k, base * 1.7);
    ctx.globalCompositeOperation = 'lighter';
    for (const i of members) {
      if (!nodeVisible(i)) continue;
      const px = nodes.x[i];
      const py = nodes.y[i];
      if (px < left || px > right || py < top || py > bottom) continue;
      const info = state.dirColor.get(nodes.dir[i]);
      ctx.fillStyle = `rgba(${info.rgb},0.95)`;
      ctx.fillRect(px - r * 0.5, py - r * 0.5, r, r);
    }
  }
  ctx.restore();
}

// 默认依赖边（灰/白细线，视口裁剪 + 数量上限）
function drawEdgesLive(vLeft, vRight, vTop, vBottom, k) {
  const xs = state.data.nodes.x, ys = state.data.nodes.y;
  const m = CULL_MARGIN / k;
  const sLeft = vLeft - m, sRight = vRight + m, sTop = vTop - m, sBot = vBottom + m;
  let cnt = 0;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [s, t] of state.data.edges) {
    const x1 = xs[s], y1 = ys[s], x2 = xs[t], y2 = ys[t];
    if ((x1 < sLeft && x2 < sLeft) || (x1 > sRight && x2 > sRight) || (y1 < sTop && y2 < sTop) || (y1 > sBot && y2 > sBot)) continue;
    const a = state.dirColor.get(state.data.nodes.dir[s]);
    const b = state.dirColor.get(state.data.nodes.dir[t]);
    const same = state.data.nodes.dir[s] === state.data.nodes.dir[t];
    drawCurvedEdgePath(x1, y1, x2, y2, s, t);
    ctx.strokeStyle = same ? `rgba(${a.rgb},${EDGE_ALPHA})` : `rgba(${b.rgb},${EDGE_ALPHA * 0.72})`;
    ctx.lineWidth = 0.72 / k;
    ctx.setLineDash(edgeDash(x1, y1, x2, y2, k));
    ctx.lineDashOffset = -((performance.now() * 0.006 + (s % 23)) / k);
    ctx.stroke();
    if (++cnt >= MAX_EDGES) break;
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawCurvedEdgePath(x1, y1, x2, y2, seedA, seedB) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bendSeed = hash01(seedA + ':' + seedB) - 0.5;
  const bend = Math.min(90, Math.max(14, len * EDGE_CURVE)) * (bendSeed < 0 ? -1 : 1);
  const cx = (x1 + x2) / 2 - dy / len * bend;
  const cy = (y1 + y2) / 2 + dx / len * bend;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
}

function edgeDash(x1, y1, x2, y2, k) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const scale = 1 / Math.max(0.7, k);
  if (len < 55) return [2.2 * scale, 7.5 * scale];
  if (len < 160) return [4 * scale, 11 * scale];
  return [6 * scale, 15 * scale];
}

function collectVisibleNodes(k) {
  const { nodes, dirs } = state.data;
  const xs = nodes.x, ys = nodes.y;
  const { x, y } = state.transform;
  const list = state.listPool;
  list.length = 0;
  const cap = k >= 18 ? 3500 : 1200;
  const margin = CULL_MARGIN / k;
  const left = -x / k - margin;
  const right = (innerWidth - x) / k + margin;
  const top = -y / k - margin;
  const bottom = (innerHeight - y) / k + margin;

  if (state.wasmIndex) {
    const out = state.wasmIndex.filterVisible({
      left,
      right,
      top,
      bottom,
      cap,
      dirs,
      hiddenDirs: state.hiddenDirs,
    });
    for (let i = 0; i < out.length; i++) list.push(out[i]);
    for (let i = list.length - 1; i >= 0; i--) {
      if (!nodeVisible(list[i])) list.splice(i, 1);
    }
    if (state.hover >= 0 && !list.includes(state.hover)) list.push(state.hover);
    state.drawnList = list;
    return;
  }

  const gx0 = Math.floor(left / GRID_CELL), gx1 = Math.floor(right / GRID_CELL);
  const gy0 = Math.floor(top / GRID_CELL), gy1 = Math.floor(bottom / GRID_CELL);

  outer:
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const bucket = state.hoverGrid.get(gx + ',' + gy);
      if (!bucket) continue;
      for (const i of bucket) {
        if (!nodeVisible(i)) continue;
        const sx = xs[i] * k + x, sy = ys[i] * k + y;
        if (sx < 0 || sx >= innerWidth || sy < 0 || sy >= innerHeight) continue;
        list.push(i);
        if (list.length >= cap) break outer;
      }
    }
  }

  if (state.hover >= 0 && !list.includes(state.hover)) list.push(state.hover);
  state.drawnList = list;
}

function visualNodeRadius(i, k) {
  const sqrtMax = Math.sqrt(state.maxDegree);
  const degreeWeight = Math.sqrt(state.degrees[i]) / sqrtMax;
  return nodeR(k) * (0.68 + 1.15 * degreeWeight);
}

function drawNetworkDirLabels(k) {
  if (k > 7.5) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const focus = state.focusDir;
  const visible = state.dirCenters
    .filter((d) => dirVisible(d) && (NETWORK_LABELS.has(d.name) || d.name === focus))
    .sort((a, b) => b.count - a.count);
  const maxCount = Math.max(1, ...visible.map((d) => d.count || 0));
  const occupied = [];

  for (const d of visible) {
    const weight = Math.log1p(d.count || 1) / Math.log1p(maxCount);
    const focused = focus && d.name === focus;
    const screenFont = focused ? 24 : Math.round(11 + weight * 4);
    const worldFont = screenFont / k;
    ctx.font = `${focused ? 800 : 600} ${worldFont}px "Segoe UI","Microsoft YaHei",sans-serif`;
    const sx = d.x * k + state.transform.x;
    const y = d.y - (13 + weight * 6) / k;
    const sy = y * k + state.transform.y;
    const width = ctx.measureText(d.name).width * k;
    const rect = {
      x1: sx - width / 2 - 4,
      y1: sy - screenFont * 0.52 - 2,
      x2: sx + width / 2 + 4,
      y2: sy + screenFont * 0.52 + 2,
    };
    let overlaps = 0;
    for (const r of occupied) {
      if (rect.x1 < r.x2 && rect.x2 > r.x1 && rect.y1 < r.y2 && rect.y2 > r.y1) {
        overlaps++;
      }
    }
    if (!focused && overlaps > 2 && k < 1.35) continue;
    occupied.push(rect);

    ctx.strokeStyle = 'rgba(0,0,0,0.92)';
    ctx.lineWidth = (focused ? 5.6 : 3.8) / k;
    ctx.strokeText(d.name, d.x, y);
    ctx.fillStyle = focused
      ? `rgba(${state.dirColor.get(d.name).rgb},0.96)`
      : `rgba(235,238,245,${0.78 + weight * 0.16})`;
    ctx.fillText(d.name, d.x, y);
  }
  ctx.restore();
}

function focusDirIndex() {
  if (!state.focusDir || !state.data) return -1;
  return state.data.dirs.findIndex((d) => d.name === state.focusDir);
}

// Declaration labels: visible-area only, ranked and collision-checked.
function drawCrispLabels(k) {
  const { nodes } = state.data;
  const baseR = nodeR(k);
  const screenFont = Math.min(13, Math.max(10, 8 + k * 0.18));
  const worldFont = screenFont / k;
  const maxLabels = k < 12 ? 36 : Math.min(MAX_LABELS, Math.floor(48 + (k - 12) * 6));
  const candidates = state.drawnList
    .slice()
    .sort((a, b) => state.degrees[b] - state.degrees[a]);
  const occupied = [];
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `${worldFont}px "Segoe UI", Arial, sans-serif`;
  let placed = 0;
  for (const i of candidates) {
    if (placed >= maxLabels) break;
    const sx = nodes.x[i] * k + state.transform.x;
    const sy = nodes.y[i] * k + state.transform.y;
    if (sx < 24 || sx > innerWidth - 120 || sy < 28 || sy > innerHeight - 30) continue;
    const label = nodes.label[i];
    const width = Math.min(260, ctx.measureText(label).width * k);
    const x = sx + Math.max(5, baseR * k * 1.7);
    const y = sy;
    const rect = { x1: x - 3, y1: y - screenFont * 0.72, x2: x + width + 4, y2: y + screenFont * 0.72 };
    let hit = false;
    for (const r of occupied) {
      if (rect.x1 < r.x2 && rect.x2 > r.x1 && rect.y1 < r.y2 && rect.y2 > r.y1) { hit = true; break; }
    }
    if (hit) continue;
    occupied.push(rect);
    ctx.lineWidth = 3.2 / k;
    ctx.strokeStyle = 'rgba(0,0,0,0.86)';
    ctx.strokeText(label, nodes.x[i] + baseR * 1.8, nodes.y[i]);
    ctx.fillStyle = 'rgba(235,238,245,0.82)';
    ctx.fillText(label, nodes.x[i] + baseR * 1.8, nodes.y[i]);
    placed++;
  }
}

function drawAxes(k) {
  const m = state.data.meta;
  ctx.save();
  ctx.translate(state.transform.x, state.transform.y);
  ctx.scale(state.transform.k, state.transform.k);

  // 坐标轴框架始终用整体模式的绘图范围（两种模式一致）；网络模式只压缩节点、不动坐标轴。
  const p = PLOT_OVERVIEW;
  const left = p.left, right = p.right, top = p.top, bottom = p.bottom;
  const axisY = bottom + 30;
  ctx.strokeStyle = 'rgba(230,237,243,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(left, axisY); ctx.lineTo(right, axisY); ctx.stroke();
  ctx.fillStyle = '#e6edf3';
  ctx.font = '14px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('Construction Timeline', (left + right) / 2, axisY + 10);
  ctx.fillStyle = '#8b949e';
  ctx.font = '12px "Segoe UI",sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Primitives', left, axisY + 10);
  ctx.textAlign = 'right';
  ctx.fillText('Constructs', right, axisY + 10);

  const axisX = left - 26;
  ctx.fillStyle = '#e6edf3';
  ctx.font = '13px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const midY = (top + bottom) / 2;
  ctx.save();
  ctx.translate(axisX, midY);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Structural depth', 0, 0);
  ctx.restore();

  ctx.restore();
}

// 悬停高亮：不放大节点，只显示关系链和相关节点。
function drawHover(k) {
  const i = state.hover;
  const n = state.data.nodes;
  const xs = n.x, ys = n.y;
  const dirA = n.dir[i];
  const colorA = state.dirColor.get(dirA);

  // 收集 1 跳邻居（邻接表 O(deg)，不再全量扫边）
  const neigh = state.adj[i] || [];

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  // 1) 关联连线（细实线，不做夸张光晕）
  for (const j of neigh) {
    if (!nodeVisible(j)) continue;
    const x1 = xs[i], y1 = ys[i], x2 = xs[j], y2 = ys[j];
    let stroke;
    if (n.dir[j] === dirA) {
      stroke = `rgba(${colorA.rgb},0.95)`;               // 同领域 → 领域色
    } else {
      const colorB = state.dirColor.get(n.dir[j]);
      const g = ctx.createLinearGradient(x1, y1, x2, y2); // 跨领域 → 两色渐变
      g.addColorStop(0, `rgba(${colorA.rgb},0.95)`);
      g.addColorStop(1, `rgba(${colorB.rgb},0.95)`);
      stroke = g;
    }
    drawCurvedEdgePath(x1, y1, x2, y2, i, j);
    ctx.strokeStyle = stroke;
    ctx.setLineDash([]);
    ctx.lineWidth = 1.2 / k;
    ctx.globalAlpha = 0.58;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 2) 相关节点（保持正常大小，只提高可见度）
  for (const j of neigh) {
    if (!nodeVisible(j)) continue;
    const col = state.dirColor.get(n.dir[j]);
    const r = visualNodeRadius(j, k);
    ctx.beginPath(); ctx.arc(xs[j], ys[j], r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${col.rgb},0.92)`;
    ctx.fill();
    ctx.beginPath(); ctx.arc(xs[j], ys[j], r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${col.rgb},0.62)`;
    ctx.lineWidth = 0.85 / k;
    ctx.stroke();
  }

  // 3) 当前节点（正常大小 + 细白环）
  const hoverR = visualNodeRadius(i, k);
  ctx.beginPath(); ctx.arc(xs[i], ys[i], hoverR, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${colorA.rgb},1)`;
  ctx.fill();
  ctx.beginPath(); ctx.arc(xs[i], ys[i], hoverR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.86)';
  ctx.lineWidth = 1.1 / k;
  ctx.stroke();
  ctx.restore();

  // 4) hover 信息
  $('hoverInfo').textContent =
    hoverSummary(i, neigh.length);
  $('hoverInfo').style.color = colorA.color;
}

function hoverSummary(i, links) {
  const n = state.data.nodes;
  const parts = [
    n.label[i],
    n.kind[i],
    n.module[i],
    n.dir[i],
    `${Number(n.year[i]).toFixed(1)}`,
    `depth ${(n.depth[i] * 100).toFixed(0)}`,
    `${links} links`,
  ];
  return parts.filter(Boolean).join(' · ');
}

// ---- 图例 ----
function buildLegend() {
  const el = $('legend');
  el.innerHTML = '<div style="font-weight:600;margin-bottom:4px;color:var(--muted);">Subjects (click to toggle)</div>';
  const dirs = [...state.data.dirs].sort((a, b) => b.count - a.count);
  for (const d of dirs) {
    const row = document.createElement('div');
    row.className = 'item row';
    const info = state.dirColor.get(d.name);
    row.innerHTML = `<span><span class="sw" style="background:${info.color}"></span>${d.name}</span><span class="cnt">${d.count.toLocaleString()}</span>`;
    row.onclick = () => {
      if (state.hiddenDirs.has(d.name)) state.hiddenDirs.delete(d.name);
      else state.hiddenDirs.add(d.name);
      row.classList.toggle('off', state.hiddenDirs.has(d.name));
      requestRender();
    };
    el.appendChild(row);
  }
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

init();
