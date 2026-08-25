// main.js — 数学概念「科研地图」渲染器。
// 数据来自 concepts.json（确定性布局已内嵌 x/y，无需力导向）。
//   X 轴 = 历史时间（早→晚 从左到右）
//   Y 轴 = 三层抽象（上层=具体/离散代数，中层=基础骨架，下层=抽象/连续）
// 一张 16:9 的世界坐标（1600×900）绘制，滚轮缩放、拖拽平移、悬停看概念。

import { zoom, zoomIdentity } from 'https://cdn.jsdelivr.net/npm/d3-zoom@3/+esm';
import { select } from 'https://cdn.jsdelivr.net/npm/d3-selection@3/+esm';

// ---- 常量 ----
const LABEL_K = 1.6;           // 放大到该倍数显示概念名
const NODE_R_SCREEN = 3.0;     // 概念节点基准屏幕半径
const EDGE_ALPHA = 0.18;
const EDGE_COLOR = '150,160,180';
const CULL_MARGIN = 80;
const WORLD_W = 1600;
const WORLD_H = 900;
const TIER_LABELS = ['具体 / 离散代数', '基础通用骨架', '抽象 / 连续'];

const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  branchColor: new Map(),  // branch -> {label, color, rgb, hsl}
  idxByDecl: new Map(),
  edgePairs: [],           // [[sIdx,tIdx], ...]
  adj: [],
  degrees: [],
  maxDegree: 1,
  transform: { x: 0, y: 0, k: 1 },
  hover: -1,
  hiddenBranches: new Set(),
  dpr: 1,
  branchMembers: new Map(),
};

// ---- 初始化 ----
async function init() {
  resize();
  window.addEventListener('resize', resize);
  setupZoom();
  setupUI();

  try {
    const res = await fetch('concepts.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.data = await res.json();
  } catch (err) {
    showToast('加载 concepts.json 失败：' + err.message);
    return;
  }
  buildGraph();
  buildLegend();
  setTitle();
  $('loading').classList.add('hidden');
  fitView(0);
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

function setTitle() {
  const m = state.data.meta;
  const tl = m.tierLabels;
  $('title').innerHTML =
    `<h1>🧮 数学概念历史地图</h1>` +
    `<p>${m.conceptCount} 个概念 · ${m.edgeCount} 条依赖 · ${m.branchCount} 学科</p>` +
    `<p>横轴=历史年代 · 纵轴=抽象层级 · 滚轮缩放 · 拖拽平移 · 悬停看概念</p>`;
}

// ---- 数据整理 ----
function buildGraph() {
  const { nodes, edges } = state.data;

  const branches = [...new Set(nodes.map((n) => n.branch))];
  branches.forEach((b, i) => {
    const h = Math.round((i * 137.5) % 360); // 黄金角配色
    state.branchColor.set(b, { label: b, color: `hsl(${h},72%,58%)`, rgb: hslToRgb(h) });
  });

  nodes.forEach((n) => state.idxByDecl.set(n.decl, n.id));

  state.edgePairs = edges
    .map((e) => [state.idxByDecl.get(e.source), state.idxByDecl.get(e.target)])
    .filter(([s, t]) => s != null && t != null);

  state.adj = nodes.map(() => []);
  state.edgePairs.forEach(([s, t]) => {
    state.adj[s].push({ idx: t });
    state.adj[t].push({ idx: s });
  });
  state.degrees = state.adj.map((a) => a.length);
  state.maxDegree = Math.max(1, ...state.degrees);

  state.branchMembers = new Map();
  nodes.forEach((n) => {
    if (!state.branchMembers.has(n.branch)) state.branchMembers.set(n.branch, []);
    state.branchMembers.get(n.branch).push(n.id);
  });
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

// ---- 缩放/平移 ----
const zoomBehavior = zoom().scaleExtent([0.2, 30]).on('zoom', (ev) => {
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
function animateTransformTo(target, dur = 600) {
  cancelAnimationFrame(tweenRAF);
  const s = { ...state.transform };
  const t0 = performance.now();
  const ease = (u) => 1 - Math.pow(1 - u, 3);
  const stepT = (now) => {
    const u = Math.min(1, (now - t0) / dur);
    const e = ease(u);
    state.transform = { x: s.x + (target.x - s.x) * e, y: s.y + (target.y - s.y) * e, k: s.k + (target.k - s.k) * e };
    requestRender();
    if (u < 1) tweenRAF = requestAnimationFrame(stepT);
  };
  tweenRAF = requestAnimationFrame(stepT);
}

function fitView(dur = 500) {
  const k = Math.min((innerWidth - 80) / WORLD_W, (innerHeight - 60) / WORLD_H);
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  animateTransformTo(zoomIdentity.translate(innerWidth / 2 - cx * k, innerHeight / 2 - cy * k).scale(k), dur);
}

// ---- UI ----
function setupUI() {
  $('btnFit').onclick = () => fitView();
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
    if (nodes[i].label.toLowerCase().includes(q) || nodes[i].decl.toLowerCase().includes(q)) {
      matches.push(i);
      if (matches.length >= 20) break;
    }
  }
  if (matches.length) {
    state.hover = matches[0];
    $('searchHint').textContent = `匹配 ${matches.length}+ 个概念，跳到第一个`;
    flyToNode(matches[0]);
  } else { $('searchHint').textContent = '无匹配'; state.hover = -1; }
  requestRender();
}

function flyToNode(idx) {
  const n = state.data.nodes[idx];
  const k = Math.max(state.transform.k, 3.0);
  animateTransformTo(zoomIdentity.translate(innerWidth / 2 - n.x * k, innerHeight / 2 - n.y * k).scale(k), 600);
}

function onMouseMove(ev) {
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
  const { x, y, k } = state.transform;
  const wx = (sx - x) / k, wy = (sy - y) / k;
  const hitR = 12 / k;
  let best = -1, bestD = hitR * hitR;
  const nodes = state.data.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const dx = nodes[i].x - wx, dy = nodes[i].y - wy, d2 = dx * dx + dy * dy;
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
  if (!state.data) return;

  const { x, y, k } = state.transform;
  const vLeft = -x / k, vRight = (w - x) / k, vTop = -y / k, vBottom = (h - y) / k;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);

  drawTierBands();
  drawEdges(vLeft, vRight, vTop, vBottom);
  drawNodes(vLeft, vRight, vTop, vBottom, k);
  if (state.hover >= 0) drawHover(k);

  ctx.restore();

  drawAxes(k);
  $('zoomK').textContent = k.toFixed(2) + '×';
  $('nodeCount').textContent = state.data.meta.conceptCount;
  $('edgeCount').textContent = state.data.meta.edgeCount;
}

// 三层抽象背景带 + 分隔线
function drawTierBands() {
  const tiers = state.data.tiers;
  const fills = ['rgba(255,200,90,0.05)', 'rgba(130,180,255,0.05)', 'rgba(255,110,160,0.05)'];
  const halfH = 150;
  tiers.forEach((t, i) => {
    ctx.fillStyle = fills[i];
    ctx.fillRect(0, t.y - halfH, WORLD_W, halfH * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, t.y + halfH);
    ctx.lineTo(WORLD_W, t.y + halfH);
    ctx.stroke();
  });
}

// 依赖边（只画可见范围内的）
function drawEdges(vLeft, vRight, vTop, vBottom, k) {
  const nodes = state.data.nodes;
  const m = CULL_MARGIN / k;
  const sLeft = vLeft - m, sRight = vRight + m, sTop = vTop - m, sBot = vBottom + m;
  ctx.beginPath();
  for (const [s, t] of state.edgePairs) {
    if (state.hiddenBranches.has(nodes[s].branch) && state.hiddenBranches.has(nodes[t].branch)) continue;
    const x1 = nodes[s].x, y1 = nodes[s].y, x2 = nodes[t].x, y2 = nodes[t].y;
    if ((x1 < sLeft && x2 < sLeft) || (x1 > sRight && x2 > sRight) || (y1 < sTop && y2 < sTop) || (y1 > sBot && y2 > sBot)) continue;
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  }
  ctx.strokeStyle = `rgba(${EDGE_COLOR},${EDGE_ALPHA})`;
  ctx.lineWidth = 1 / k;
  ctx.stroke();
}

// 概念节点（按学科着色，大小 ∝ 关联度）
function drawNodes(vLeft, vRight, vTop, vBottom, k) {
  const nodes = state.data.nodes;
  const m = CULL_MARGIN / k;
  const sLeft = vLeft - m, sRight = vRight + m, sTop = vTop - m, sBot = vBottom + m;
  const baseR = NODE_R_SCREEN / k;
  const sqrtMax = Math.sqrt(state.maxDegree);

  for (const [branch, members] of state.branchMembers) {
    if (state.hiddenBranches.has(branch)) continue;
    const info = state.branchColor.get(branch);
    ctx.beginPath();
    for (const i of members) {
      const n = nodes[i];
      if (n.x < sLeft || n.x > sRight || n.y < sTop || n.y > sBot) continue;
      const r = baseR * (0.5 + 1.8 * Math.sqrt(state.degrees[i]) / sqrtMax);
      ctx.moveTo(n.x + r, n.y);
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = info.color;
    ctx.fill();
  }

  // 概念名标签
  if (k >= LABEL_K) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `${11 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    for (const [branch, members] of state.branchMembers) {
      if (state.hiddenBranches.has(branch)) continue;
      for (const i of members) {
        const n = nodes[i];
        if (n.x < vLeft || n.x > vRight || n.y < vTop || n.y > vBottom) continue;
        ctx.fillStyle = 'rgba(230,237,243,0.82)';
        ctx.fillText(n.label.replace(/\$/g, ''), n.x + baseR * 1.8, n.y);
      }
    }
  }
}

// 坐标轴标注（历史时间轴 + 三层抽象轴）
function drawAxes(k) {
  const m = state.data.meta;
  const s = 1 / k; // 轴文字随世界缩放而放大（保持世界坐标下固定字号）

  ctx.save();
  ctx.translate(state.transform.x, state.transform.y);
  ctx.scale(state.transform.k, state.transform.k);

  const left = m.world.plot.left, right = m.world.plot.right;
  const top = m.world.plot.top, bottom = m.world.plot.bottom;

  // X 轴（历史时间）
  const axisY = bottom + 30;
  ctx.strokeStyle = 'rgba(230,237,243,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(left, axisY); ctx.lineTo(right, axisY); ctx.stroke();
  ctx.fillStyle = '#e6edf3';
  ctx.font = '14px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('历史时间 →（定理出现年代）', (left + right) / 2, axisY + 10);
  // 两端年代标注
  ctx.fillStyle = '#8b949e';
  ctx.font = '12px "Segoe UI",sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${m.eraMin} 年`, left, axisY + 10);
  ctx.textAlign = 'right';
  ctx.fillText(`${m.eraMax} 年`, right, axisY + 10);

  // Y 轴（三层抽象）
  const axisX = left - 24;
  ctx.fillStyle = '#e6edf3';
  ctx.font = '13px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const tiers = state.data.tiers;
  tiers.forEach((t) => {
    ctx.save();
    ctx.translate(axisX, t.y);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(TIER_LABELS[t.id], 0, 0);
    ctx.restore();
  });

  ctx.restore();
}

function drawHover(k) {
  const i = state.hover;
  const n = state.data.nodes[i];
  const info = state.branchColor.get(n.branch);
  ctx.beginPath();
  for (const { idx: t } of state.adj[i]) {
    ctx.moveTo(n.x, n.y);
    ctx.lineTo(state.data.nodes[t].x, state.data.nodes[t].y);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.2 / k;
  ctx.stroke();
  const r = (NODE_R_SCREEN / k) * (0.5 + 1.8 * Math.sqrt(state.degrees[i]) / Math.sqrt(state.maxDegree)) * 1.4;
  ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8 / k; ctx.stroke();
  const tierName = TIER_LABELS[n.tier];
  $('hoverInfo').textContent = `${n.label.replace(/\$/g, '')} · ${n.decl} · ${n.branch} · ${n.era} 年`;
  $('hoverInfo').style.color = info.color;
  $('lodLabel').textContent = tierName;
}

// ---- 图例 ----
function buildLegend() {
  const el = $('legend');
  el.innerHTML = '<div style="font-weight:600;margin-bottom:4px;color:var(--muted);">学科图例（点击开关）</div>';
  const sorted = [...state.branchColor.entries()].sort((a, b) => state.branchMembers.get(b[0]).length - state.branchMembers.get(a[0]).length);
  for (const [branch, info] of sorted) {
    const row = document.createElement('div');
    row.className = 'item row';
    const count = state.branchMembers.get(branch).length;
    row.innerHTML = `<span><span class="sw" style="background:${info.color}"></span>${branch}</span><span class="cnt">${count}</span>`;
    row.onclick = () => {
      if (state.hiddenBranches.has(branch)) state.hiddenBranches.delete(branch);
      else state.hiddenBranches.add(branch);
      row.classList.toggle('off', state.hiddenBranches.has(branch));
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
