// evolution-river.js — 学科演化河流图：1827–2024 年，每个学科的份额。
//
// 读 web/openalex-history.json（scripts/fetch-openalex-history.mjs 抓的 OpenAlex 快照）。
//
// ---------------------------------------------------------------- 为什么不是 map_of_science
//
// 用户最初指定的数据源是 map_of_science，但那份数据的 data.tsv 与 basic_data.jsonl
// **没有时间字段、也没有引用关系**（本地与上游字段逐字段比对过）。所以「学科随时间的兴衰」
// 在那里根本做不出来 —— 不是不好画，是没有那个数。换成 OpenAlex 逐年
// primary_topic.field.id 计数，1827–2024 共 198 年。
//
// ---------------------------------------------------------------- 河高恒定 = 占比河流
//
// Y 轴是**份额**，每年归一到 100%，所以河高恒定、永远不会「涨」。这是用户选的口径，
// 它换来的是：任意一年的横截面都能直接读出学科结构。代价是**绝对体量看不见了** ——
// 1827 年 6,870 篇和 2024 年 10,872,134 篇在图上一样高。绝对数在悬停里，图例也写明。
//
// ---------------------------------------------------------------- Unclassified 必须单独一条
//
// 2024 年 10,872,134 篇里 **913,394 篇（8.4%）没有 primary_topic**，所以没有 field。
// 把它并进 Other 会让「Other 18 fields」这条带的厚度不再对应任何真实学科集合。
// 它单独一条灰带，且在栈顶（它是残差，不是学科）。
//
// ---------------------------------------------------------------- 诚实边界
//
// 这份数据只支持**诞生和兴衰**。不支持分裂与合流：OpenAlex 的 field 分类法不随时间变，
// 而且每篇 work 只有**一个** primary_topic，所以不存在「一个学科裂成两个」或「两个并成
// 一个」这种可观测事件。要近似「分裂」得下到 subfield 层（约 250 个），那是后续工作。
//
// 2025/2026 不画：这两年 OpenAlex 的未分类率跳到 24.4% 和 70.3%（索引与分类滞后，
// 不是科学事实的变化）。原始数字仍在 JSON 里，`meta.excludedYears` 记着原因。

const PAD_T = 132;
const PAD_B = 60;
const PAD_L = 96;
const PAD_R = 214;
const AXIS_H = 18;

const LABEL_MIN_H = 13;      // 带太薄就不标名字，交给图例
const FONT_LABEL = 11.5;
const FONT_AXIS = 10.5;

// 8 个真实学科按 2024 份额降序依次取 CATEGORICAL_8_DARK 的槽位 1..8。
// 这个次序本身就是 CVD 安全机制（见 science-categories.mjs 的注释），不要重排。
const CATEGORICAL_8_DARK = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767',
];
const AGGREGATE = { other: '#5b5b57', unclassified: '#383835', rule: 'rgba(255,255,255,0.10)' };

const BG = '#1a1a19';

function shadeColor(hex, amount) {
  const raw = String(hex || '#888888').replace('#', '');
  const n = Number.parseInt(raw.length === 3
    ? raw.split('').map((c) => c + c).join('')
    : raw, 16);
  if (!Number.isFinite(n)) return hex;
  const mix = amount >= 0 ? 255 : 0;
  const f = Math.abs(amount);
  const r = Math.round(((n >> 16) & 255) * (1 - f) + mix * f);
  const g = Math.round(((n >> 8) & 255) * (1 - f) + mix * f);
  const b = Math.round((n & 255) * (1 - f) + mix * f);
  return `rgb(${r},${g},${b})`;
}

function addSmoothLine(path, x0, step, values, forward = true) {
  const n = values.length;
  if (!n) return;
  if (forward) {
    path.moveTo(x0, values[0]);
    for (let t = 1; t < n; t++) {
      const px = x0 + (t - 1) * step;
      const x = x0 + t * step;
      const mx = (px + x) / 2;
      path.bezierCurveTo(mx, values[t - 1], mx, values[t], x, values[t]);
    }
  } else {
    path.lineTo(x0 + (n - 1) * step, values[n - 1]);
    for (let t = n - 2; t >= 0; t--) {
      const px = x0 + (t + 1) * step;
      const x = x0 + t * step;
      const mx = (px + x) / 2;
      path.bezierCurveTo(mx, values[t + 1], mx, values[t], x, values[t]);
    }
  }
}

// OpenAlex 的 field 名太长，右端放不下。全名在图例和悬停里都给。
const SHORT_NAMES = {
  'https://openalex.org/fields/27': 'Medicine',
  'https://openalex.org/fields/33': 'Social Sciences',
  'https://openalex.org/fields/22': 'Engineering',
  'https://openalex.org/fields/17': 'Computer Science',
  'https://openalex.org/fields/23': 'Environmental Sci.',
  'https://openalex.org/fields/12': 'Arts & Humanities',
  'https://openalex.org/fields/13': 'Biochem. & Mol. Bio.',
  'https://openalex.org/fields/11': 'Agricultural & Bio. Sci.',
};

export function createRiverView(opts) {
  const onChange = (opts && opts.onChange) || (() => {});

  let data = null;
  let meta = null;
  let hover = null;
  let pinned = null;
  let expanded = false;
  let geo = null;

  function setData(d) {
    data = d || null;
    meta = (d && d.meta) || null;
    hover = null;
    pinned = null;
    expanded = false;
    geo = null;
  }
  function getData() { return data; }
  function isExpanded() { return expanded; }

  const shortName = (f) => SHORT_NAMES[f.id]
    || (f.name.length > 26 ? f.name.slice(0, 25) + '…' : f.name);

  // ------------------------------------------------------------------ layout
  function layout(w, h) {
    const sig = `${w}x${h}x${expanded ? 1 : 0}`;
    if (geo && geo.sig === sig) return geo;
    if (!data || !data.years) { geo = null; return null; }

    const T0 = data.years.indexOf(meta.riverFirstYear);
    const T1 = data.years.indexOf(meta.riverLastYear);
    if (T0 < 0 || T1 < T0) { geo = null; return null; }
    const T = T1 - T0 + 1;
    const years = data.years.slice(T0, T1 + 1);

    const x0 = PAD_L;
    const x1 = Math.max(x0 + 100, w - PAD_R);
    const yTop = PAD_T;
    const yBottom = h - PAD_B;
    const H = yBottom - yTop;
    const step = T > 1 ? (x1 - x0) / (T - 1) : 0;

    const totals = new Float64Array(T);
    for (let t = 0; t < T; t++) totals[t] = data.totalByYear[T0 + t];

    const top8 = meta.top8 || [];
    const byId = new Map(data.fields.map((f) => [f.id, f]));
    const rest = data.fields.filter((f) => !top8.includes(f.id));

    // 从下往上的栈序：8 个学科（份额降序）→ Other → Unclassified（残差在最上）。
    // 栈序**固定**，不随年份变 —— 变一下这些带就会互相穿插，河就散了。
    const bands = [];
    top8.forEach((id, i) => {
      const f = byId.get(id);
      if (!f) return;
      bands.push({
        key: id, name: f.name, short: shortName(f), kind: 'field', slot: i,
        color: CATEGORICAL_8_DARK[i],
        values: Float64Array.from({ length: T }, (_, t) => f.byYear[T0 + t] || 0),
      });
    });

    const otherValues = new Float64Array(T);
    for (const f of rest) for (let t = 0; t < T; t++) otherValues[t] += f.byYear[T0 + t] || 0;

    if (!expanded) {
      bands.push({ key: '__other__', name: `Other (${rest.length} fields)`, short: `Other (${rest.length})`,
                   kind: 'other', color: AGGREGATE.other, values: otherValues, rest });
    } else {
      // 展开：18 条灰带，按名字排序（固定次序），整体占住原来 Other 的那一段。
      // 不给 18 个颜色 —— 没有 18 个能通过 CVD 全对门的色相，硬凑只会让相邻两条看不出区别。
      // 它们本来就是「其余」，靠悬停和图例识别，灰 + 分隔线是诚实的选择。
      const sorted = rest.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      // 这 18 条**取代**那条 Other，不是加在它旁边。再放一条 Other 会让那一段被数两遍：
      // 栈高会翻倍，而河高仍然对得上 —— 从图上只看到「Other 忽然变成两倍厚」。
      for (const f of sorted) {
        bands.push({
          key: f.id, name: f.name, short: shortName(f), kind: 'other-field', group: '__other__',
          color: AGGREGATE.other,
          values: Float64Array.from({ length: T }, (_, t) => f.byYear[T0 + t] || 0),
        });
      }
    }

    bands.push({ key: '__unclassified__', name: 'Unclassified', short: 'Unclassified',
                 kind: 'unclassified', color: AGGREGATE.unclassified,
                 values: Float64Array.from({ length: T }, (_, t) => data.unclassifiedByYear[T0 + t] || 0) });

    // 每个带每年的上下边界。栈从 yBottom 往上堆；份额之和恒为 1，所以最上面那条的顶
    // 一定落在 yTop —— 这是本图唯一的几何不变量，测试直接从发出的 Path2D 顶点量。
    for (const b of bands) {
      b.top = new Float64Array(T);
      b.bot = new Float64Array(T);
    }
    for (let t = 0; t < T; t++) {
      const total = totals[t] || 1;
      let acc = yBottom;
      for (const b of bands) {
        const share = b.values[t] / total;
        b.bot[t] = acc;
        acc -= share * H;
        b.top[t] = acc;
      }
    }

    geo = { sig, w, h, T, years, t0: T0, t1: T1, totals, bands,
            x0, x1, step, yTop, yBottom, H, yOf: (year) => x0 + (year - years[0]) * step };
    return geo;
  }

  // --------------------------------------------------------------------- draw
  function draw(ctx, w, h, k) {
    k = k || 1;
    if (!data) {
      ctx.save();
      ctx.fillStyle = 'rgba(139,148,158,0.9)';
      ctx.font = `${13 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('openalex-history.json not loaded — run scripts/fetch-openalex-history.mjs',
                   w / 2, h / 2);
      ctx.restore();
      return;
    }
    const g = layout(w, h);
    if (!g) return;
    const focus = hover || pinned;
    // 悬停展开后的某一条灰带时，把整个 Other 组一起点亮 —— 否则读者看不出这 18 条
    // 是同一个聚合拆出来的。
    const lit = (b) => !focus || focus.key === b.key
      || focus.key === '__other__'
      || (focus.group === '__other__' && b.kind === 'other-field');

    // 1. 带。按栈序从下往上画，先画的被压在下面；边相邻，不重叠。
    for (const b of g.bands) {
      const p = new Path2D();
      addSmoothLine(p, g.x0, g.step, b.top, true);
      addSmoothLine(p, g.x0, g.step, b.bot, false);
      p.closePath();
      b.path = p;

      ctx.globalAlpha = lit(b) ? (b.kind === 'unclassified' ? 0.95 : 1) : 0.18;
      if (b.kind === 'field') {
        const grad = ctx.createLinearGradient(g.x0, 0, g.x1, 0);
        grad.addColorStop(0, shadeColor(b.color, -0.18));
        grad.addColorStop(0.62, b.color);
        grad.addColorStop(1, shadeColor(b.color, 0.22));
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = b.color;
      }
      ctx.fill(p);
    }
    ctx.globalAlpha = 1;

    // 2. 带之间画细白线。相邻两条同色（展开后的 18 条灰带）时，不画线就分不开。
    ctx.save();
    ctx.strokeStyle = AGGREGATE.rule;
    ctx.lineWidth = 1 / k;
    for (const b of g.bands) {
      ctx.beginPath();
      addSmoothLine(ctx, g.x0, g.step, b.top, true);
      ctx.stroke();
    }
    ctx.restore();

    drawAxis(ctx, g, k);
    drawBandLabels(ctx, g, focus, k);

    // 3. 悬停的那一列高亮
    if (focus && g.years.includes(focus.year)) {
      const t = g.years.indexOf(focus.year);
      const x = g.x0 + t * g.step;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.moveTo(x, g.yTop);
      ctx.lineTo(x, g.yBottom);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAxis(ctx, g, k) {
    ctx.save();
    ctx.font = `${FONT_AXIS / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = 'rgba(150,162,180,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const y = g.yBottom + AXIS_H / k;
    for (let year = Math.ceil(g.years[0] / 25) * 25; year <= g.years[g.years.length - 1]; year += 25) {
      const x = g.yOf(year);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.moveTo(x, g.yTop);
      ctx.lineTo(x, g.yBottom);
      ctx.stroke();
      ctx.fillText(String(year), x, y);
    }
    ctx.restore();
  }

  // 每条带在右端直接标注。身份不能只靠颜色 —— 8 个色相里有两对在 CVD 下接近，
  // 而且河里同一条带在 198 年里一直很薄，颜色是唯一线索的话就太脆了。
  function drawBandLabels(ctx, g, focus, k) {
    const last = g.T - 1;
    ctx.save();
    ctx.font = `600 ${FONT_LABEL / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const x = g.x1 + 10 / k;

    const items = [];
    for (const b of g.bands) {
      if (!b.short) continue;
      const hgt = b.bot[last] - b.top[last];
      if (hgt < LABEL_MIN_H) continue;
      items.push({ b, want: (b.top[last] + b.bot[last]) / 2, hgt });
    }
    // 圆整排斥，避免两个名字叠在一起（与其它图同一套做法）
    for (let pass = 0; pass < 80; pass++) {
      items.sort((p, q) => p.want - q.want);
      let worst = 0;
      for (let i = 0; i < items.length - 1; i++) {
        const a = items[i], c = items[i + 1];
        const need = (FONT_LABEL + 2.5) / k;
        const gap = c.want - a.want;
        if (gap >= need) continue;
        const push = (need - gap) / 2;
        a.want -= push; c.want += push;
        worst = Math.max(worst, push);
      }
      if (worst < 0.01) break;
    }

    const focus2 = focus || pinned;
    for (const it of items) {
      const b = it.b;
      const on = !focus2 || focus2.key === b.key || focus2.group === b.key;
      ctx.globalAlpha = on ? 1 : 0.25;
      if (Math.abs(it.want - (b.top[last] + b.bot[last]) / 2) > 0.6) {
        ctx.strokeStyle = 'rgba(180,190,205,0.45)';
        ctx.lineWidth = 1 / k;
        ctx.beginPath();
        ctx.moveTo(g.x1 + 2 / k, (b.top[last] + b.bot[last]) / 2);
        ctx.lineTo(x - 2 / k, it.want);
        ctx.stroke();
      }
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = BG;
      ctx.strokeText(b.short, x, it.want);
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(b.short, x, it.want);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------------------- pick
  function pick(wx, wy) {
    if (!geo) return null;
    const g = geo;
    if (wx < g.x0 - g.step || wx > g.x1 + g.step) return null;
    const t = Math.max(0, Math.min(g.T - 1, Math.round((wx - g.x0) / (g.step || 1))));
    const year = g.years[t];
    if (wy < g.yTop - 12 || wy > g.yBottom + 12) return null;

    for (const b of g.bands) {
      if (wy >= b.top[t] && wy <= b.bot[t]) {
        const count = b.values[t];
        const total = g.totals[t];
        return {
          type: 'band', key: b.key, group: b.kind === 'other-field' ? '__other__' : null,
          name: b.name, short: b.short, kind: b.kind, year, t,
          count, total, share: total ? count / total : 0,
        };
      }
    }
    return { type: 'year', key: '__year__', name: `Year ${year}`, year, t,
             total: g.totals[t], count: g.totals[t], share: 1 };
  }

  function setHover(x) { hover = x; }
  function getHover() { return hover; }
  function getPinned() { return pinned; }
  function togglePinned(p) { pinned = sameTarget(p, pinned) ? null : p; return pinned; }
  function sameTarget(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'band') return a.key === b.key && a.year === b.year;
    return a.year === b.year;
  }

  // ---------------------------------------------------------------------- HUD
  function describe(f) {
    if (!f || !geo || !meta) return '';
    const pct = (v) => (v * 100).toFixed(2) + '%';
    if (f.type === 'year') {
      const t = f.t;
      const ranked = geo.bands
        .filter((b) => b.kind !== 'other-group')
        .map((b) => ({ b, v: b.values[t] }))
        .sort((p, q) => q.v - p.v)
        .slice(0, 3)
        .map((x) => `${x.b.short || x.b.name} ${pct(x.v / (geo.totals[t] || 1))}`)
        .join(', ');
      const unc = geo.bands.find((b) => b.kind === 'unclassified');
      return `${f.year}  ·  ${f.total.toLocaleString()} works indexed\n`
        + `largest: ${ranked}\n`
        + `unclassified (no primary field): `
        + `${unc.values[t].toLocaleString()} (${pct(unc.values[t] / (geo.totals[t] || 1))})`;
    }
    // 键不在布局里就返回空。凭 hit 对象里的字段直接拼一句话，会为一个不存在的带
    // 编出一段看着很像真的读数 —— 报不出比报错更糟。
    if (!geo.bands.some((b) => b.key === f.key)) return '';
    return `${f.name}\n`
      + `${f.year}: ${f.count.toLocaleString()} works · ${pct(f.share)} of that year\n`
      + `that year's total: ${f.total.toLocaleString()} works`;
  }

  function renderLegend(el) {
    if (!data || !meta) { el.innerHTML = ''; return; }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const T1 = data.years.indexOf(meta.riverLastYear);
    const total = data.totalByYear[T1];
    const firstYear = meta.riverFirstYear;
    const firstTotal = data.totalByYear[data.years.indexOf(firstYear)];
    const rest = data.fields.filter((f) => !(meta.top8 || []).includes(f.id));
    const byId = new Map(data.fields.map((f) => [f.id, f]));

    let html = '<div style="color:var(--muted);font-size:10.5px;margin-bottom:6px;line-height:1.5;'
      + 'max-width:315px;">'
      + `<b>Each column is one year, normalised to 100%.</b> The river height is constant by `
      + 'design, so you read <i>composition</i>, not growth. Absolute volume is in the hover: '
      + `${firstYear} had ${firstTotal.toLocaleString()} indexed works, ${meta.riverLastYear} had `
      + `${total.toLocaleString()} — about ${Math.round(total / firstTotal).toLocaleString()}× more.`
      + '</div>';

    html += '<div style="font-weight:600;margin-bottom:3px;color:var(--muted);">'
      + `Share of ${meta.riverLastYear} works (click Other to expand)</div>`;

    const row = (color, name, share, sub, key, clickable) => {
      let s = `<div class="item row"${key ? ` data-key="${esc(key)}"` : ''}`
        + `${clickable ? ' style="cursor:pointer;"' : ''}>`
        + `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;flex:none;`
        + `background:${color};margin-right:6px;"></span>`
        + '<span style="flex:1;min-width:0;">'
        + `<span style="display:block;">${esc(name)}</span>`
        + (sub ? `<span style="display:block;color:var(--muted);font-size:10px;">${esc(sub)}</span>` : '')
        + `</span><span class="cnt">${(share * 100).toFixed(2)}%</span></div>`;
      return s;
    };

    (meta.top8 || []).forEach((id, i) => {
      const f = byId.get(id);
      if (!f) return;
      html += row(CATEGORICAL_8_DARK[i], f.name, f.byYear[T1] / total,
                   `${f.byYear[T1].toLocaleString()} works`);
    });

    const otherSum = rest.reduce((s, f) => s + f.byYear[T1], 0);
    html += row(AGGREGATE.other, `Other (${rest.length} fields)`, otherSum / total,
                expanded ? 'click to collapse' : 'click to expand into 18 grey bands',
                '__other__', true);
    if (expanded) {
      for (const f of rest.slice().sort((a, b) => b.byYear[T1] - a.byYear[T1])) {
        html += `<div style="padding-left:15px;font-size:10.5px;display:flex;">`
          + `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;`
          + `white-space:nowrap;color:var(--muted);">${esc(f.name)}</span>`
          + `<span style="color:var(--muted);">${(f.byYear[T1] / total * 100).toFixed(2)}%</span></div>`;
      }
    }

    const unc = data.unclassifiedByYear[T1];
    html += row(AGGREGATE.unclassified, 'Unclassified', unc / total,
                `${unc.toLocaleString()} works with no primary field`);

    html += '<div style="color:var(--muted);font-size:10.5px;margin-top:8px;line-height:1.5;'
      + 'max-width:315px;">'
      + `<b>What this data cannot show.</b> Birth and rise/fall, yes. <b>Splitting and merging, no</b> — `
      + 'OpenAlex&rsquo;s field taxonomy is fixed over time and every work has exactly one '
      + 'primary topic, so no discipline can be observed dividing or combining. '
      + `Also excluded: ${(meta.excludedYears || []).map((e) => e.year).join(' and ')} — OpenAlex has `
      + 'indexed those works but not yet classified them '
      + `(${(meta.excludedYears || []).map((e) => (e.unclassified / e.total * 100).toFixed(0) + '%').join(' and ')} `
      + 'have no primary field, against ~8% for 2012–2024). Drawing them would assert that recent '
      + 'science is mostly unclassifiable. Source: OpenAlex <code>primary_topic.field.id</code>.'
      + '</div>';

    el.innerHTML = html;
    const clickable = el.querySelectorAll('[data-key]');
    for (const node of clickable) {
      if (node.dataset.key !== '__other__') continue;
      node.onclick = () => {
        expanded = !expanded;
        geo = null;
        renderLegend(el);
        onChange();
      };
    }
  }

  return {
    setData, getData, getModel: () => geo,
    draw, pick, describe, renderLegend,
    setHover, getHover, togglePinned, getPinned, sameTarget,
    isExpanded,
    shortNameOf: (f) => shortName(f),
    getCounts: () => (meta ? { years: meta.riverLastYear - meta.riverFirstYear + 1,
                               fields: meta.fieldCount,
                               topYear: meta.topYear,
                               totalAtTopYear: data.totalByYear[data.years.indexOf(meta.topYear)] } : null),
    get layout() { return geo; },
    get bands() { return geo ? geo.bands : []; },
    get years() { return geo ? geo.years : []; },
  };
}
