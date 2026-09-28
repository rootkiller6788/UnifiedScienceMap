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
// 版本号要和 index.html 里 main.js 的那个一起改 —— 只改一个的话，另一个会继续用
// 缓存里的旧文件，于是改了代码却看不到效果（python -m http.server 忽略查询串）。
import { createChordView } from './phil-chord.js?v=science-views-1';
import { createAlluvialView } from './alluvial-chart.js?v=strata-flow-1';
// 珊瑚替掉了旭日图（用户判定「层级本来就是分枝的，为什么要拍成一个圆环」）。
// sunburst-chart.js 保留不删，只是不再 import —— 和 interdisc-network.js 一样。
import { createCoralView } from './knowledge-coral.js?v=knowledge-coral-1';
import { createInterdiscView } from './interdisc-matrix.js?v=interdisc-matrix-1';
import { createMyceliumView } from './mycelium.js?v=mycelium-5';
// evolution-river.js 保留不删，只是不再 import —— 同 sunburst-chart.js / interdisc-network.js。
// 河流图把时间摊成几条并排的带子、高度归一到 100%，绝对体量被抹平；换成地质剖面：
// 时间竖着走、宽度就是体量。两者共用同一份 openalex-history.json。
import { createEvolutionView } from './evolution-strata.js?v=evolution-strata-1';

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
const OVERVIEW_ZOOM_OUT = 0.64125;  // 整体模式取景再拉远约 29%（0.9 × 0.75 × 0.95），避免边缘学科圆高亮放大后被视口裁切
const HIVE_ZOOM = 1.0;  // hive 模式取景更近：径向图在画面中更大（>1 放大，<1 拉远）
const GIF_MODE = new URLSearchParams(location.search).has('gif') || location.hash.includes('gif');
const GIF_MANUAL = new URLSearchParams(location.search).has('manualGif');
const SCIENCE_ZOOM = 0.92;
// onChange = 模块自己改了状态之后要求重画。渲染是按需的（requestRender → 单次 rAF），
// 所以图例里的点击如果没有这条线，画布会一直停在改动之前的那一帧 —— 点「隐藏某个学科」
// 什么也不会发生，直到下一次 mousemove 顺手重画。五个模块全部接上（见 §4）。
// requestRender 是函数声明，提升过了，这里在它定义之前引用是安全的。
// 哲学弦图自成一套屏幕空间几何（不经过世界坐标变换），所以不需要取景缩放。
const philView = createChordView({ onChange: requestRender });
// 冲积图跟其它学科模式一样画在 1600×900 的世界坐标里，所以走缩放。
const alluvialView = createAlluvialView({ onChange: requestRender });
// 珊瑚有自己的数据文件（coral-data.json，cluster 层的坐标/学科/文章数/概念），
// 但术语名仍然从 sunburst-data.json 的 topics 借 —— 不重复存 274,422 个字符串。
const coralView = createCoralView({ onChange: requestRender });
const interdiscView = createInterdiscView({ onChange: requestRender });
// 菌丝图和矩阵吃同一份 sunburst-data.json，但推导的是**纤维**（Σ C(k,2) = 35,313 根），
// 不是矩阵。所以它不需要自己的数据文件，也不需要 state 里多一个槽。
const myceliumView = createMyceliumView({ onChange: requestRender });
const evolutionView = createEvolutionView({ onChange: requestRender });
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
  hiveData: null,
  scienceData: null,
  ucsdData: null,
  sunburstData: null,
  coralData: null,
  interdiscData: null,
  evolutionData: null,
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
  hiveHover: '',
  hiveLocked: '',
  scienceHover: null,
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
    // 冲积图直接吃 state.data（unified-decls.json），不需要另加一份数据文件。
    alluvialView.setData(state.data);
    state.hiveData = await loadHiveData();
    state.scienceData = await loadScienceAtlasData();
    state.ucsdData = await loadUcsdMapData();
    philView.setData(await loadPhilData());
    // 三个新图各自吃自己的数据文件，全部可选：任何一个缺失只让那一个模式画一行提示，
    // 不许连累其它十个模式。setData 在这里就调，图例留到进模式时（switchMode）再渲染。
    state.sunburstData = await loadSunburstData();
    // 珊瑚：自己的数据文件（cluster 层）+ sunburst 的 topics（只借术语名）。
    state.coralData = await loadCoralData();
    coralView.setData(state.coralData, state.sunburstData);
    state.interdiscData = await loadInterdiscData();
    // 矩阵的主数据源是 sunburst 的 arcs（术语 × 学科的归属关系），现场推导出整个矩阵；
    // interdisc-data.json 只当**可选**的第二来源做逐格交叉校验（它没有逐对的术语表）。
    // 缺了它矩阵照样画，只是少一层独立验证 —— 见 interdisc-matrix.js 顶部。
    interdiscView.setData(state.sunburstData, state.interdiscData);
    // 菌丝图吃同一份 arcs，但推导的是 35,313 根纤维（Σ C(k,2)），不新增数据文件。
    myceliumView.setData(state.sunburstData);
    state.evolutionData = await loadEvolutionData();
    evolutionView.setData(state.evolutionData);
  } catch (err) {
    showToast('Failed to load map data: ' + err.message);
    return;
  }
  buildGraph();
  await initWasmIndex();
  buildLegend();
  // Deep link: ?mode=philosophy opens straight into a mode without a click.
  // Match against the set of real modes, not against a button id rebuilt from the mode
  // name: the ids are not uniformly cased (the toolbar has btnUCSD, not btnUcsd), so the
  // old derivation silently dropped ?mode=ucsd, and it also let ?mode=fit through to
  // switchMode('fit') because btnFit happens to match the same pattern.
  // 'river' 保留成别名：老深链 ?mode=river 还得能开，落到同一张图上。
  const MODE_NAMES = ['overview', 'hive', 'atlas', 'alluvial', 'ucsd', 'philosophy', 'network',
    'coral', 'interdisc', 'mycelium', 'evolution', 'river'];
  const MODE_ALIASES = { river: 'evolution' };
  const wanted = new URLSearchParams(location.search).get('mode');
  if (wanted && wanted !== state.mode && MODE_NAMES.includes(wanted)) {
    switchMode(MODE_ALIASES[wanted] || wanted);
  }
  $('loading').classList.add('hidden');
  fitView(0);
  if (state.presentation.enabled && !GIF_MANUAL) startGifPresentation();
  if (state.presentation.enabled && GIF_MANUAL) installGifRecorder();
  requestAnimationFrame(render);
}

async function loadHiveData() {
  try {
    const res = await fetch('hive-data.json');
    if (res.ok) return await res.json();
  } catch {
    // Hive can fall back to runtime aggregation while iterating locally.
  }
  return null;
}

async function loadScienceAtlasData() {
  try {
    const res = await fetch('science-atlas-data.json');
    if (res.ok) return await res.json();
  } catch {
    // Atlas/UCSD are optional while iterating locally.
  }
  return null;
}

async function loadUcsdMapData() {
  try {
    const res = await fetch('ucsd-science-map.json');
    if (res.ok) return await res.json();
  } catch {
    // UCSD mode is optional while iterating locally.
  }
  return null;
}

// 哲学分类弦图（由 Philpapers-API 的 pipeline --web-dir 生成）。可选：缺失时按钮仍
// 在，但该模式下会画一行提示而不是空白画布。
async function loadPhilData() {
  try {
    const res = await fetch('philpapers-chord.json');
    if (res.ok) return await res.json();
  } catch {
    // Philosophy mode is optional; the science map must still load.
  }
  return null;
}

// 旭日图的数据文件是三者里唯一大的（约 9.3 MB：299,286 条弧、274,422 个 topic）。
// 它是 eager load —— 跟 scienceData 一样在 init() 里载完，因为按需载会让第一次点
// 按钮时白屏一整秒。代价（启动多 9.3 MB）已在 README 里写明。
async function loadSunburstData() {
  try {
    const res = await fetch('sunburst-data.json');
    if (res.ok) return await res.json();
  } catch {
    // Sunburst mode is optional; the other ten modes must still load.
  }
  return null;
}

// 珊瑚的 cluster 层：85,643 个簇的坐标/学科/文章数 + 426,647 个 (簇, 概念) 对，约 4.6 MB。
// 也是 eager load —— 生长要 200 ms 左右，按需载会让第一次进模式时更久。
async function loadCoralData() {
  try {
    const res = await fetch('coral-data.json');
    if (res.ok) return await res.json();
  } catch {
    // Coral mode is optional; the other modes must still load.
  }
  return null;
}

async function loadInterdiscData() {
  try {
    const res = await fetch('interdisc-data.json');
    if (res.ok) return await res.json();
  } catch {
    // Interdisc mode is optional.
  }
  return null;
}

async function loadEvolutionData() {
  try {
    const res = await fetch('openalex-history.json');
    if (res.ok) return await res.json();
  } catch {
    // Evolution mode is optional.
  }
  return null;
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
  if (isStaticMode() && state.data) {
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
    if (isStaticMode()) return false;
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
  canvas.style.cursor = state.presentation.enabled || isStaticMode() ? 'default' : 'grab';
}

function nodeVisible(i) {
  const nodes = state.data.nodes;
  return !state.hiddenDirs.has(nodes.dir[i]);
}

function dirVisible(dir) {
  return !state.hiddenDirs.has(dir.name);
}

function isStaticMode(mode = state.mode) {
  return mode === 'overview' || mode === 'hive' || mode === 'atlas' || mode === 'alluvial'
    || mode === 'ucsd' || mode === 'philosophy'
    || mode === 'coral' || mode === 'interdisc' || mode === 'mycelium' || mode === 'evolution';
}

// The three *old* science maps draw their own frame and get no HUD panel (see
// body.science-mode in index.html). Deliberately narrower than isStaticMode: overview,
// hive and philosophy all need their bottom-left legend to be usable.
//
// sunburst / interdisc / evolution are static modes but are NOT here, on purpose. Each of
// the three carries its own long legend — 11 discipline names + colours for the sunburst and
// the network, ten band names plus the honesty notes for the stratigraphic column — and that
// legend *is* the colour key. Hiding the panel like the old three do would leave the reader
// with unlabelled hues and no way to read them.
function isScienceMapMode(mode = state.mode) {
  return mode === 'atlas' || mode === 'ucsd' || mode === 'alluvial';
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
  if (isStaticMode()) {
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

// 只有这三个新图需要「避让左下角面板」的取景。它们三个都是把整个世界矩形从边到边画满
// （旭日图的圆、网络图的十一边形、河流图整幅），面板一定会压到东西；旧的八个模式要么
// 把面板藏起来（atlas/ucsd/alluvial），要么画的是散布的节点（面板压住的是空白）。
// 刻意不推广到旧模式：那会连带改掉它们的构图，而它们的取景是历史行为。
function panelAwareMode(mode = state.mode) {
  return mode === 'coral' || mode === 'interdisc' || mode === 'mycelium' || mode === 'evolution';
}

// 视口里**没有被左下角面板占掉**的那块矩形。
//
// 为什么必须实时量，不能写成世界常量：面板是屏幕空间的固定方框（宽约 430px、贴左下），
// 图是世界空间按 k 缩放出来的。同一个世界坐标 x=92（地层的左端）在 1600 宽的窗口里落在
// 面板右边，在 1280 宽里就落进面板底下 —— 于是「把 PAD_L 调大」这类改法只能在
// 某一个窗口尺寸下成立，换个尺寸就又压上了。取景直接读面板的 rect，才对每个尺寸都成立。
//
// 面板被隐藏（body.science-mode）或用户按「−」收起（#hud.collapsed）时退还整幅视口，
// 于是「收起图例 = 图变大」是免费的，不用另写一条规则。
function freeViewport() {
  let left = 8, top = 8, right = innerWidth - 8, bottom = innerHeight - 56;
  const hud = $('hud');
  if (hud && getComputedStyle(hud).display !== 'none') {
    left = Math.max(left, hud.getBoundingClientRect().right + 14);
  }
  // 窗口小到面板比视口还宽时不能给出负数，否则 k 是负的、整个画面翻转。
  return { left, top, right, bottom, w: Math.max(320, right - left), h: Math.max(240, bottom - top) };
}

// 最远视图缩放（缩放下限）：按当前模式的世界尺寸铺满屏。
function currentFitK() {
  const r = currentWorld();
  const free = panelAwareMode() ? freeViewport() : null;
  const k = free ? Math.min(free.w / r.w, free.h / r.h)
    : Math.min((innerWidth - 80) / r.w, (innerHeight - 60) / r.h);
  if (state.mode === 'network') return k * NET_DEFAULT_ZOOM;
  if (state.mode === 'hive') return k * HIVE_ZOOM;
  // 三个新图也是 1600×900 的世界，取景跟 atlas/alluvial/ucsd 同一档。
  // 必须写全：最后的兜底是 OVERVIEW_ZOOM_OUT，它会把没列到的模式悄悄当成 overview
  // 来取景（跑得通，只是画面比例不对，所以这种错永远不会有报错提示）。
  if (state.mode === 'atlas' || state.mode === 'alluvial' || state.mode === 'ucsd'
    || state.mode === 'coral' || state.mode === 'interdisc' || state.mode === 'mycelium'
    || state.mode === 'evolution') {
    return k * SCIENCE_ZOOM;
  }
  return k * OVERVIEW_ZOOM_OUT;
}

// 重算并应用缩放下限（模式切换或窗口缩放时调用）。
function updateFitK() {
  state.fitK = currentFitK();
  zoomBehavior.scaleExtent([state.fitK, 120]);
}

function fitTransformForCurrentWorld() {
  const k = state.fitK;
  const { cx, cy } = currentWorld();
  // 面板感知的模式把世界居中到「没被面板占掉的那块」里，而不是整个视口的中心 ——
  // 两边都居中就白避让了：图会有一半重新滑回面板底下。
  const free = panelAwareMode() ? freeViewport() : null;
  const mx = free ? (free.left + free.right) / 2 : innerWidth / 2;
  const my = free ? (free.top + free.bottom) / 2 : innerHeight / 2;
  return zoomIdentity.translate(mx - cx * k, my - cy * k).scale(k);
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
  state.scienceHover = null;
  alluvialView.setHover(null);
  coralView.setHover(null);
  interdiscView.setHover(null);
  myceliumView.setHover(null);
  evolutionView.setHover(null);
  if (isStaticMode(mode)) state.focusDir = '';
  if (mode !== 'hive') {
    state.hiveHover = '';
    state.hiveLocked = '';
  }
  $('btnOverview').classList.toggle('active', mode === 'overview');
  $('btnHive').classList.toggle('active', mode === 'hive');
  $('btnAtlas').classList.toggle('active', mode === 'atlas');
  $('btnAlluvial').classList.toggle('active', mode === 'alluvial');
  $('btnUCSD').classList.toggle('active', mode === 'ucsd');
  $('btnPhilosophy').classList.toggle('active', mode === 'philosophy');
  $('btnCoral').classList.toggle('active', mode === 'coral');
  $('btnInterdisc').classList.toggle('active', mode === 'interdisc');
  $('btnMycelium').classList.toggle('active', mode === 'mycelium');
  $('btnEvolution').classList.toggle('active', mode === 'evolution');
  $('btnNetwork').classList.toggle('active', mode === 'network');
  // 表头那两个数字在两个学科图里量的不是同一件东西，所以标签跟着模式换。
  // 兜底必须是声明图的那对词：没列到的模式（overview / hive / network）量的就是声明数。
  const GAUGE_LABELS = {
    philosophy: ['Categories', 'Cross-listings'],
    alluvial: ['Declarations', 'Strata Ribbons'],
    coral: ['Clusters', 'Concepts'],
    interdisc: ['Disciplines', 'Bridging Terms'],
    mycelium: ['Disciplines', 'Concept Fibres'],
    evolution: ['Years', 'Fields'],
  };
  const labels = GAUGE_LABELS[mode] || ['Declarations', 'Relations'];
  const gauges = document.querySelectorAll('#hud .gauge span');
  if (gauges.length >= 2) {
    gauges[0].textContent = labels[0];
    gauges[1].textContent = labels[1];
  }
  $('hoverInfo').textContent = '';
  $('search').placeholder = mode === 'philosophy'
    ? 'Search categories, e.g. mind / ethics / language...'
    : 'Search declarations, e.g. kernel / Cauchy / group...';
  if (mode === 'philosophy') {
    philView.renderLegend($('legend'));
  } else if (mode === 'alluvial') {
    alluvialView.renderLegend($('legend'));
  } else if (mode === 'coral') {
    coralView.renderLegend($('legend'));
  } else if (mode === 'interdisc') {
    interdiscView.renderLegend($('legend'));
  } else if (mode === 'mycelium') {
    myceliumView.renderLegend($('legend'));
  } else if (mode === 'evolution') {
    evolutionView.renderLegend($('legend'));
  } else {
    buildLegend();
  }
  document.body.classList.toggle('philosophy-mode', mode === 'philosophy');
  document.body.classList.toggle('alluvial-mode', mode === 'alluvial');
  document.body.classList.toggle('coral-mode', mode === 'coral');
  document.body.classList.toggle('interdisc-mode', mode === 'interdisc');
  document.body.classList.toggle('mycelium-mode', mode === 'mycelium');
  document.body.classList.toggle('evolution-mode', mode === 'evolution');
  document.body.classList.toggle('science-mode', isScienceMapMode(mode));
  updateFitK();
  updateCanvasCursor();
  if (isStaticMode(mode)) {
    fitView(350);
    return;
  }
  fitView(350);
}

// ---- UI ----
function setupUI() {
  $('btnFit').onclick = () => fitView();
  $('btnOverview').onclick = () => switchMode('overview');
  $('btnHive').onclick = () => switchMode('hive');
  $('btnAtlas').onclick = () => switchMode('atlas');
  $('btnAlluvial').onclick = () => switchMode('alluvial');
  $('btnUCSD').onclick = () => switchMode('ucsd');
  $('btnPhilosophy').onclick = () => switchMode('philosophy');
  $('btnCoral').onclick = () => switchMode('coral');
  $('btnInterdisc').onclick = () => switchMode('interdisc');
  $('btnMycelium').onclick = () => switchMode('mycelium');
  $('btnEvolution').onclick = () => switchMode('evolution');
  $('btnNetwork').onclick = () => switchMode('network');
  $('btnHudToggle').onclick = () => {
    const collapsed = $('hud').classList.toggle('collapsed');
    $('btnHudToggle').textContent = collapsed ? '+' : '−';
    $('btnHudToggle').title = collapsed ? 'Show legend' : 'Hide legend';
    // 面板收起/展开会改变「没被面板占掉的那块视口」，而面板感知的三个图正是按那块来
    // 取景的。不重算的话，收起来腾出的空间就一直空着，图也不会跟着变大。
    if (panelAwareMode()) { updateFitK(); fitView(300); }
  };
  $('search').addEventListener('input', (e) => onSearch(e.target.value));
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mouseleave', () => {
    state.hover = -1;
    state.hiveHover = '';
    state.scienceHover = null;
    philView.setHover(null);
    // 这几个视图的状态各自独立，漏掉谁，谁的悬停高亮就会在指针离开画布之后一直黏着
    // （冲积图原来就在漏，见 §4）。清完之后重画一次，让黏住的那一帧立刻消失。
    alluvialView.setHover(null);
    coralView.setHover(null);
    interdiscView.setHover(null);
    myceliumView.setHover(null);
    evolutionView.setHover(null);
    if (!state.hiveLocked) $('hoverInfo').textContent = philView.describe(philView.getPinned());
    requestRender();
  });
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
  // 每个模式的「每个」是什么，见 gifFramePlans()。定义贴着数据，录制端照着走就行。
  document.body.dataset.gifPlans = JSON.stringify(gifFramePlans());
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

// 每个模式的 GIF 帧序 = 「图例里逐行的每一个」，一处一份：
//   alluvial  两级 —— 先逐层亮整层（7 层），再在每层内部自上而下逐个亮节点（219 个）。
//             整条计划由 alluvial-chart.js 的 framePlan() 生成，因为层内顺序就是 layout()
//             排出来的纵向顺序，那个知识只有那个模块有。
//   coral / mycelium  一级 —— 一个学科一帧，只高亮不下钻。个数从各自的 getCounts() 读，
//             不在这儿另抄一份名单（coral 的 D=11 是硬编码的，抄出来迟早对不上）。
//   interdisc 一级 —— 也是一个学科一帧，但**每帧点开一格**：点该学科最接近的那一对
//             （bestPartner），落到 L1「术语 × 11 学科」页。原来是只亮行+列，用户要的
//             是点开。不能点它自己那一格 —— 对角线在 focusTerms 里恒为空页。
//             节奏是「点开一个 → 返回 → 下一个」，所以两格之间插一帧 L0。返回帧用
//             {type:'back'} 表示：它是 JSON 能装的结构，parseGifFocus 认得，
//             togglePinned 也真的会退回 L0。
//             **不能往计划里放 null** —— JSON.stringify(null) 是字符串 "null"，
//             parseGifFocus 走不到 JSON.parse 那条路（首字符不是 '{'），会把
//             "null" 当成一个叫 null 的裸名字节点。
//             相邻两格落到同一个格子上就只留一格：11 个学科实测只落在 5 个格子上
//             （平均连接聚类下互为最邻近的很多），同一页连开两次、中间只隔一帧全景，
//             看着像卡了一下。返回帧已经保证相邻两格不会被合成器并帧，这里去重是
//             为了避免「点开 A → 返回 → 又点开 A」这种读起来像 bug 的重复。
// 目标类型的名字三个模块各不相同：coral 认 discipline、mycelium 认 field、
// interdisc 认 cell。JSON 里存的就是它们 setHover/togglePinned 直接收的那个形状。
function gifFramePlans() {
  const oneLevel = {
    coral: ['discipline', coralView],
    mycelium: ['field', myceliumView],
  };
  const plans = { alluvial: alluvialView.framePlan() };
  for (const [mode, [type, view]] of Object.entries(oneLevel)) {
    const n = (view.getCounts() || {}).disciplineCount || 0;
    plans[mode] = Array.from({ length: n }, (_, i) => ({ type, i }));
  }
  const nInter = (interdiscView.getCounts() || {}).disciplineCount || 0;
  const cellKey = (t) => `${t.i}-${t.j}`;
  const cells = Array.from({ length: nInter }, (_, i) => interdiscView.bestPartner(i))
    .filter(Boolean)
    .filter((t, i, all) => i === 0 || cellKey(t) !== cellKey(all[i - 1]));
  plans.interdisc = [];
  cells.forEach((c, i) => {
    if (i) plans.interdisc.push({ type: 'back' });   // 点开一个 → 返回 → 下一个
    plans.interdisc.push(c);
  });
  return plans;
}

// 高亮谁由 mode 决定，参数是一份 focus 目标（JSON；空串 = 全景）。
// coral / mycelium 的强高亮读的是 pinned（`focus = pinned`），只有 togglePinned 写得进去。
// interdisc 现在也走 togglePinned —— 但它的格子是**下钻**而不是高亮，语义是切换：
// 同一格喂两次会把 L1 关掉。所以先无条件回 L0（back() 在 L0 上是空操作、不重绘），
// 再点开目标。这样这套动作没有状态，重复喂同一帧也不会翻车。
function applyGifFocus(mode, s) {
  const target = parseGifFocus(s);
  if (mode === 'alluvial') { alluvialView.setHover(target); return; }
  if (mode === 'coral') { pinOnce(coralView, target); return; }
  if (mode === 'mycelium') { pinOnce(myceliumView, target); return; }
  if (mode === 'interdisc') {
    interdiscView.togglePinned({ type: 'back' });
    if (target) interdiscView.togglePinned(target);
    return;
  }
}

function pinOnce(view, target) {
  // togglePinned 是**切换**语义，同一个目标喂两次反而会把它关掉。录帧端一次写两个属性、
  // MutationObserver 合并成一次回调，本来不会重放；这层保护很便宜，写上。
  if (!view.sameTarget(view.getPinned(), target)) view.togglePinned(target);
}

function parseGifFocus(s) {
  if (!s) return null;
  if (s[0] === '{') { try { return JSON.parse(s); } catch { return null; } }
  return { type: 'node', col: 1, name: s };
}

function setGifFrame(mode, focusDir = '') {
  state.mode = mode;
  state.hover = -1;
  state.focusDir = focusDir;
  if (mode === 'hive') {
    // hive 模式用 frameFocus 驱动轴高亮：亮起该轴及其所有关联弦
    state.hiveHover = focusDir;
    state.hiveLocked = '';
  } else {
    state.hiveHover = '';
    state.hiveLocked = '';
  }
  // frameFocus 对这几个模式是**结构化**的 JSON 目标（见 gifFramePlans），hive 那条老路
  // 还是裸名字。名字里带冒号的（alluvial col 6 的 cluster 名是 `kind: leaf`）靠 JSON 才不
  // 会被切错，这也是当初不走 `col:name` 那种字符串拼接的原因。
  applyGifFocus(mode, focusDir);
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
  // 哲学模式：搜索领域名或例子里的类目名，命中的弦与弧保持高亮，其余压暗。
  if (state.mode === 'philosophy') {
    philView.setQuery(q);
    const hit = philView.matched();
    $('searchHint').textContent = !q ? '' : (hit && hit.size ? `Highlighting ${hit.size} branches` : 'No matches');
    requestRender();
    return;
  }
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
    // 搜索命中的一定是声明节点，所以必须落到 network 模式。这里原来手抄了一份
    // switchMode 的活 —— 而且抄漏了 btnPhilosophy（从哲学模式搜索，Philosophy 按钮会
    // 一直亮着；现在多了三个按钮，手抄版会漏得更多）。直接调 switchMode 就没有这份
    // 影子清单要维护了：按钮、表头、图例、body class、缩放下限一次全对。
    // switchMode 里的 fitView(350) 会被紧接着的 flyToNode 取消，取景仍以飞行为准。
    if (state.mode !== 'network') switchMode('network');
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
  if (state.mode === 'hive') {
    const axis = pickHiveAxis(ev);
    state.hiveHover = axis?.subject || '';
    updateHiveHud();
    requestRender();
    return;
  }
  if (state.mode === 'atlas' || state.mode === 'ucsd') {
    state.scienceHover = pickSciencePoint(ev);
    updateScienceHud();
    requestRender();
    return;
  }
  // alluvial / coral / interdisc / mycelium / evolution 这五个模块遵守同一份契约：几何画在
  // 1600×900 的世界坐标里、自己认自己的命中形状、悬停对象每次重建。所以悬停接线也只写
  // 一份 —— 以前 alluvial 单独抄了一遍，再加四个就会变成五份几乎相同的代码。
  const worldView = worldPickView(state.mode);
  if (worldView) {
    const rect = canvas.getBoundingClientRect();
    const { x, y, k } = state.transform;
    const hit = worldView.pick((ev.clientX - rect.left - x) / k,
                               (ev.clientY - rect.top - y) / k);
    // 每次移动都重建对象会让悬停状态永远不相等，所以按目标比较。
    if (!worldView.sameTarget(hit, worldView.getHover())) {
      worldView.setHover(hit);
      $('hoverInfo').textContent = worldView.describe(hit || worldView.getPinned());
      requestRender();
    }
    return;
  }
  if (state.mode === 'philosophy') {
    const rect = canvas.getBoundingClientRect();
    const hit = philView.pick(ev.clientX - rect.left, ev.clientY - rect.top);
    // 每次移动都重建对象会让悬停状态永远不相等，所以按目标比较。
    const prev = philView.getHover();
    if (!samePhilTarget(hit, prev)) {
      philView.setHover(hit);
      $('hoverInfo').textContent = hit ? philView.describe(hit) : philView.describe(philView.getPinned());
      requestRender();
    }
    return;
  }
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

// 哪几个模式共用「世界坐标 + 模块自己认命中形状」这条契约。返回 null 表示该模式走别的
// 路（hive/atlas/ucsd 有自己的拾取，philosophy 是屏幕坐标，overview/network 读节点网格）。
// 这是一张显式的表，不是 default 兜底：新模式忘了加进来时，症状是「有画面但悬停没反应」，
// 而这里多写一行只会让某个模式多一条永远走不到的代码 —— 出错的方向不对称，所以要显式。
function worldPickView(mode) {
  if (mode === 'alluvial') return alluvialView;
  if (mode === 'coral') return coralView;
  if (mode === 'interdisc') return interdiscView;
  if (mode === 'mycelium') return myceliumView;
  if (mode === 'evolution') return evolutionView;
  return null;
}

// The chord view owns the shape of its own hover targets, so it also owns the
// question of whether two of them are the same one.
function samePhilTarget(a, b) {
  if (!a || !b) return !a && !b;
  return philView.sameTarget(a, b);
}

function onCanvasClick(ev) {
  if (state.presentation.enabled) return;
  if (state.mode === 'philosophy') {
    const rect = canvas.getBoundingClientRect();
    const hit = philView.pick(ev.clientX - rect.left, ev.clientY - rect.top);
    philView.togglePinned(hit);
    $('hoverInfo').textContent = philView.describe(philView.getPinned() || philView.getHover());
    requestRender();
    return;
  }
  // 同上：点已钉住的那个就取消钉住，点别的就改钉它 —— 悬停会被下一次鼠标移动擦掉，
  // 想留住一条丝带/一条弧/一个学科的数字只能靠钉住。
  const worldView = worldPickView(state.mode);
  if (worldView) {
    const rect = canvas.getBoundingClientRect();
    const { x, y, k } = state.transform;
    const hit = worldView.pick((ev.clientX - rect.left - x) / k,
                               (ev.clientY - rect.top - y) / k);
    worldView.togglePinned(hit);
    $('hoverInfo').textContent =
      worldView.describe(worldView.getPinned() || worldView.getHover());
    requestRender();
    return;
  }
  if (state.mode !== 'hive') return;
  const axis = pickHiveAxis(ev);
  state.hiveLocked = axis ? (state.hiveLocked === axis.subject ? '' : axis.subject) : '';
  state.hiveHover = axis?.subject || '';
  updateHiveHud();
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
  const overview = state.mode === 'overview';
  const hive = state.mode === 'hive';
  const atlas = state.mode === 'atlas';
  const alluvial = state.mode === 'alluvial';
  const ucsd = state.mode === 'ucsd';
  const philosophy = state.mode === 'philosophy';
  const mycelium = state.mode === 'mycelium';
  const coral = state.mode === 'coral';
  const interdisc = state.mode === 'interdisc';
  const evolution = state.mode === 'evolution';
  const network = state.mode === 'network';
  if (glCanvas) glCanvas.style.display = network ? 'block' : 'none';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const glRendered = network && state.glRenderer.render({
    transform: state.transform,
    dpr: state.dpr,
    hiddenDirs: state.hiddenDirs,
    basePoint: NODE_R_SCREEN * Math.pow(state.transform.k, 0.4),
    edgeStartK: state.fitK,
    width: innerWidth,
    height: innerHeight,
    dirs: state.data?.dirs || [],
  });
  if (!network || !glRendered) drawBackground(w, h);

  // 哲学弦图自绘屏幕空间几何，绕过世界变换（它没有平移/缩放）。
  if (philosophy) {
    philView.draw(ctx, w, h, dpr);
    const meta = philView.getData()?.meta;
    $('nodeCount').textContent = meta ? meta.categories.toLocaleString() : '-';
    // parentPairs = every extra parent edge, which is exactly one cross-listing each.
    $('edgeCount').textContent = meta ? meta.parentPairs.toLocaleString() : '-';
    return;
  }
  if (!state.data) return;

  const { x, y, k } = state.transform;
  const vLeft = -x / k, vRight = (w - x) / k, vTop = -y / k, vBottom = (h - y) / k;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);

  // 模式由按钮决定（不随缩放自动切），两种模式干净切换
  if (overview) drawDirLevel(vLeft, vRight, vTop, vBottom, k);
  else if (hive) drawHive(k);
  else if (atlas) drawScienceAtlas(k);
  else if (alluvial) drawScienceAlluvial(k);
  else if (ucsd) drawUcsdMap(k);
  else if (coral) drawScienceCoral(k);
  else if (interdisc) drawScienceInterdisc(k);
  else if (mycelium) drawScienceMycelium(k);
  else if (evolution) drawScienceEvolution(k);
  else drawCrisp(vLeft, vRight, vTop, vBottom, k);
  if (state.hover >= 0 && network) drawHover(k);

  ctx.restore();

  if (overview) drawAxes(k);
  if (alluvial) {
    // 冲积图读的是 unified-decls.json，不是 science-atlas-data.json —— 那两个表头的
    // 数字来源也跟着换，否则会一直显示 0。
    const meta = alluvialView.getModel()?.meta;
    $('nodeCount').textContent = (meta?.declarations || 0).toLocaleString();
    $('edgeCount').textContent = (meta?.ribbons || 0).toLocaleString();
  } else if (atlas) {
    $('nodeCount').textContent = (state.scienceData?.meta?.clusterCount || 0).toLocaleString();
    $('edgeCount').textContent = (state.scienceData?.density?.length || 0).toLocaleString();
  } else if (ucsd) {
    $('nodeCount').textContent = (state.ucsdData?.meta?.nodeCount || 0).toLocaleString();
    $('edgeCount').textContent = (state.ucsdData?.meta?.edgeCount || 0).toLocaleString();
  } else if (coral || interdisc || mycelium || evolution) {
    // 每个新图各自报自己的两个数（表头标签在 switchMode 里已经换成对应的词）。
    // 走模块的 getCounts() 而不是读 JSON：模块已经在数它实际画出来的东西，这里再数一遍
    // 就是第二份会跟第一份分叉的账。数据缺失时 getCounts() 返回的全是 0。
    const counts = (coral ? coralView
      : interdisc ? interdiscView
        : mycelium ? myceliumView : evolutionView).getCounts() || {};
    if (coral) {
      // 珊瑚这两个数是 cluster 层的：簇数（数据的第三层）和 (簇, 概念) 对。
      $('nodeCount').textContent = (counts.clusterCount || 0).toLocaleString();
      $('edgeCount').textContent = (counts.conceptPairs || 0).toLocaleString();
    } else if (interdisc) {
      // 矩阵没有"边"，所以这两个数不是节点/边：是学科数，和**跨学科出现的术语数**
      // （出现在 ≥2 个学科里的术语）。表头标签在 switchMode 里已经换成对应的词。
      $('nodeCount').textContent = (counts.disciplineCount || 0).toLocaleString();
      $('edgeCount').textContent = (counts.bridgingTerms || 0).toLocaleString();
    } else if (mycelium) {
      // 菌丝图里这个数也不是"边"：是**微纤维**的总数，= Σ C(k,2) = 35,313。
      // 每一根 = 一个同时出现在两个学科里的术语。
      $('nodeCount').textContent = (counts.disciplineCount || 0).toLocaleString();
      $('edgeCount').textContent = (counts.fibreCount || 0).toLocaleString();
    } else {
      $('nodeCount').textContent = (counts.years || 0).toLocaleString();
      $('edgeCount').textContent = (counts.fields || 0).toLocaleString();
    }
  } else {
    $('nodeCount').textContent = state.data.meta.conceptCount.toLocaleString();
    $('edgeCount').textContent = state.data.meta.edgeCount.toLocaleString();
  }
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
  if (state.presentation.enabled) return; // GIF 录制：纯黑底，便于后期抠透明
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
    const r = ((14 + Math.sqrt(d.count) * 1.4) * (isFocus ? 1.15 : 1)) / k;
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

function drawHive(k) {
  const hive = state.hiveData || buildRuntimeHiveData();
  const axes = hive.axes.filter((axis) => dirVisible({ name: axis.subject }));
  if (!axes.length) return;
  const activeSubject = activeHiveSubject();
  const relatedSubjects = activeSubject ? hiveRelatedSubjects(activeSubject, hive) : new Set();

  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const innerR = 72;
  const outerR = 360;
  const labelR = 405;
  const positions = new Map();

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawHiveGrid(cx, cy, outerR, k);

  for (const axis of axes) {
    const angle = axis.angle;
    positions.set(axis.index, {
      angle,
      x1: cx + Math.cos(angle) * innerR,
      y1: cy + Math.sin(angle) * innerR,
      x2: cx + Math.cos(angle) * outerR,
      y2: cy + Math.sin(angle) * outerR,
      lx: cx + Math.cos(angle) * labelR,
      ly: cy + Math.sin(angle) * labelR,
      axis,
    });
  }

  drawHiveChords(hive.relations, positions, cx, cy, k, activeSubject);
  drawHiveAxes(axes, positions, k, activeSubject, relatedSubjects);
  drawHiveCenter(cx, cy, k);
  ctx.restore();
}

function buildRuntimeHiveData() {
  const axes = state.data.dirs.map((d, i) => ({
    subject: d.name,
    index: i,
    order: i,
    angle: -Math.PI / 2 + (Math.PI * 2 * i) / state.data.dirs.length,
    count: d.count,
    countNorm: 1,
    depthMin: 0,
    depthMax: 1,
    depthMean: 0.5,
    density: new Array(16).fill(0).map((_, bin) => ({
      bin,
      depth0: bin / 16,
      depth1: (bin + 1) / 16,
      count: 1,
      norm: 0.45,
    })),
  }));
  const relations = state.dirEdges.map((e) => ({
    sourceIndex: e.s,
    targetIndex: e.t,
    count: e.w,
    countNorm: 0.45,
    strengthNorm: 0.45,
  }));
  return { axes, relations };
}

function drawScienceAtlas(k) {
  const atlas = state.scienceData;
  if (!atlas) return drawScienceMissing(k);
  drawScienceVignette();
  drawScienceDensity(atlas, 'atlas', k);
  drawSciencePoints(atlas.atlasPoints || [], k, 'atlas');
  drawScienceLabels(atlas.labels || [], k, 'atlas');
  if (state.scienceHover) drawScienceHoverPoint(state.scienceHover, k);
}

function drawUcsdMap(k) {
  const map = state.ucsdData;
  if (!map) return drawScienceMissing(k);
  drawScienceVignette();
  drawUcsdEdges(map, k);
  drawUcsdNodes(map, k);
  drawUcsdLabels(map, k);
  drawUcsdLegend(map, k);
}

function drawUcsdEdges(map, k) {
  const nodes = map.nodes || [];
  const maxW = Math.max(1, ...(map.edges || []).map((e) => Number(e[2]) || 1));
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const e of map.edges || []) {
    const a = nodes[e[0]];
    const b = nodes[e[1]];
    if (!a || !b) continue;
    const f = Math.sqrt((Number(e[2]) || 1) / maxW);
    ctx.strokeStyle = `rgba(145,155,172,${0.018 + f * 0.08})`;
    ctx.lineWidth = (0.35 + f * 1.1) / k;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - 10 / k;
    ctx.quadraticCurveTo(mx, my, b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUcsdNodes(map, k) {
  const nodes = [...(map.nodes || [])].sort((a, b) => (a.size || 0) - (b.size || 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const n of nodes) {
    const rgb = hexToRgb(n.color || '#e5e7eb');
    const r = (1.4 + Math.max(1, Number(n.size || 4)) * 0.62) / k;
    ctx.fillStyle = `rgba(${rgb},0.62)`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, Math.max(1.2 / k, r), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawUcsdLabels(map, k) {
  const nodes = [...(map.nodes || [])]
    .sort((a, b) => Number(b.id === 3) - Number(a.id === 3) || (b.label.length < a.label.length ? -1 : 1))
    .slice(0, 210);
  const placed = [];
  ctx.save();
  ctx.textBaseline = 'middle';
  for (const n of nodes) {
    const label = cleanScienceLabel(n.label);
    const big = ['Data Mining', 'Material Science', 'Clinical Cancer Research', 'Organic Chemistry', 'Economics', 'Algebra'].includes(n.label);
    ctx.font = `${big ? 650 : 520} ${(big ? 10.8 : 8.6) / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    const w = ctx.measureText(label).width;
    const h = (big ? 13 : 10) / k;
    const x = n.x + 7 / k;
    const y = n.y - 3 / k;
    const box = { x, y: y - h / 2, w, h };
    if (!big && placed.some((b) => boxesOverlap(box, b))) continue;
    placed.push(box);
    ctx.fillStyle = big ? 'rgba(255,255,255,0.92)' : 'rgba(196,204,216,0.58)';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4 / k;
    ctx.fillText(label, x, y);
  }
  ctx.restore();
}

function drawUcsdLegend(map, k) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${10 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
  let y = 145;
  const x = WORLD_W - 330;
  for (const g of (map.groups || []).slice(0, 12)) {
    const rgb = hexToRgb(g.color || '#e5e7eb');
    ctx.fillStyle = `rgba(${rgb},0.82)`;
    ctx.beginPath();
    ctx.arc(x, y, 4.4 / k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(220,228,238,0.72)';
    ctx.fillText(`${g.name} (${g.count})`, x + 14 / k, y);
    y += 18 / k;
  }
  ctx.restore();
}

// Seven-layer Strata Flow. Geometry, hit testing, and legend live in alluvial-chart.js;
// this adapter only calls it under the shared world transform.
function drawScienceAlluvial(k) {
  if (!alluvialView.getModel()) return drawAlluvialMissing(k);
  drawScienceVignette();
  alluvialView.draw(ctx, WORLD_W, WORLD_H, k);
}

// Strata Flow reads unified-decls.json (state.data), not science-atlas-data.json.
function drawAlluvialMissing(k) {
  ctx.save();
  ctx.fillStyle = '#e6edf3';
  ctx.font = `${22 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('unified-decls.json not found', WORLD_W / 2, WORLD_H / 2);
  ctx.restore();
}

// 三个新图各自读一个数据文件，缺哪个就说哪个的名字 —— 泛泛一句 "data not found"
// 会让人挨个去试，而这三个文件是三个不同的构建脚本产出的。
function drawViewMissing(k, fileName) {
  ctx.save();
  ctx.fillStyle = '#e6edf3';
  ctx.font = `${22 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${fileName} not found`, WORLD_W / 2, WORLD_H / 2);
  ctx.font = `${12 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = 'rgba(139,148,158,0.85)';
  ctx.fillText('regenerate it with the build script in scripts/', WORLD_W / 2, WORLD_H / 2 + 30 / k);
  ctx.restore();
}

// 三个新图的适配器形状与 drawScienceAlluvial 完全一致：世界变换由 render() 建立，
// 这里只画自己的底纹再把世界尺寸和自己的 k 交给模块。几何、命中、图例全归模块。
function drawScienceCoral(k) {
  // 缺的是 coral-data.json（cluster 层）。sunburst-data.json 只用来借术语名 ——
  // 少了它珊瑚照样长出来，只是 describe 里报不出概念名。
  if (!coralView.getCounts()) return drawViewMissing(k, 'coral-data.json');
  drawScienceVignette();
  coralView.draw(ctx, WORLD_W, WORLD_H, k);
}

function drawScienceInterdisc(k) {
  // 缺的是 sunburst-data.json —— 矩阵是从它的 arcs 推出来的，interdisc-data.json 只是可选的校验源
  if (!interdiscView.getCounts()) return drawViewMissing(k, 'sunburst-data.json');
  drawScienceVignette();
  interdiscView.draw(ctx, WORLD_W, WORLD_H, k);
}

function drawScienceMycelium(k) {
  // 同上：菌丝图也是从 sunburst-data.json 的 arcs 现场推出来的，没有自己的数据文件
  if (!myceliumView.getCounts()) return drawViewMissing(k, 'sunburst-data.json');
  drawScienceVignette();
  myceliumView.draw(ctx, WORLD_W, WORLD_H, k);
}

// 地层剖面与已退役的河流图共用 openalex-history.json。
// getCounts() 无数据时返回 null —— 这里拿它当"数据在不在"的判据（不是拿 0 当）。
function drawScienceEvolution(k) {
  if (!evolutionView.getCounts()) return drawViewMissing(k, 'openalex-history.json');
  drawScienceVignette();
  evolutionView.draw(ctx, WORLD_W, WORLD_H, k);
}

function drawScienceMissing(k) {
  ctx.save();
  ctx.fillStyle = '#e6edf3';
  ctx.font = `${22 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('science-atlas-data.json not found', WORLD_W / 2, WORLD_H / 2);
  ctx.restore();
}

// All three science maps used to stamp their name and a one-line gloss here — "Atlas /
// research volume terrain", "UCSD / classic citation-based map of science", "Alluvial /
// every declaration, domain → dir → kind" — over the top-left of the figure. Removed at
// the user's request; the mode is already named by the highlighted toolbar button, so the
// stamp was restating the UI back at the reader. Only the radial glow is left.
function drawScienceVignette() {
  ctx.save();
  const g = ctx.createRadialGradient(WORLD_W * 0.52, WORLD_H * 0.48, 80, WORLD_W * 0.52, WORLD_H * 0.48, 680);
  g.addColorStop(0, 'rgba(70,86,105,0.12)');
  g.addColorStop(1, 'rgba(20,24,31,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.restore();
}

function drawScienceDensity(atlas, mode, k) {
  const meta = atlas.meta || {};
  const gridW = meta.gridWidth || 180;
  const gridH = meta.gridHeight || 100;
  const cw = WORLD_W / gridW;
  const ch = WORLD_H / gridH;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const cell of atlas.density || []) {
    const density = cell.densityNorm || 0;
    const growth = cell.growthNorm || 0;
    if (mode === 'frontier-bg' && growth < 0.18 && density < 0.18) continue;
    const color = scienceCategoryRgb(atlas, cell.topCategory);
    const alpha = mode === 'atlas'
      ? 0.035 + density * 0.34
      : 0.012 + density * 0.05 + growth * 0.12;
    ctx.fillStyle = `rgba(${color},${alpha})`;
    ctx.fillRect(cell.x * cw, cell.y * ch, cw + 0.8 / k, ch + 0.8 / k);
  }
  ctx.restore();
}

function drawFrontierCells(atlas, k) {
  const meta = atlas.meta || {};
  const gridW = meta.gridWidth || 180;
  const gridH = meta.gridHeight || 100;
  const cw = WORLD_W / gridW;
  const ch = WORLD_H / gridH;
  const cells = [...(atlas.density || [])]
    .filter((c) => (c.growthNorm || 0) > 0.36)
    .sort((a, b) => (b.growthNorm || 0) - (a.growthNorm || 0))
    .slice(0, 520);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const cell of cells) {
    const color = scienceCategoryRgb(atlas, cell.topCategory);
    const g = cell.growthNorm || 0;
    const x = cell.x * cw + cw / 2;
    const y = cell.y * ch + ch / 2;
    const r = (10 + 42 * g) / k;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${color},${0.20 + g * 0.34})`);
    grad.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSciencePoints(points, k, mode) {
  ctx.save();
  ctx.globalCompositeOperation = mode === 'frontier' ? 'lighter' : 'source-over';
  const sorted = [...points].sort((a, b) => a.articles - b.articles);
  for (const p of sorted) {
    const rgb = scienceCategoryRgb(state.scienceData, p.category);
    const size = Math.log1p(p.articles || 1);
    const r = mode === 'frontier'
      ? (0.9 + size * 0.33 + (p.growth || 0) * 0.012) / k
      : (0.42 + size * 0.22) / k;
    const alpha = mode === 'frontier'
      ? 0.10 + Math.min(0.55, (p.growth || 0) / 160)
      : 0.025 + Math.min(0.20, size / 60);
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 名字压在它所命名的那片密度区域的中轴上，而不是从锚点往右挂。
//
// 原来是 `x = p.x + 8/k` 的左对齐 —— textAlign 从没设过，靠画布默认的 start，
// 碰撞盒也是按左对齐写的。后果是整条名字的重量全落在锚点右侧：44 字 × 10.5px 就是
// 230–275 世界像素宽，字心在锚点右边 120 像素开外；最右的三条（anchor x 1390–1404）
// 冲出 1600 宽的世界框 43–79 像素，全靠 SCIENCE_ZOOM 留在视口里的那圈余量才没被画布
// 切掉。量出来的对照：名字横跨 x∈[192,1679]，而点云自己只占 [104,1508]（左右边距
// 104/92，本来就是居中的）—— 图看着右偏是名字造成的，不是数据。
//
// 锚点只是 UMAP 空间里的一个样本点；名字读起来是「给这片东西起的名字」，所以取锚点
// 周围 ATLAS_BLOB_R 世界像素内的密度格、按 densityNorm 加权求 x 的重心。半径 80 是
// 因为格宽 1600/180 = 8.89 世界像素，80 ≈ 9 格。实测 150 条候选：重心相对锚点中位只
// 挪 7px、最大 33px —— 修的是「整条重量偏右」，不是把名字搬离它命名的簇。
const ATLAS_BLOB_R = 80;
const atlasCentreCache = new WeakMap();

function atlasLabelCentre(atlas, p) {
  let m = atlasCentreCache.get(atlas);
  if (!m) { m = new Map(); atlasCentreCache.set(atlas, m); }
  let c = m.get(p);
  if (c !== undefined) return c;
  const meta = atlas?.meta || {};
  const gw = meta.gridWidth || 180, gh = meta.gridHeight || 100;
  const cw = WORLD_W / gw, chh = WORLD_H / gh;
  const r2 = ATLAS_BLOB_R * ATLAS_BLOB_R;
  let sum = 0, wx = 0;
  for (const cell of atlas?.density || []) {
    const x = (cell.x + 0.5) * cw, y = (cell.y + 0.5) * chh;
    const dx = x - p.x, dy = y - p.y;
    if (dx * dx + dy * dy > r2) continue;
    const w = cell.densityNorm || 0;
    sum += w; wx += w * x;
  }
  // 缓存按**数据对象**存，不按 labels 数组 —— 输入是 (density, p)，数据换了对象也就换了。
  c = sum > 0 ? wx / sum : p.x;
  m.set(p, c);
  return c;
}

function drawScienceLabels(labels, k, mode) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const placed = [];
  const maxLabels = mode === 'frontier' ? 90 : 150;
  const ranked = [...labels]
    .filter((p) => p.label)
    .sort((a, b) => ((b.articles || 0) + (b.growth || 0) * 35) - ((a.articles || 0) + (a.growth || 0) * 35))
    .slice(0, maxLabels);
  for (const p of ranked) {
    const label = cleanScienceLabel(p.label);
    if (!label) continue;
    const big = (p.articles || 0) > 1500 || (mode === 'frontier' && (p.growth || 0) > 92);
    const font = (big ? 12.5 : 10.5) / k;
    ctx.font = `${big ? 650 : 520} ${font}px "Segoe UI","Microsoft YaHei",sans-serif`;
    const w = ctx.measureText(label).width;
    const h = (big ? 15 : 12) / k;
    const y = p.y - 4 / k;
    const half = (w + 4 / k) / 2;
    // 再夹进世界框：字号是 1/k，所以 k 越小同一个名字在世界坐标里越宽，
    // 实测 k ≤ 0.7 起有两三条会顶出框。默认取景 k ≈ 0.74–0.92 时这一夹不生效。
    const x = Math.min(Math.max(atlasLabelCentre(state.scienceData, p), half), WORLD_W - half);
    const box = { x: x - half, y: y - h / 2, w: half * 2, h };
    if (placed.some((b) => boxesOverlap(box, b))) continue;
    placed.push(box);
    const rgb = scienceCategoryRgb(state.scienceData, p.category);
    ctx.fillStyle = mode === 'frontier' ? `rgba(${rgb},0.92)` : 'rgba(235,240,248,0.82)';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 5 / k;
    ctx.fillText(label, x, y);
  }
  ctx.restore();
}

function drawScienceHoverPoint(p, k) {
  ctx.save();
  const rgb = scienceCategoryRgb(state.scienceData, p.category);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(${rgb},0.95)`;
  ctx.lineWidth = 2 / k;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 16 / k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff';
  ctx.font = `${13 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(cleanScienceLabel(p.label || `Cluster ${p.id}`), p.x + 18 / k, p.y - 8 / k);
  ctx.restore();
}

// 只在 atlas / ucsd 下被调用：冲积图的命中在 alluvial-chart.js 里，走世界坐标但用的是
// 自己那套节点/丝带几何，不是这里的 atlasPoints 近邻查找。哲学模式同理，各走各的。
function pickSciencePoint(ev) {
  const atlas = state.scienceData;
  if (!atlas) return null;
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
  const { x, y, k } = state.transform;
  const wx = (sx - x) / k, wy = (sy - y) / k;
  const points = atlas.atlasPoints;
  const hitR = 18 / k;
  let best = null;
  let bestD = hitR * hitR;
  for (const p of points || []) {
    const dx = p.x - wx;
    const dy = p.y - wy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = p;
    }
  }
  return best;
}

function updateScienceHud() {
  const p = state.scienceHover;
  if (!p) {
    $('hoverInfo').textContent = '';
    $('hoverInfo').style.color = '';
    return;
  }
  const cat = scienceCategory(state.scienceData, p.category);
  $('hoverInfo').textContent = [
    cleanScienceLabel(p.label || `Cluster ${p.id}`),
    cat?.name || `Category ${p.category}`,
    `${Number(p.articles || 0).toLocaleString()} recent articles`,
    `growth ${Number(p.growth || 0).toFixed(1)}`,
  ].join(' · ');
  $('hoverInfo').style.color = cat?.color || '';
}

function scienceCategory(atlas, id) {
  return atlas?.categories?.find((c) => Number(c.id) === Number(id));
}

function scienceCategoryRgb(atlas, id) {
  const color = scienceCategory(atlas, id)?.color || '#e5e7eb';
  return hexToRgb(color);
}

function cleanScienceLabel(label) {
  return String(label || '')
    .replace(/\s+/g, ' ')
    .replace(/[_-]{3,}/g, ' ')
    .trim()
    .slice(0, 44);
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawHiveGrid(cx, cy, outerR, k) {
  ctx.save();
  ctx.strokeStyle = 'rgba(230,237,243,0.075)';
  ctx.lineWidth = 1 / k;
  for (let ring = 1; ring <= 5; ring++) {
    const r = (outerR * ring) / 5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHiveChords(relations, positions, cx, cy, k, activeSubject = '') {
  const visible = relations
    .filter((e) => positions.has(e.sourceIndex) && positions.has(e.targetIndex))
    .filter((e) => activeSubject
      ? e.source === activeSubject || e.target === activeSubject
      : e.visibleDefault)
    .sort((a, b) => (b.strengthNorm || 0) - (a.strengthNorm || 0))
    .slice(0, activeSubject ? 24 : 120);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const e of visible) {
    const a = positions.get(e.sourceIndex);
    const b = positions.get(e.targetIndex);
    if (!a || !b) continue;
    const countNorm = e.countNorm || 0;
    const strength = e.strengthNorm || 0;
    const f = Math.sqrt(countNorm);
    const r = 118 + 188 * Math.sqrt(strength || countNorm);
    const ax = cx + Math.cos(a.angle) * r;
    const ay = cy + Math.sin(a.angle) * r;
    const bx = cx + Math.cos(b.angle) * r;
    const by = cy + Math.sin(b.angle) * r;
    if (activeSubject) {
      const ca = state.dirColor.get(a.axis.subject);
      const cb = state.dirColor.get(b.axis.subject);
      const grad = ctx.createLinearGradient(ax, ay, bx, by);
      grad.addColorStop(0, `rgba(${ca.rgb},${0.28 + strength * 0.44})`);
      grad.addColorStop(1, `rgba(${cb.rgb},${0.28 + strength * 0.44})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = (1.1 + f * 4.8) / k;
    } else {
      ctx.strokeStyle = `rgba(160,170,190,${0.018 + strength * 0.13})`;
      ctx.lineWidth = (0.35 + f * 2.5) / k;
    }
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(cx, cy, cx, cy, bx, by);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHiveAxes(axes, positions, k, activeSubject = '', relatedSubjects = new Set()) {
  ctx.save();
  ctx.textBaseline = 'middle';
  const labels = [];
  for (const axis of axes) {
    const p = positions.get(axis.index);
    const info = state.dirColor.get(axis.subject);
    const weight = axis.countNorm || 0.5;
    const emphasis = hiveAxisEmphasis(axis.subject, activeSubject, relatedSubjects);

    drawHiveDensitySpine(p, axis, info, k, emphasis);
    labels.push({ p, axis, info, weight, emphasis });
  }
  drawHiveLabels(labels, k);
  ctx.restore();
}

function drawHiveDensitySpine(p, axis, info, k, emphasis = 1) {
  const dx = Math.cos(p.angle);
  const dy = Math.sin(p.angle);
  const px = -dy;
  const py = dx;

  ctx.strokeStyle = `rgba(${info.rgb},${0.04 + 0.09 * emphasis})`;
  ctx.lineWidth = (4 + 8 * (axis.countNorm || 0.5)) / k;
  ctx.beginPath();
  ctx.moveTo(p.x1, p.y1);
  ctx.lineTo(p.x2, p.y2);
  ctx.stroke();

  const bins = axis.density || [];
  for (const bin of bins) {
    const t = (bin.depth0 + bin.depth1) / 2;
    const x = p.x1 + (p.x2 - p.x1) * t;
    const y = p.y1 + (p.y2 - p.y1) * t;
    const density = bin.widthNorm ?? Math.sqrt(bin.localNorm ?? bin.norm ?? 0);
    if (density <= 0) continue;
    const len = (4 + 24 * density) / k;
    const core = (1.2 + 4.6 * density) / k;

    ctx.strokeStyle = `rgba(${info.rgb},${(0.06 + 0.17 * density) * emphasis})`;
    ctx.lineWidth = (core + 5 / k);
    ctx.beginPath();
    ctx.moveTo(x - px * len * 0.74, y - py * len * 0.74);
    ctx.lineTo(x + px * len * 0.74, y + py * len * 0.74);
    ctx.stroke();

    ctx.strokeStyle = `rgba(${info.rgb},${(0.18 + 0.56 * density) * emphasis})`;
    ctx.lineWidth = core;
    ctx.beginPath();
    ctx.moveTo(x - px * len, y - py * len);
    ctx.lineTo(x + px * len, y + py * len);
    ctx.stroke();
  }
}

function drawHiveLabels(labels, k) {
  const gap = 15 / k;
  const top = 74 / k;
  const bottom = WORLD_H - 70 / k;
  const left = labels.filter((l) => Math.cos(l.p.angle) < -0.08).sort((a, b) => a.p.ly - b.p.ly);
  const right = labels.filter((l) => Math.cos(l.p.angle) >= -0.08).sort((a, b) => a.p.ly - b.p.ly);
  placeHiveLabelSide(left, false, gap, top, bottom, k);
  placeHiveLabelSide(right, true, gap, top, bottom, k);
}

function placeHiveLabelSide(items, right, gap, top, bottom, k) {
  let y = top;
  for (const item of items) {
    item.labelY = Math.max(item.p.ly, y);
    y = item.labelY + gap;
  }
  const overflow = items.length ? items[items.length - 1].labelY - bottom : 0;
  if (overflow > 0) {
    for (const item of items) item.labelY -= overflow;
  }

  for (const { p, axis, info, weight, labelY, emphasis = 1 } of items) {
    const size = (9.2 + weight * 5.4) / k;
    const x = right ? WORLD_W - 270 / k : 270 / k;
    const textX = x + (right ? 8 / k : -8 / k);
    const anchorX = p.x2 + Math.cos(p.angle) * 18 / k;
    const anchorY = p.y2 + Math.sin(p.angle) * 18 / k;

    ctx.strokeStyle = `rgba(${info.rgb},${0.08 + 0.24 * emphasis})`;
    ctx.lineWidth = 0.9 / k;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.quadraticCurveTo((anchorX + x) / 2, labelY, x, labelY);
    ctx.stroke();

    ctx.font = `${emphasis > 0.95 ? 850 : 700} ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textAlign = right ? 'left' : 'right';
    ctx.lineWidth = 4 / k;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(axis.subject, textX, labelY);
    ctx.fillStyle = `rgba(${info.rgb},${(0.38 + weight * 0.42) * emphasis})`;
    ctx.fillText(axis.subject, textX, labelY);
  }
}

function activeHiveSubject() {
  return state.hiveLocked || state.hiveHover || '';
}

function hiveAxisEmphasis(subject, activeSubject, relatedSubjects) {
  if (!activeSubject) return 1;
  if (subject === activeSubject) return 1;
  if (relatedSubjects.has(subject)) return 0.8;
  return 0.2;
}

function hiveRelatedSubjects(subject, hive = state.hiveData) {
  const related = new Set();
  if (!hive) return related;
  const subjectInfo = hive.subjects?.find((s) => s.name === subject);
  for (const rel of subjectInfo?.strongestRelations || []) related.add(rel.subject);
  return related;
}

function pickHiveAxis(ev) {
  const hive = state.hiveData || buildRuntimeHiveData();
  if (!hive?.axes?.length) return null;
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;
  const { x, y, k } = state.transform;
  const wx = (sx - x) / k;
  const wy = (sy - y) / k;
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const dx = wx - cx;
  const dy = wy - cy;
  const r = Math.hypot(dx, dy);
  if (r < 58 || r > 460) return null;

  let best = null;
  let bestDist = 34 / k;
  for (const axis of hive.axes) {
    if (!dirVisible({ name: axis.subject })) continue;
    const ux = Math.cos(axis.angle);
    const uy = Math.sin(axis.angle);
    const along = dx * ux + dy * uy;
    if (along < 52 || along > 440) continue;
    const px = dx - ux * along;
    const py = dy - uy * along;
    const dist = Math.hypot(px, py);
    if (dist < bestDist) {
      bestDist = dist;
      best = axis;
    }
  }
  return best;
}

function updateHiveHud() {
  const subject = activeHiveSubject();
  if (!subject || !state.hiveData) {
    $('hoverInfo').textContent = '';
    $('hoverInfo').style.color = '';
    return;
  }
  const info = state.hiveData.subjects?.find((s) => s.name === subject);
  if (!info) return;
  const color = state.dirColor.get(subject);
  const axis = state.hiveData.axes?.find((a) => a.subject === subject);
  const strongest = (info.strongestRelations || [])
    .slice(0, 5)
    .map((r) => `${r.subject} ${Number(r.strengthNorm ?? r.strength).toFixed(2)}`)
    .join(' / ');
  if (state.hiveLocked === subject) {
    const bridges = (info.bridgeDeclarations || [])
      .slice(0, 4)
      .map((b) => b.label)
      .join(' / ');
    const types = (info.typeDistribution || [])
      .slice(0, 4)
      .map((t) => `${t.kind} ${Math.round(t.share * 100)}%`)
      .join(' / ');
    $('hoverInfo').textContent = [
      `${subject} [locked]`,
      `Nodes ${info.count.toLocaleString()} · Relations ${info.relationCount.toLocaleString()}`,
      `Depth ${Number(info.depthMin).toFixed(2)}-${Number(info.depthMax).toFixed(2)} · mean ${Number(info.depthMean).toFixed(2)}`,
      `Depth density ${hiveDepthSignature(axis)}`,
      `Cohesion ${Number(info.cohesion || 0).toFixed(2)} · Interdisciplinarity ${Number(info.interdisciplinarity || 0).toFixed(2)}`,
      strongest ? `Relations: ${strongest}` : '',
      bridges ? `Bridges: ${bridges}` : '',
      types ? `Types: ${types}` : '',
    ].filter(Boolean).join('\n');
  } else {
    $('hoverInfo').textContent = [
      subject,
      `${info.count.toLocaleString()} nodes`,
      `${info.relationCount.toLocaleString()} relations`,
      `depth ${Number(info.depthMin).toFixed(2)}-${Number(info.depthMax).toFixed(2)}`,
      `cohesion ${Number(info.cohesion || 0).toFixed(2)}`,
      `interdisciplinarity ${Number(info.interdisciplinarity || 0).toFixed(2)}`,
      strongest ? `strongest: ${strongest}` : '',
    ].filter(Boolean).join(' · ');
  }
  $('hoverInfo').style.color = color?.color || '';
}

function hiveDepthSignature(axis) {
  const bins = axis?.density || [];
  if (!bins.length) return '00000000';
  const buckets = Array(8).fill(0);
  for (const bin of bins) {
    const mid = (Number(bin.depth0) + Number(bin.depth1)) / 2;
    const idx = Math.max(0, Math.min(7, Math.floor(mid * 8)));
    buckets[idx] += Number(bin.count) || 0;
  }
  const max = Math.max(...buckets, 1);
  return buckets.map((v) => Math.round((v / max) * 9)).join('');
}

function drawHiveCenter(cx, cy, k) {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 10 / k, cx, cy, 86);
  g.addColorStop(0, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0.015)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 86, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,237,243,0.18)';
  ctx.lineWidth = 1.2 / k;
  ctx.stroke();
  ctx.fillStyle = 'rgba(230,237,243,0.86)';
  ctx.font = `${15 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Hive', cx, cy - 8 / k);
  ctx.fillStyle = 'rgba(139,148,158,0.9)';
  ctx.font = `${10 / k}px "Segoe UI",sans-serif`;
  ctx.fillText('subjects as axes', cx, cy + 12 / k);
  ctx.restore();
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
