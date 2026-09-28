// alluvial-chart.js — seven-layer Strata Flow for the unified declaration map.
// Keeps the old module contract used by main.js, but changes the picture from a
// three-column chart into a denser hierarchy:
// domainGroup -> subject -> source -> module family -> submodule -> kind -> declaration cluster.

const NODE_W = 13;
const PAD_L = 118;
const PAD_R = 132;
const PAD_T = 138;
const PAD_B = 92;
const NODE_GAP = 3.2;
const HIT_MIN_H = 3.2;
const HIT_PAD = 4;
const RIBBON_ALPHA = 0.34;
const HL_ALPHA = 0.82;
const DIM_ALPHA = 0.035;
const LABEL_FONT = 11;

const LEVELS = [
  { key: 'domainGroup', label: 'domain group', limit: 14 },
  { key: 'subject', label: 'subject', limit: 34 },
  { key: 'sourcePackage', label: 'source', limit: 12 },
  { key: 'family', label: 'module family', limit: 42 },
  { key: 'submodule', label: 'submodule', limit: 54 },
  { key: 'kind', label: 'object type', limit: 18 },
  { key: 'cluster', label: 'declaration cluster', limit: 64 },
];

const PALETTE = [
  '#ffff00', '#22ff55', '#1e90ff', '#ff1744', '#26fff4', '#ff8a00',
  '#c74cff', '#00d6a0', '#7b28ff', '#f8ff45', '#ff5ec4', '#78ffbd',
  '#4cc9ff', '#ffcf5a', '#a3ff12', '#ff6b6b', '#8ea0ff', '#d6f2ff',
];

const SUBJECT_GROUPS = [
  ['Logic', 'Foundations', 'Order', 'SetTheory'],
  ['Data', 'Computability', 'Languages', 'Algorithms', 'Crypto'],
  ['Algebra', 'GroupTheory', 'RingTheory', 'LinearAlgebra', 'NumberTheory'],
  ['Geometry', 'Topology', 'AlgebraicGeometry', 'AlgebraicTopology', 'CategoryTheory'],
  ['Analysis', 'MeasureTheory', 'Probability', 'Dynamics'],
  ['Physics', 'QuantumInfo', 'Relativity', 'QFT', 'FieldTheory', 'FluidDynamics', 'Thermodynamics'],
  ['AD', 'Numerics', 'Optimization', 'MachineLearning', 'SciLean'],
];

export function buildAlluvial(data, hidden) {
  const n = data && data.nodes;
  if (!n || !n.label || !n.kind) return null;
  const N = n.label.length;
  const skip = hidden instanceof Set ? hidden : new Set(hidden || []);
  const rows = [];

  for (let i = 0; i < N; i++) {
    const subject = clean(n.subject?.[i] || n.dir?.[i] || n.domain?.[i] || 'Unknown');
    if (skip.has(subject)) continue;
    const module = clean(n.module?.[i] || subject);
    const parts = module.split('.').filter(Boolean);
    const repo = clean(n.sourcePackage?.[i] || n.sourceRepo?.[i] || n.domain?.[i] || 'Library');
    const kind = clean(n.kind?.[i] || 'declaration');
    const label = clean(n.label?.[i] || '');
    const family = parts.length >= 2 ? parts.slice(0, Math.min(2, parts.length)).join('.') : subject;
    const submodule = parts.length >= 3 ? parts.slice(0, Math.min(4, parts.length)).join('.') : family;
    rows.push({
      domainGroup: domainGroup(subject, module, repo),
      subject,
      sourcePackage: repo,
      family,
      submodule,
      kind,
      cluster: clusterName(label, module, kind),
    });
  }
  if (!rows.length) return null;

  const keepers = new Map();
  for (const lv of LEVELS) keepers.set(lv.key, topValues(rows, lv.key, lv.limit));

  const counts = LEVELS.map(() => new Map());
  const pairCounts = LEVELS.slice(0, -1).map(() => new Map());
  const ownerColor = new Map();
  const allSubjects = new Map();

  for (const row of rows) {
    const vals = LEVELS.map((lv) => {
      const raw = row[lv.key] || 'Unknown';
      return keepers.get(lv.key).has(raw) ? raw : 'Other ' + lv.label;
    });
    const subject = vals[1] || row.subject;
    allSubjects.set(subject, (allSubjects.get(subject) || 0) + 1);
    for (let c = 0; c < vals.length; c++) {
      counts[c].set(vals[c], (counts[c].get(vals[c]) || 0) + 1);
      if (!ownerColor.has(c + '\u0001' + vals[c])) ownerColor.set(c + '\u0001' + vals[c], subject);
    }
    for (let c = 0; c < vals.length - 1; c++) {
      const key = vals[c] + '\u0001' + vals[c + 1];
      const prev = pairCounts[c].get(key) || { w: 0, subject };
      prev.w++;
      pairCounts[c].set(key, prev);
    }
  }

  const subjects = [...allSubjects.keys()].sort((a, b) => allSubjects.get(b) - allSubjects.get(a) || a.localeCompare(b));
  const subjectIndex = new Map(subjects.map((s, i) => [s, i]));
  const cols = counts.map((m, c) => [...m.entries()]
    .map(([name, weight]) => ({ name, weight, col: c, subject: ownerColor.get(c + '\u0001' + name) || name }))
    .sort((a, b) => {
      const ag = groupRank(a.subject), bg = groupRank(b.subject);
      return (ag - bg) || ((subjectIndex.get(a.subject) ?? 999) - (subjectIndex.get(b.subject) ?? 999))
        || (b.weight - a.weight) || a.name.localeCompare(b.name);
    }));

  const links = [];
  for (let stage = 0; stage < pairCounts.length; stage++) {
    for (const [key, rec] of pairCounts[stage]) {
      const cut = key.indexOf('\u0001');
      links.push({ stage, a: key.slice(0, cut), b: key.slice(cut + 1), w: rec.w, subject: rec.subject });
    }
  }
  links.sort((a, b) => (a.stage - b.stage) || (a.w - b.w));

  return {
    cols,
    links,
    subjects,
    total: rows.length,
    filtered: skip.size > 0,
    meta: {
      declarations: rows.length,
      dataset: N,
      ribbons: links.length,
      levels: LEVELS.length,
      subjects: cols[1]?.length || 0,
      clusters: cols[6]?.length || 0,
    },
  };
}

export function createAlluvialView(opts) {
  const onChange = (opts && opts.onChange) || (() => {});
  let data = null, model = null, geo = null;
  let hidden = new Set(), order = [], hover = null, pinned = null;

  function setData(d) {
    data = d;
    hidden = new Set();
    hover = null;
    pinned = null;
    model = buildAlluvial(data, hidden);
    order = model ? model.subjects : [];
    geo = null;
  }
  function rebuild() { model = buildAlluvial(data, hidden); geo = null; }
  function getData() { return data; }
  function getModel() { return model; }
  function domains() { return order; }
  function isHidden(d) { return hidden.has(d); }
  function toggleDomain(d) { hidden.has(d) ? hidden.delete(d) : hidden.add(d); rebuild(); }
  function clearHidden() { hidden = new Set(); rebuild(); }
  function colorOf(subject) {
    const i = order.indexOf(subject);
    if (i >= 0) return PALETTE[i % PALETTE.length];
    return PALETTE[Math.abs(hash(subject)) % PALETTE.length];
  }

  function layout(w, h) {
    const sig = w + 'x' + h + '|' + [...hidden].sort().join(',');
    if (geo && geo.sig === sig) return geo;
    if (!model) return null;

    const cols = model.cols.map((list, c) => list.map((src) => ({
      ...src, col: c, x0: 0, x1: 0, y0: 0, y1: 0, h: 0, mid: 0, out: [], in: [],
    })));
    const at = cols.map((list) => new Map(list.map((nd) => [nd.name, nd])));
    const maxNodes = Math.max(...cols.map((c) => c.length));
    const total = cols[0].reduce((a, nd) => a + nd.weight, 0) || 1;
    const box = Math.max(80, h - PAD_T - PAD_B);
    const scale = Math.max(1e-9, (box - NODE_GAP * Math.max(0, maxNodes - 1)) / total);
    const colX = cols.map((_, c) => PAD_L + c * ((w - PAD_L - PAD_R - NODE_W) / Math.max(1, cols.length - 1)));

    for (let c = 0; c < cols.length; c++) {
      const used = cols[c].reduce((a, nd) => a + nd.weight * scale, 0) + NODE_GAP * Math.max(0, cols[c].length - 1);
      let y = PAD_T + Math.max(0, (box - used) / 2);
      for (const nd of cols[c]) {
        nd.x0 = colX[c]; nd.x1 = colX[c] + NODE_W;
        nd.y0 = y; nd.h = nd.weight * scale; nd.y1 = y + nd.h; nd.mid = y + nd.h / 2;
        y = nd.y1 + NODE_GAP;
      }
    }

    const links = [];
    for (const l of model.links) {
      const A = at[l.stage].get(l.a);
      const B = at[l.stage + 1].get(l.b);
      if (!A || !B) continue;
      const link = { ...l, A, B, th: l.w * scale };
      A.out.push(link); B.in.push(link); links.push(link);
    }
    for (const nd of cols.flat()) {
      nd.out.sort((p, q) => p.B.mid - q.B.mid || q.w - p.w);
      nd.in.sort((p, q) => p.A.mid - q.A.mid || q.w - p.w);
      let y = nd.y0;
      for (const l of nd.out) { l.sy = y; y += l.th; }
      y = nd.y0;
      for (const l of nd.in) { l.ty = y; y += l.th; }
    }
    for (const l of links) {
      const x0 = l.A.x1, x1 = l.B.x0;
      const c0 = x0 + (x1 - x0) * 0.46, c1 = x1 - (x1 - x0) * 0.46;
      const p = new Path2D();
      p.moveTo(x0, l.sy);
      p.bezierCurveTo(c0, l.sy, c1, l.ty, x1, l.ty);
      p.lineTo(x1, l.ty + l.th);
      p.bezierCurveTo(c1, l.ty + l.th, c0, l.sy + l.th, x0, l.sy + l.th);
      p.closePath();
      l.path = p;
    }
    geo = { sig, w, h, cols, links, colX, scale };
    return geo;
  }

  function draw(ctx, w, h, k) {
    k = k || 1;
    if (!model) return drawMissing(ctx, w, h, k);
    const g = layout(w, h);
    if (!g) return;
    const focus = hover || pinned;
    const touches = focus ? endpointsOf(focus) : null;
    const litNodes = new Set();
    if (touches) {
      for (const l of touches) {
        litNodes.add(l.A.col + '\u0001' + l.A.name);
        litNodes.add(l.B.col + '\u0001' + l.B.name);
      }
      if (focus.type === 'node') litNodes.add(focus.col + '\u0001' + focus.name);
    }
    const isLit = (nd) => !touches || litNodes.has(nd.col + '\u0001' + nd.name);

    ctx.save();
    const links = g.links.slice().sort((a, b) => (touches?.has(a) ? 1 : 0) - (touches?.has(b) ? 1 : 0));
    for (const l of links) {
      ctx.globalAlpha = touches ? (touches.has(l) ? HL_ALPHA : DIM_ALPHA) : RIBBON_ALPHA;
      ctx.fillStyle = colorOf(l.subject);
      ctx.fill(l.path);
    }
    ctx.restore();

    for (const col of g.cols) {
      for (const nd of col) {
        const alpha = isLit(nd) ? 1 : 0.18;
        ctx.globalAlpha = alpha;
        const grad = ctx.createLinearGradient(nd.x0, nd.y0, nd.x1, nd.y1);
        grad.addColorStop(0, colorOf(nd.subject));
        grad.addColorStop(1, 'rgba(210,225,255,0.72)');
        ctx.fillStyle = grad;
        ctx.fillRect(nd.x0, nd.y0, NODE_W, Math.max(0.9, nd.h));
      }
    }
    ctx.globalAlpha = 1;

    if (focus && focus.type === 'node') {
      const nd = g.cols[focus.col]?.find((x) => x.name === focus.name);
      if (nd) {
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 1.8 / k;
        ctx.strokeRect(nd.x0 - 1.5, nd.y0 - 1.5, NODE_W + 3, Math.max(nd.h, 1) + 3);
      }
    } else if (focus && focus.type === 'col') {
      // 整层高亮：把这一列自上而下框起来。落点用**首末节点的实际位置**，不是列的中轴 ——
      // 每列在自己那段高度里是居中的，用一个固定框会和两头对不上。
      const col = g.cols[focus.col] || [];
      if (col.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 1.8 / k;
        const y0 = col[0].y0, y1 = col[col.length - 1].y1;
        ctx.strokeRect(col[0].x0 - 3, y0 - 3, NODE_W + 6, (y1 - y0) + 6);
      }
    }
    drawLabels(ctx, g, focus, k, isLit);
    drawColumnHeaders(ctx, g, k);
  }

  function drawLabels(ctx, g, focus, k, isLit) {
    const items = [];
    for (const col of g.cols) {
      for (const nd of col) {
        // 整层高亮时这一列的标签全部强制显示 —— 亮点整层却不给名字，等于没亮。
        const forced = !!focus && (focus.type === 'col'
          ? focus.col === nd.col
          : focus.type === 'node' && focus.col === nd.col && focus.name === nd.name);
        const minH = nd.col <= 1 ? 5 : nd.col <= 3 ? 9 : 13;
        if (nd.h < minH && !forced) continue;
        if (items.length > 185 && !forced) continue;
        const side = nd.col === 0 ? 'left' : nd.col === g.cols.length - 1 ? 'right' : 'center';
        items.push({ nd, text: short(nd.name, nd.col <= 1 ? 24 : 20), y: nd.mid, ay: nd.mid, side, x0: 0, w: 0, forced });
      }
    }
    ctx.save();
    ctx.font = `650 ${LABEL_FONT / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textBaseline = 'middle';
    for (const it of items) {
      it.w = ctx.measureText(it.text).width + 10 / k;
      if (it.side === 'left') it.x0 = it.nd.x0 - 10 / k - it.w;
      else if (it.side === 'right') it.x0 = it.nd.x1 + 10 / k;
      else it.x0 = it.nd.x1 + 6 / k;
    }
    repelLabels(items, g.w, g.h, k);
    for (const it of items) {
      const nd = it.nd;
      const active = isLit(nd) || it.forced;
      ctx.globalAlpha = active ? 1 : 0.27;
      const x = it.side === 'left' ? it.x0 + it.w : it.x0;
      ctx.textAlign = it.side === 'left' ? 'right' : 'left';
      if (Math.abs(it.y - it.ay) > 1.8) {
        ctx.strokeStyle = rgba(colorOf(nd.subject), 0.55);
        ctx.lineWidth = 0.9 / k;
        ctx.beginPath();
        ctx.moveTo(it.side === 'left' ? nd.x0 : nd.x1, it.ay);
        ctx.lineTo(x, it.y);
        ctx.stroke();
      }
      ctx.lineWidth = 3.2 / k;
      ctx.strokeStyle = '#000';
      ctx.strokeText(it.text, x, it.y);
      ctx.fillStyle = it.forced ? '#fff' : '#dfe8f7';
      ctx.fillText(it.text, x, it.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawColumnHeaders(ctx, g, k) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `700 ${10.5 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    for (let c = 0; c < LEVELS.length; c++) {
      ctx.fillStyle = 'rgba(175,188,208,0.75)';
      ctx.fillText(LEVELS[c].label, g.colX[c] + NODE_W / 2, PAD_T - 5 / k);
    }
    ctx.restore();
  }

  function pick(wx, wy) {
    if (!geo) return null;
    for (const col of geo.cols) {
      for (const nd of col) {
        const half = Math.max(nd.h / 2, HIT_MIN_H);
        if (wx >= nd.x0 - HIT_PAD && wx <= nd.x1 + HIT_PAD && wy >= nd.mid - half && wy <= nd.mid + half) {
          return { type: 'node', col: nd.col, name: nd.name };
        }
      }
    }
    for (const l of geo.links) {
      if (wx < l.A.x1 || wx > l.B.x0) continue;
      const u = (wx - l.A.x1) / Math.max(1e-6, l.B.x0 - l.A.x1);
      const top = cubic(l.sy, l.ty, u);
      if (wy >= top && wy <= top + Math.max(l.th, HIT_MIN_H)) {
        return { type: 'link', id: linkId(l), stage: l.stage, a: l.A.name, b: l.B.name, w: l.w, subject: l.subject };
      }
    }
    return null;
  }

  function endpointsOf(f) {
    const out = new Set();
    if (!geo) return out;
    if (f.type === 'col') {
      // 整层：进出这一列的弦 = 上一段（stage = col-1）+ 下一段（stage = col）。
      for (const l of geo.links) if (l.stage === f.col || l.stage === f.col - 1) out.add(l);
    } else if (f.type === 'node') {
      for (const l of geo.links) {
        if ((l.A.col === f.col && l.A.name === f.name) || (l.B.col === f.col && l.B.name === f.name)) out.add(l);
      }
    } else {
      for (const l of geo.links) if (linkId(l) === f.id) out.add(l);
    }
    return out;
  }
  function linkId(l) { return `${l.stage}\u0001${l.A.name}\u0001${l.B.name}`; }
  function setHover(h) { hover = h; }
  function getHover() { return hover; }
  function getPinned() { return pinned; }
  function togglePinned(p) { pinned = sameTarget(p, pinned) ? null : p; return pinned; }
  function sameTarget(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'col') return a.col === b.col;
    return a.type === 'node' ? a.col === b.col && a.name === b.name : a.id === b.id;
  }

  function describe(f) {
    if (!f || !geo || !model) return '';
    const pct = (x) => `${(100 * x / model.meta.dataset).toFixed(x / model.meta.dataset < 0.001 ? 3 : 1)}%`;
    if (f.type === 'node') {
      const nd = geo.cols[f.col]?.find((x) => x.name === f.name);
      if (!nd) return '';
      const links = geo.links.filter((l) => l.A === nd || l.B === nd).sort((a, b) => b.w - a.w).slice(0, 7);
      return `${nd.name}  ·  ${LEVELS[f.col].label}\n`
        + `${nd.weight.toLocaleString()} declarations · ${pct(nd.weight)} of all\n`
        + links.map((l) => l.A === nd ? `→ ${l.B.name} ${l.w.toLocaleString()}` : `${l.A.name} → ${l.w.toLocaleString()}`).join(', ');
    }
    if (f.type === 'col') {
      // 一层里的节点重量和 == 全体声明数（每篇声明在每层恰好落一个节点），
      // 所以这里不报 pct —— 报出来必然 100%，是句废话。
      const list = model.cols[f.col] || [];
      return `${LEVELS[f.col].label}  ·  ${list.length} nodes\n`
        + `${model.meta.dataset.toLocaleString()} declarations pass through this layer\n`
        + list.slice(0, 8).map((nd) => `${nd.name} ${nd.weight.toLocaleString()}`).join(', ');
    }
    return `${f.a}  →  ${f.b}\n${f.w.toLocaleString()} declarations · ${pct(f.w)} of all`;
  }

  // GIF 的帧序：先逐层亮整层，再在这一层内部自上而下逐个亮节点。
  // 层内顺序取 model.cols[c] —— 那就是 layout() 排出来的纵向顺序，所以走一遍正好是
  // 图上从上到下读下来，不会跳。
  function framePlan() {
    const out = [];
    if (!model) return out;
    for (let c = 0; c < model.cols.length; c++) {
      out.push({ type: 'col', col: c });
      for (const nd of model.cols[c]) out.push({ type: 'node', col: c, name: nd.name });
    }
    return out;
  }

  function renderLegend(el) {
    if (!model) { el.innerHTML = ''; return; }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const m = model.meta;
    let html = '<div style="font-weight:700;margin-bottom:3px;color:var(--fg);">Strata Flow</div>'
      + '<div style="color:var(--muted);font-size:10.5px;margin-bottom:6px;line-height:1.4;">'
      + `${m.levels} layers · ${m.declarations.toLocaleString()} declarations · `
      + `${m.ribbons.toLocaleString()} ribbons. Click a subject to hide/show.</div>`;
    for (const s of order.slice(0, 28)) {
      const off = hidden.has(s);
      const node = model.cols[1].find((x) => x.name === s);
      const w = node ? node.weight : 0;
      html += `<div class="item row${off ? ' off' : ''}" data-dom="${esc(s)}">`
        + `<span><span class="sw" style="background:${colorOf(s)}"></span>${esc(short(s, 20))}</span>`
        + `<span class="cnt">${w.toLocaleString()}</span></div>`;
    }
    html += '<div style="color:var(--muted);font-size:10.5px;margin-top:6px;line-height:1.45;">'
      + 'Hierarchy: domain group → subject → source → module family → submodule → object type → declaration cluster.</div>';
    el.innerHTML = html;
    el.querySelectorAll('[data-dom]').forEach((row) => {
      row.onclick = () => { toggleDomain(row.dataset.dom); renderLegend(el); onChange(); };
    });
  }

  return {
    setData, getData, getModel, draw, pick, describe, renderLegend, framePlan,
    setHover, getHover, togglePinned, getPinned, sameTarget,
    domains, colorOf, isHidden, toggleDomain, clearHidden,
    get layout() { return geo; },
    get links() { return geo ? geo.links : []; },
    get nodes() { return geo ? geo.cols : []; },
  };
}

function clean(v) { return String(v || '').trim() || 'Unknown'; }
function topValues(rows, key, limit) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return new Set([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k]) => k));
}
function clusterName(label, module, kind) {
  const parts = module.split('.').filter(Boolean);
  const leaf = parts.slice(-2).join('.');
  const fallback = label.split(/[.:]/).filter(Boolean).slice(-2).join('.');
  return (kind + ': ' + (leaf || fallback || 'cluster')).slice(0, 46);
}
function domainGroup(subject, module, repo) {
  const s = (subject + ' ' + module + ' ' + repo).toLowerCase();
  if (/logic|foundation|settheory|order|type|category/.test(s)) return 'Structures';
  if (/compute|language|algorithm|crypto|data|machine/.test(s)) return 'Computation';
  if (/probab|measure|stat/.test(s)) return 'Probability';
  if (/analysis|dynamics|numerics|optimization|ad|scilean/.test(s)) return 'Dynamics';
  if (/geometry|topology|space|relativity/.test(s)) return 'Geometry';
  if (/phys|quantum|field|fluid|matter|thermo|qft|electromag/.test(s)) return 'Matter';
  if (/info|entropy|signal/.test(s)) return 'Information';
  return 'Structures';
}
function groupRank(subject) {
  for (let i = 0; i < SUBJECT_GROUPS.length; i++) if (SUBJECT_GROUPS[i].includes(subject)) return i;
  return 99;
}
function repelLabels(items, w, h, k) {
  for (let pass = 0; pass < 24; pass++) {
    items.sort((a, b) => a.y - b.y);
    let moved = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (!(a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w)) continue;
        const gap = b.y - a.y;
        const need = 14 / k;
        if (gap >= need) continue;
        const push = (need - gap) / 2;
        a.y -= push; b.y += push; moved = Math.max(moved, push);
      }
    }
    if (moved < 0.02) break;
  }
  for (const it of items) {
    it.y = Math.max(PAD_T - 16 / k, Math.min(h - 12 / k, it.y));
    it.x0 = Math.max(5 / k, Math.min(w - it.w - 5 / k, it.x0));
  }
}
function cubic(a, b, u) {
  const s = 1 - u;
  return a * (s * s * (s + 3 * u)) + b * (u * u * (3 * s + u));
}
function short(name, n = 18) { return name.length > n ? name.slice(0, n - 1) + '…' : name; }
function hash(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = ((h << 5) - h + String(s).charCodeAt(i)) | 0;
  return h;
}
function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function drawMissing(ctx, w, h, k) {
  ctx.save();
  ctx.fillStyle = 'rgba(139,148,158,0.9)';
  ctx.font = `${13 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('unified-decls.json not loaded — Strata Flow needs the declaration dataset', w / 2, h / 2);
  ctx.restore();
}
