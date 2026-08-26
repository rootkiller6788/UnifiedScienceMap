// main.js — 数学声明「科研地图」渲染器 v3（统一坐标公式版，15 万级节点）。
// 数据 decls.json（列式 SoA）：nodes.label/kind/dir/module/depth/x/y + edges + dirs。
//   X = 数学形式化时间（模块首次进库，2021→2026）
//   Y = 0.7·社区深度 + 0.2·模块深度 + 0.05·类型权重 + 0.05·局部扰动（基础低、构造高）
// 网络模式另做轴向重映射（NET_PLOT）：只纵向压缩（横向不变），让学科簇变扁呈横向长条（整体模式不变）。
// LOD：两种干净模式——远视图画 25 学科聚合块；放大后全矢量绘制声明网络（无模糊栅格）。
// 性能：空间索引（hover 查邻居 + 节点视口裁剪都 O(视口内) 而非 O(n)）；邻接表 O(deg)；
//      屏幕格位图去重 + 复用数组（无每帧 GC）；15 万节点任意缩放流畅。
// 连线：不悬停一律灰；悬停时同领域连线用领域色、跨领域连线用两色渐变，节点/线发光。

import { zoom, zoomIdentity } from 'https://cdn.jsdelivr.net/npm/d3-zoom@3/+esm';
import { select } from 'https://cdn.jsdelivr.net/npm/d3-selection@3/+esm';

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
const SCREEN_CELL = 20;        // 高保真节点屏幕密度限流单元（屏幕像素）
const MAX_DRAWN = 8000;        // 每帧最多绘制的高保真节点数
const MAX_DRAWN_DEEP = 50000;
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
]);

// 节点世界半径：屏幕尺寸随缩放温和增长（放大视图节点也变大，而非恒定 2.2px 显得缩小）
// k=1→2.2px，k=3→3.4px，k=8→5px，k=20→7.3px，k=40→9.7px
const nodeR = (k) => NODE_R_SCREEN * Math.pow(k, 0.4) / k;

const glCanvas = document.getElementById('glgraph');
const gl = glCanvas?.getContext('webgl2', { antialias: true, alpha: false });
const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  dirColor: new Map(),      // dirName -> {color, rgb}
  nodeDirIdx: [],           // 节点 -> dir 索引
  dirMembers: [],           // dir 索引 -> [节点索引]
  degrees: null,            // Int32Array
  maxDegree: 1,
  dirEdges: [],             // 学科间聚合边 [{s,t,w}]
  dirCenters: [],           // 网络模式压缩后的学科标签中心
  networkBounds: null,      // 网络模式真实节点范围
  drawnList: [],            // 本帧实际绘制的高保真节点（标签/悬停用）
  hoverGrid: new Map(),     // 'cx,cy' -> [节点索引]（空间索引，桶内按度降序）
  adj: null,                // 邻接表（hover 查邻居 O(deg)，不再全量扫边）
  visited: new Uint8Array(0), // 屏幕格位图（节点去重，复用，避免每帧 new Map）
  perDirPool: [],           // drawCrispNodes 每帧复用的 perDir 数组池
  listPool: [],             // drawCrispNodes 每帧复用的 list
  transform: { x: 0, y: 0, k: 1 },
  fitK: 1,                  // 最远视图缩放（整图铺满屏）＝缩放下限
  mode: 'overview',         // 'overview' 整体模式（学科聚合）| 'network' 网络模式（声明网络）
  hover: -1,
  hiddenDirs: new Set(),
  dpr: 1,
  glNodes: null,
  glEdges: null,
};

// ---- 初始化 ----
async function init() {
  resize();
  window.addEventListener('resize', resize);
  setupZoom();
  setupUI();

  try {
    const res = await fetch('decls.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.data = await res.json();
  } catch (err) {
    showToast('Failed to load decls.json: ' + err.message);
    return;
  }
  buildGraph();
  buildLegend();
  $('loading').classList.add('hidden');
  fitView(0);
  requestAnimationFrame(render);
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (glCanvas) {
    glCanvas.width = Math.floor(innerWidth * state.dpr);
    glCanvas.height = Math.floor(innerHeight * state.dpr);
    glCanvas.style.width = innerWidth + 'px';
    glCanvas.style.height = innerHeight + 'px';
    if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
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
  state.perDirPool = Array.from({ length: dirs.length }, () => []);
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
  initGlNodes();
  initGlEdges();
  buildHoverGrid();   // 空间索引（桶内已按度降序，替代全局 degreeOrder）
}

function initGlNodes() {
  if (!gl) return;
  const { nodes } = state.data;
  const n = nodes.x.length;
  const stride = 7;
  const data = new Float32Array(n * stride);
  const sqrtMax = Math.sqrt(state.maxDegree);
  for (let i = 0; i < n; i++) {
    const rgb = parseRgb(state.dirColor.get(nodes.dir[i]).rgb);
    const o = i * stride;
    data[o] = nodes.x[i];
    data[o + 1] = nodes.y[i];
    data[o + 2] = rgb[0] / 255;
    data[o + 3] = rgb[1] / 255;
    data[o + 4] = rgb[2] / 255;
    data[o + 5] = Math.sqrt(state.degrees[i]) / sqrtMax;
    data[o + 6] = state.nodeDirIdx[i];
  }

  const program = createGlProgram(NODE_VERTEX_SHADER, NODE_FRAGMENT_SHADER);
  if (!program) return;
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  bindGlAttrib(program, 'a_pos', 2, stride, 0);
  bindGlAttrib(program, 'a_color', 3, stride, 2);
  bindGlAttrib(program, 'a_degree', 1, stride, 5);
  bindGlAttrib(program, 'a_dir', 1, stride, 6);
  gl.bindVertexArray(null);

  state.glNodes = {
    program,
    vao,
    count: n,
    uResolution: gl.getUniformLocation(program, 'u_resolution'),
    uTransform: gl.getUniformLocation(program, 'u_transform'),
    uDpr: gl.getUniformLocation(program, 'u_dpr'),
    uBasePoint: gl.getUniformLocation(program, 'u_basePoint'),
    uHidden: gl.getUniformLocation(program, 'u_hidden'),
  };
}

function initGlEdges() {
  if (!gl) return;
  const { nodes, edges } = state.data;
  const stride = 7;
  const data = new Float32Array(edges.length * 2 * stride);
  for (let ei = 0; ei < edges.length; ei++) {
    const [s, t] = edges[ei];
    const colorA = parseRgb(state.dirColor.get(nodes.dir[s]).rgb);
    const colorB = parseRgb(state.dirColor.get(nodes.dir[t]).rgb);
    writeGlEdgeVertex(data, ei * 2 * stride, nodes.x[s], nodes.y[s], colorA, state.nodeDirIdx[s], state.nodeDirIdx[t]);
    writeGlEdgeVertex(data, (ei * 2 + 1) * stride, nodes.x[t], nodes.y[t], colorB, state.nodeDirIdx[s], state.nodeDirIdx[t]);
  }

  const program = createGlProgram(EDGE_VERTEX_SHADER, EDGE_FRAGMENT_SHADER);
  if (!program) return;
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  bindGlAttrib(program, 'a_pos', 2, stride, 0);
  bindGlAttrib(program, 'a_color', 3, stride, 2);
  bindGlAttrib(program, 'a_dirA', 1, stride, 5);
  bindGlAttrib(program, 'a_dirB', 1, stride, 6);
  gl.bindVertexArray(null);

  state.glEdges = {
    program,
    vao,
    count: edges.length * 2,
    uResolution: gl.getUniformLocation(program, 'u_resolution'),
    uTransform: gl.getUniformLocation(program, 'u_transform'),
    uHidden: gl.getUniformLocation(program, 'u_hidden'),
  };
}

function writeGlEdgeVertex(data, offset, x, y, rgb, dirA, dirB) {
  data[offset] = x;
  data[offset + 1] = y;
  data[offset + 2] = rgb[0] / 255;
  data[offset + 3] = rgb[1] / 255;
  data[offset + 4] = rgb[2] / 255;
  data[offset + 5] = dirA;
  data[offset + 6] = dirB;
}

const NODE_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec3 a_color;
in float a_degree;
in float a_dir;
uniform vec2 u_resolution;
uniform vec3 u_transform;
uniform float u_dpr;
uniform float u_basePoint;
uniform float u_hidden[32];
out vec3 v_color;
out float v_hidden;
void main() {
  vec2 screen = a_pos * u_transform.z + u_transform.xy;
  vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = u_dpr * u_basePoint * (0.68 + 1.15 * a_degree);
  v_color = a_color;
  v_hidden = u_hidden[int(a_dir + 0.5)];
}`;

const NODE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_color;
in float v_hidden;
out vec4 outColor;
void main() {
  if (v_hidden > 0.5) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float core = smoothstep(1.0, 0.12, d);
  float edge = smoothstep(1.0, 0.76, d) * 0.22;
  outColor = vec4(v_color, max(core, edge));
}`;

const EDGE_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec3 a_color;
in float a_dirA;
in float a_dirB;
uniform vec2 u_resolution;
uniform vec3 u_transform;
uniform float u_hidden[32];
out vec3 v_color;
out float v_hidden;
void main() {
  vec2 screen = a_pos * u_transform.z + u_transform.xy;
  vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
  v_hidden = max(u_hidden[int(a_dirA + 0.5)], u_hidden[int(a_dirB + 0.5)]);
}`;

const EDGE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_color;
in float v_hidden;
out vec4 outColor;
void main() {
  if (v_hidden > 0.5) discard;
  outColor = vec4(v_color, 0.038);
}`;

function createGlProgram(vertexSource, fragmentSource) {
  const vs = compileGlShader(gl.VERTEX_SHADER, vertexSource);
  const fs = compileGlShader(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    showToast('WebGL program failed: ' + gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function compileGlShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    showToast('WebGL shader failed: ' + gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function bindGlAttrib(program, name, size, stride, offsetFloats) {
  const loc = gl.getAttribLocation(program, name);
  if (loc < 0) return;
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * Float32Array.BYTES_PER_ELEMENT, offsetFloats * Float32Array.BYTES_PER_ELEMENT);
}

function parseRgb(rgb) {
  return rgb.split(',').map((v) => Number(v.trim()));
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
// 桶内按度降序 → drawCrispNodes 用同一索引做视口裁剪时优先画高影响力节点。
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
  canvas.style.cursor = state.mode === 'overview' ? 'default' : 'grab';
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
  return state.mode === 'network' ? k * NET_DEFAULT_ZOOM : k;
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
}

function onSearch(q) {
  q = q.trim().toLowerCase();
  $('searchHint').textContent = '';
  if (!q) { state.hover = -1; requestRender(); return; }
  const nodes = state.data.nodes;
  let match = -1, count = 0;
  for (let i = 0; i < nodes.label.length; i++) {
    if (nodes.label[i].toLowerCase().includes(q) || nodes.module[i].toLowerCase().includes(q)) {
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
        if (state.hiddenDirs.has(state.data.dirs[nodeDir[i]].name)) continue;
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
  const { dpr } = state;
  const w = innerWidth, h = innerHeight;
  const aggregate = state.mode === 'overview';
  if (glCanvas) glCanvas.style.display = aggregate ? 'none' : 'block';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (aggregate || !state.glNodes) drawBackground(w, h);
  if (!state.data) return;
  if (!aggregate && state.glNodes) renderGlNodes();

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

function renderGlNodes() {
  const layer = state.glNodes;
  if (!gl || !layer) return;
  const hidden = new Float32Array(32);
  const dirs = state.data.dirs;
  for (let i = 0; i < dirs.length && i < hidden.length; i++) {
    hidden[i] = state.hiddenDirs.has(dirs[i].name) ? 1 : 0;
  }
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.useProgram(layer.program);
  gl.bindVertexArray(layer.vao);
  gl.uniform2f(layer.uResolution, innerWidth, innerHeight);
  gl.uniform3f(layer.uTransform, state.transform.x, state.transform.y, state.transform.k);
  gl.uniform1f(layer.uDpr, state.dpr);
  gl.uniform1f(layer.uBasePoint, NODE_R_SCREEN * Math.pow(state.transform.k, 0.4));
  gl.uniform1fv(layer.uHidden, hidden);
  gl.drawArrays(gl.POINTS, 0, layer.count);
  gl.bindVertexArray(null);
}

// 远视图：25 学科聚合块 + 学科间依赖（小圆大陆样式）
function drawDirLevel(vLeft, vRight, vTop, vBottom, k) {
  const dirs = state.data.dirs;
  const maxW = Math.max(1, ...state.dirEdges.map((e) => e.w));
  for (const e of state.dirEdges) {
    const a = dirs[e.s], b = dirs[e.t];
    if (state.hiddenDirs.has(a.name) || state.hiddenDirs.has(b.name)) continue;
    const f = e.w / maxW;
    ctx.strokeStyle = `rgba(${EDGE_COLOR},${0.07 + 0.22 * f})`;   // 不悬停一律灰
    ctx.lineWidth = Math.max(0.5, 2.0 * f) / k;
    ctx.beginPath(); ctx.moveTo(a.cx, a.cy); ctx.lineTo(b.cx, b.cy); ctx.stroke();
  }
  for (const d of dirs) {
    if (state.hiddenDirs.has(d.name)) continue;
    const r = (14 + Math.sqrt(d.count) * 1.4) / k;
    if (d.cx < vLeft - r || d.cx > vRight + r || d.cy < vTop - r || d.cy > vBottom + r) continue;
    const info = state.dirColor.get(d.name);
    ctx.beginPath(); ctx.arc(d.cx, d.cy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${info.rgb},0.18)`;
    ctx.fill();
    ctx.lineWidth = 2 / k; ctx.strokeStyle = `rgba(${info.rgb},0.9)`; ctx.stroke();
    ctx.fillStyle = '#e6edf3';
    ctx.font = `${13 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.name, d.cx, d.cy);
    ctx.fillStyle = '#8b949e';
    ctx.font = `${10 / k}px "Segoe UI",sans-serif`;
    ctx.fillText(`${d.count.toLocaleString()}`, d.cx, d.cy + r + 11 / k);
  }
}

// 声明网络视图：灰边 + 清晰节点（全矢量绘制，无模糊栅格）
function drawCrisp(vLeft, vRight, vTop, vBottom, k) {
  drawEdgesLive(vLeft, vRight, vTop, vBottom, k);
  if (state.glNodes) collectVisibleNodes(k);
  else drawCrispNodes(k);
  drawNetworkDirLabels(k);
  if (k >= LABEL_K) drawCrispLabels(k);
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
  const gx0 = Math.floor(-x / k / GRID_CELL), gx1 = Math.floor((innerWidth - x) / k / GRID_CELL);
  const gy0 = Math.floor(-y / k / GRID_CELL), gy1 = Math.floor((innerHeight - y) / k / GRID_CELL);
  const cap = k >= 18 ? 3500 : 1200;

  outer:
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const bucket = state.hoverGrid.get(gx + ',' + gy);
      if (!bucket) continue;
      for (const i of bucket) {
        if (state.hiddenDirs.has(dirs[state.nodeDirIdx[i]].name)) continue;
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

// 高保真节点：遍历视口覆盖的世界格（空间索引），每格只留 1 个节点 →
// 每帧只处理视口内节点（几万），不再全量扫 15 万；屏幕格位图去重（复用，无 GC）。
function drawCrispNodes(k) {
  const { nodes, dirs } = state.data;
  const xs = nodes.x, ys = nodes.y;
  const { x, y } = state.transform;
  const deepZoom = k >= 18;
  const screenCell = deepZoom ? 4 : SCREEN_CELL;
  const cols = Math.ceil(innerWidth / screenCell);
  const rows = Math.ceil(innerHeight / screenCell);
  const need = cols * rows;
  if (state.visited.length < need) state.visited = new Uint8Array(need);
  const visited = state.visited;
  visited.fill(0, 0, need);
  const perDir = state.perDirPool;
  for (let di = 0; di < dirs.length; di++) perDir[di].length = 0;
  const list = state.listPool;
  list.length = 0;
  let drawn = 0;
  const cellCap = deepZoom ? Math.min(MAX_DRAWN_DEEP, need) : Math.min(MAX_DRAWN, need);

  // 视口覆盖的世界格范围（hoverGrid 空间索引）
  const gx0 = Math.floor(-x / k / GRID_CELL), gx1 = Math.floor((innerWidth - x) / k / GRID_CELL);
  const gy0 = Math.floor(-y / k / GRID_CELL), gy1 = Math.floor((innerHeight - y) / k / GRID_CELL);

  outer:
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const bucket = state.hoverGrid.get(gx + ',' + gy);
      if (!bucket) continue;
      for (const i of bucket) {
        const sx = xs[i] * k + x, sy = ys[i] * k + y;
        if (sx < 0 || sx >= innerWidth || sy < 0 || sy >= innerHeight) continue;
        const sgx = (sx / screenCell) | 0, sgy = (sy / screenCell) | 0;
        const key = sgy * cols + sgx;
        if (visited[key]) continue;
        visited[key] = 1;
        perDir[state.nodeDirIdx[i]].push(i);
        list.push(i);
        if (++drawn >= cellCap) break outer;
      }
    }
  }

  // 悬停节点强制入列，保证可见
  if (state.hover >= 0 && !list.includes(state.hover)) {
    perDir[state.nodeDirIdx[state.hover]].push(state.hover);
    list.push(state.hover);
  }

  const baseR = nodeR(k);
  const sqrtMax = Math.sqrt(state.maxDegree);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let di = 0; di < dirs.length; di++) {
    if (state.hiddenDirs.has(dirs[di].name)) continue;
    const arr = perDir[di];
    if (!arr.length) continue;
    const info = state.dirColor.get(dirs[di].name);

    // Subtle bloom only for important nodes. Large per-node translucent halos
    // look blobby at map scale, so most nodes stay as crisp solid dots.
    ctx.fillStyle = `rgba(${info.rgb},0.12)`;
    ctx.beginPath();
    for (const i of arr) {
      const degreeWeight = Math.sqrt(state.degrees[i]) / sqrtMax;
      if (degreeWeight < 0.28) continue;
      const r = baseR * (1.35 + 2.0 * degreeWeight);
      ctx.moveTo(xs[i] + r, ys[i]);                   // 圆（无方角），moveTo 避免 arc 间连线
      ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.fillStyle = info.color;
    ctx.beginPath();
    for (const i of arr) {
      const r = visualNodeRadius(i, k);
      ctx.moveTo(xs[i] + r, ys[i]);
      ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore();
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
  for (const d of state.dirCenters) {
    if (!NETWORK_LABELS.has(d.name) || state.hiddenDirs.has(d.name)) continue;
    const fontSize = Math.min(28, Math.max(13, 12 + Math.log10(d.count + 1) * 3.6)) / k;
    ctx.font = `600 ${fontSize}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.strokeStyle = 'rgba(0,0,0,0.92)';
    ctx.lineWidth = 4.8 / k;
    ctx.strokeText(d.name, d.x, d.y - 18 / k);
    ctx.fillStyle = 'rgba(235,238,245,0.88)';
    ctx.fillText(d.name, d.x, d.y - 18 / k);
  }
  ctx.restore();
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
  ctx.fillText('Subject clusters ordered by first mathlib entry time', (left + right) / 2, axisY + 10);
  ctx.fillStyle = '#8b949e';
  ctx.font = '12px "Segoe UI",sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${m.yearMin}`, left, axisY + 10);
  ctx.textAlign = 'right';
  ctx.fillText(`${m.yearMax}`, right, axisY + 10);

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

  // 1) 关联连线（细虚线，不做夸张光晕）
  for (const j of neigh) {
    if (state.hiddenDirs.has(n.dir[j])) continue;
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
    ctx.setLineDash([4 / k, 6 / k]);
    ctx.lineWidth = 1.2 / k;
    ctx.globalAlpha = 0.58;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 2) 相关节点（保持正常大小，只提高可见度）
  for (const j of neigh) {
    if (state.hiddenDirs.has(n.dir[j])) continue;
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
    `${n.label[i]} · ${n.kind[i]} · ${n.module[i]} · ${dirA} · ${n.year[i].toFixed(1)} · depth ${(n.depth[i] * 100).toFixed(0)} · ${neigh.length} links`;
  $('hoverInfo').style.color = colorA.color;
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
