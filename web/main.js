// main.js — 主线程：加载图数据、调度布局 worker、Canvas 渲染、缩放/平移、LOD 分级。
// 布局坐标由 layout-worker.js 计算（或从 localStorage 恢复），主线程只负责绘制。

import { zoom, zoomIdentity } from 'https://cdn.jsdelivr.net/npm/d3-zoom@3/+esm';
import { select } from 'https://cdn.jsdelivr.net/npm/d3-selection@3/+esm';

// ---- 常量 ----
const ZOOM_LOD = 0.5;          // 缩放阈值：k<0.5 学科聚合视图，k≥0.5 模块级视图
const LABEL_K = 7;             // 放大到该倍数后显示模块名
const NODE_R_SCREEN = 2.0;     // 模块节点屏幕半径（像素）
const EDGE_ALPHA = 0.16;
const EDGE_COLOR = '150,160,180';
const CULL_MARGIN = 60;        // 视口外扩裁切余量（世界单位）
const BRANCH_R = 26;           // 学科聚合节点屏幕半径（像素）

const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

// ---- 全局状态 ----
const state = {
  data: null,           // { nodes, edges, branchGraph }
  branchById: new Map(),// branchId -> {label,color,rgb}
  edgePairs: [],        // [[sIdx,tIdx], ...]
  adj: [],              // adj[i] = [{idx, edgeIndex}]
  pos: null,            // [Float32Array xs, Float32Array ys]
  transform: { x: 0, y: 0, k: 1 },
  hover: -1,            // hover 节点索引
  hiddenBranches: new Set(),
  layoutRunning: true,
  dpr: 1,
  edgeWeightMax: 1,
  branchGraph: { nodes: [], edges: [] },
  branchMembers: new Map(),
};

let layoutWorker = null;
let useWorker = true;

// ---- 初始化 ----
async function init() {
  resize();
  window.addEventListener('resize', resize);
  setupZoom();
  setupUI();

  try {
    const res = await fetch('graph.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.data = await res.json();
  } catch (err) {
    showToast('加载 graph.json 失败：' + err.message);
    return;
  }
  buildGraph();
  buildLegend();
  $('loadingText').textContent = '力导向布局计算中…';

  // 尝试从 localStorage 恢复上次布局坐标
  const cached = loadCachedPositions();
  if (cached) {
    applyPositions(cached.xs, cached.ys);
    state.layoutRunning = false;
    $('loading').classList.add('hidden');
    fitView(0);
    requestRender();
    showToast('已恢复上次布局缓存');
  } else {
    startLayout();
  }
  requestAnimationFrame(render);
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * state.dpr);
  canvas.height = Math.floor(innerHeight * state.dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  requestRender();
}

// ---- 数据整理 ----
function buildGraph() {
  const { nodes, edges, branchGraph } = state.data;
  const idxById = new Map();
  nodes.forEach((n, i) => idxById.set(n.id, i));

  // 学科配色表（来自 branchGraph 内嵌颜色，与提取脚本一致）
  for (const b of branchGraph.nodes) {
    const [r, g, bl] = b.color;
    state.branchById.set(b.id, {
      label: b.label,
      color: `rgb(${r},${g},${bl})`,
      rgb: `${r},${g},${bl}`,
    });
  }

  // 学科聚合节点：补上字符串颜色
  state.branchGraph.nodes = branchGraph.nodes.map((b) => {
    const [r, g, bl] = b.color;
    return { ...b, x: 0, y: 0, fill: `rgb(${r},${g},${bl})`, rgb: `${r},${g},${bl}` };
  });
  state.branchGraph.edges = branchGraph.edges;

  // 边 → 索引对
  state.edgePairs = edges.map((e) => [idxById.get(e.source), idxById.get(e.target)]);

  // 邻接表（hover 高亮用）
  state.adj = nodes.map(() => []);
  state.edgePairs.forEach(([s, t], ei) => {
    state.adj[s].push({ idx: t, edge: ei });
    state.adj[t].push({ idx: s, edge: ei });
  });

  // 学科边权重归一化
  if (state.branchGraph.edges.length) {
    state.edgeWeightMax = Math.max(...state.branchGraph.edges.map((e) => e.weight));
  }

  // 每学科成员索引
  state.branchMembers = new Map();
  nodes.forEach((n, i) => {
    if (!state.branchMembers.has(n.branch)) state.branchMembers.set(n.branch, []);
    state.branchMembers.get(n.branch).push(i);
  });
}

// 根据当前节点坐标计算各学科质心
function computeBranchPositions() {
  for (const b of state.branchGraph.nodes) {
    const members = state.branchMembers.get(b.id) || [];
    if (!members.length) continue;
    let sx = 0, sy = 0;
    for (const i of members) { sx += state.pos[0][i]; sy += state.pos[1][i]; }
    b.x = sx / members.length;
    b.y = sy / members.length;
  }
}

// ---- 布局调度（worker 优先，失败回退主线程）----
function startLayout() {
  $('loading').classList.remove('hidden');
  state.layoutRunning = true;
  const payload = {
    nodeCount: state.data.nodes.length,
    edges: state.edgePairs,
    alphaDecay: 0.02,
  };
  try {
    layoutWorker = new Worker(new URL('./layout-worker.js', import.meta.url), { type: 'module' });
  } catch {
    useWorker = false;
  }
  if (useWorker) {
    layoutWorker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'tick') {
        applyPositions(m.xs, m.ys);
        if (state.layoutRunning && !cachedFrame) { fitView(0); cachedFrame = true; }
        $('loading').classList.add('hidden');
        requestRender();
      } else if (m.type === 'end') {
        state.layoutRunning = false;
        saveCachedPositions();
      }
    };
    layoutWorker.onerror = () => {
      useWorker = false;
      layoutWorker?.terminate();
      mainThreadLayout(payload);
    };
    layoutWorker.postMessage({ type: 'start', ...payload });
  } else {
    mainThreadLayout(payload);
  }
}

let cachedFrame = false;

// 回退：主线程内跑 d3-force（降低帧率，避免卡死 UI）
async function mainThreadLayout(payload) {
  showToast('Web Worker 不可用，改用主线程布局（性能较低）');
  try {
    const d3f = await import('https://cdn.jsdelivr.net/npm/d3-force@3/+esm');
    const nodes = Array.from({ length: payload.nodeCount }, () => ({ index: 0 }));
    const links = payload.edges.map(([s, t]) => ({ source: s, target: t }));
    const sim = d3f.forceSimulation(nodes)
      .force('link', d3f.forceLink(links).id((d) => d.index).distance(24))
      .force('charge', d3f.forceManyBody().strength(-42))
      .force('collide', d3f.forceCollide().radius(1.5))
      .force('center', d3f.forceCenter(0, 0))
      .alphaDecay(0.02).alphaMin(0.001);
    const step = () => {
      for (let i = 0; i < 3; i++) sim.tick();
      const xs = new Float32Array(nodes.length);
      const ys = new Float32Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) { xs[i] = nodes[i].x ?? 0; ys[i] = nodes[i].y ?? 0; }
      applyPositions(xs, ys);
      if (!cachedFrame) { fitView(0); cachedFrame = true; }
      $('loading').classList.add('hidden');
      requestRender();
      if (sim.alpha() < 0.001) { state.layoutRunning = false; saveCachedPositions(); return; }
      setTimeout(step, 40);
    };
    step();
  } catch (err) {
    showToast('布局失败：' + err.message);
    $('loading').classList.add('hidden');
  }
}

function applyPositions(xs, ys) {
  state.pos = [xs, ys];
  computeBranchPositions();
}

// ---- 坐标缓存（localStorage）----
function CACHE_KEY() { return `mathlib-graph-pos-v1-${state.data?.nodes.length}`; }
function saveCachedPositions() {
  try {
    const xs = Array.from(state.pos[0], (v) => +v.toFixed(1));
    const ys = Array.from(state.pos[1], (v) => +v.toFixed(1));
    localStorage.setItem(CACHE_KEY(), JSON.stringify({ xs, ys, t: Date.now() }));
  } catch { /* localStorage 满/禁用时忽略 */ }
}
function loadCachedPositions() {
  try {
    const raw = localStorage.getItem(CACHE_KEY());
    if (!raw) return null;
    const { xs, ys } = JSON.parse(raw);
    if (!xs || !ys || xs.length !== state.data.nodes.length) return null;
    return { xs: new Float32Array(xs), ys: new Float32Array(ys) };
  } catch { return null; }
}

// ---- 缩放 / 平移 / 视图动画 ----
const zoomBehavior = zoom().scaleExtent([0.05, 60]).on('zoom', (ev) => {
  state.transform = ev.transform;
  requestRender();
});

function setupZoom() {
  const sel = select(canvas);
  sel.call(zoomBehavior);
  zoomBehavior.on('start', () => { canvas.style.cursor = 'grabbing'; });
  zoomBehavior.on('end', () => { canvas.style.cursor = 'grab'; });
}

let tweenRAF = 0;
// 手动 tween 相机（避免依赖 d3-transition 跨 bundle 的 prototype 补丁）
function animateTransformTo(target, dur = 600) {
  cancelAnimationFrame(tweenRAF);
  const s = { ...state.transform };
  const t0 = performance.now();
  const ease = (u) => 1 - Math.pow(1 - u, 3);
  const stepT = (now) => {
    const u = Math.min(1, (now - t0) / dur);
    const e = ease(u);
    state.transform = {
      x: s.x + (target.x - s.x) * e,
      y: s.y + (target.y - s.y) * e,
      k: s.k + (target.k - s.k) * e,
    };
    requestRender();
    if (u < 1) tweenRAF = requestAnimationFrame(stepT);
  };
  tweenRAF = requestAnimationFrame(stepT);
}

function fitView(dur = 500) {
  if (!state.pos) return;
  const xs = state.pos[0], ys = state.pos[1];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
  }
  const w = innerWidth, h = innerHeight, pad = 70;
  const k = Math.max(0.05, Math.min(
    Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY)),
    1.2
  ));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const target = zoomIdentity.translate(w / 2 - cx * k, h / 2 - cy * k).scale(k);
  animateTransformTo(target, dur);
}

// ---- UI 事件 ----
function setupUI() {
  $('btnFit').onclick = () => fitView();
  $('btnRelayout').onclick = () => { cachedFrame = false; startLayout(); };
  $('search').addEventListener('input', (e) => onSearch(e.target.value));
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', () => { state.hover = -1; requestRender(); });
}

function onSearch(q) {
  q = q.trim().toLowerCase();
  $('searchHint').textContent = '';
  if (!q) { state.hover = -1; requestRender(); return; }
  const nodes = state.data.nodes;
  let matches = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id.toLowerCase().includes(q)) {
      matches.push(i);
      if (matches.length >= 20) break;
    }
  }
  if (matches.length) {
    state.hover = matches[0];
    $('searchHint').textContent = `匹配 ${matches.length}+ 模块，自动跳到第一个`;
    flyToNode(matches[0]);
  } else {
    $('searchHint').textContent = '无匹配';
    state.hover = -1;
  }
  requestRender();
}

function flyToNode(idx) {
  if (!state.pos) return;
  const x = state.pos[0][idx], y = state.pos[1][idx];
  const w = innerWidth, h = innerHeight;
  const k = Math.max(state.transform.k, 2.2);
  const target = zoomIdentity.translate(w / 2 - x * k, h / 2 - y * k).scale(k);
  animateTransformTo(target, 600);
}

function onMouseMove(ev) {
  if (state.transform.k < ZOOM_LOD || !state.pos) { state.hover = -1; return; }
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
  const { x, y, k } = state.transform;
  const wx = (sx - x) / k, wy = (sy - y) / k;
  const hitR = 10 / k;
  let best = -1, bestD = hitR * hitR;
  const xs = state.pos[0], ys = state.pos[1];
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - wx, dy = ys[i] - wy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = i; }
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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);

  const { x, y, k } = state.transform;
  if (!state.pos) return;
  const vLeft = -x / k, vRight = (w - x) / k, vTop = -y / k, vBottom = (h - y) / k;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);

  const lodIsAggregate = k < ZOOM_LOD;
  $('lodLabel').textContent = lodIsAggregate ? '学科聚合视图' : '模块级视图';

  if (lodIsAggregate) {
    drawBranchGraph(vLeft, vRight, vTop, vBottom, k);
  } else {
    drawModuleGraph(vLeft, vRight, vTop, vBottom, k);
  }

  if (state.hover >= 0 && !lodIsAggregate) drawHover(k);
  ctx.restore();

  $('zoomK').textContent = k.toFixed(2) + '×';
}

function drawBranchGraph(vLeft, vRight, vTop, vBottom, k) {
  const g = state.branchGraph;
  // 学科间依赖边（方向从 source 到 target，用 source 色，透明度随权重）
  ctx.lineCap = 'round';
  for (const e of g.edges) {
    const a = g.nodes.find((n) => n.id === e.source);
    const b = g.nodes.find((n) => n.id === e.target);
    if (!a || !b) continue;
    const f = e.weight / state.edgeWeightMax;
    ctx.strokeStyle = `rgba(${a.rgb},${0.1 + 0.35 * f})`;
    ctx.lineWidth = Math.max(0.8, 1.8 * f) / k;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const r = BRANCH_R / k;
  for (const b of g.nodes) {
    if (state.hiddenBranches.has(b.id)) continue;
    if (b.x < vLeft - r || b.x > vRight + r || b.y < vTop - r || b.y > vBottom + r) continue;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fillStyle = b.fill + '40';
    ctx.fill();
    ctx.lineWidth = 2 / k;
    ctx.strokeStyle = b.fill;
    ctx.stroke();
    ctx.fillStyle = '#e6edf3';
    ctx.font = `${13 / k}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x, b.y);
    ctx.fillStyle = '#8b949e';
    ctx.font = `${10 / k}px "Segoe UI", sans-serif`;
    ctx.fillText(`${b.count} 模块`, b.x, b.y + r + 13 / k);
  }
  $('nodeCount').textContent = g.nodes.length;
  $('edgeCount').textContent = g.edges.length;
}

function drawModuleGraph(vLeft, vRight, vTop, vBottom, k) {
  const xs = state.pos[0], ys = state.pos[1];
  const m = CULL_MARGIN / k; // 世界单位外扩
  const sLeft = vLeft - m, sRight = vRight + m, sTop = vTop - m, sBot = vBottom + m;

  // 1) 边：单条 path 批量绘制，视口裁剪
  let visibleEdges = 0;
  ctx.beginPath();
  for (const [s, t] of state.edgePairs) {
    const x1 = xs[s], y1 = ys[s], x2 = xs[t], y2 = ys[t];
    if ((x1 < sLeft && x2 < sLeft) || (x1 > sRight && x2 > sRight) ||
        (y1 < sTop && y2 < sTop) || (y1 > sBot && y2 > sBot)) continue;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    visibleEdges++;
  }
  ctx.strokeStyle = `rgba(${EDGE_COLOR},${EDGE_ALPHA})`;
  ctx.lineWidth = 1 / k;
  ctx.stroke();

  // 2) 节点：按分支分组，每组一条 path
  const r = NODE_R_SCREEN / k;
  let visibleNodes = 0;
  for (const b of state.branchGraph.nodes) {
    if (state.hiddenBranches.has(b.id)) continue;
    const members = state.branchMembers.get(b.id) || [];
    ctx.beginPath();
    for (const i of members) {
      const px = xs[i], py = ys[i];
      if (px < sLeft || px > sRight || py < sTop || py > sBot) continue;
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
      visibleNodes++;
    }
    ctx.fillStyle = b.fill;
    ctx.fill();
  }

  // 3) 深度放大后显示模块短名
  if (k >= LABEL_K) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `${11 / k}px "Segoe UI", sans-serif`;
    for (const b of state.branchGraph.nodes) {
      const members = state.branchMembers.get(b.id) || [];
      for (const i of members) {
        const px = xs[i], py = ys[i];
        if (px < vLeft || px > vRight || py < vTop || py > vBottom) continue;
        ctx.fillStyle = 'rgba(230,237,243,0.85)';
        ctx.fillText(state.data.nodes[i].id.split('.').slice(-1)[0], px + r * 1.6, py);
      }
    }
  }

  $('nodeCount').textContent = visibleNodes;
  $('edgeCount').textContent = visibleEdges;
}

function drawHover(k) {
  const i = state.hover;
  const x = state.pos[0][i], y = state.pos[1][i];
  const branch = state.data.nodes[i].branch;
  const info = state.branchById.get(branch);
  const color = info?.color || '#fff';
  // 相连边高亮
  ctx.beginPath();
  for (const { idx: n } of state.adj[i]) {
    ctx.moveTo(x, y);
    ctx.lineTo(state.pos[0][n], state.pos[1][n]);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.2 / k;
  ctx.stroke();
  // 节点描边
  const r = NODE_R_SCREEN * 1.9 / k;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.6 / k;
  ctx.stroke();
  // 信息条
  const id = state.data.nodes[i].id;
  const label = info?.label || branch;
  $('hoverInfo').textContent = `${id} · ${label} · ${state.adj[i].length} 条依赖`;
  $('hoverInfo').style.color = color;
}

// ---- 图例 ----
function buildLegend() {
  const el = $('legend');
  el.innerHTML = '<div style="font-weight:600;margin-bottom:4px;color:var(--muted);">学科图例（点击开关）</div>';
  for (const b of state.branchGraph.nodes) {
    const row = document.createElement('div');
    row.className = 'item row';
    row.innerHTML = `<span><span class="sw" style="background:${b.fill}"></span>${b.label}</span><span class="cnt">${b.count}</span>`;
    row.onclick = () => {
      if (state.hiddenBranches.has(b.id)) state.hiddenBranches.delete(b.id);
      else state.hiddenBranches.add(b.id);
      row.classList.toggle('off', state.hiddenBranches.has(b.id));
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
