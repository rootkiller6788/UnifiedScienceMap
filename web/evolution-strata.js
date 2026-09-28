// evolution-strata.js — 知识地层（Stratigraphic Terrain）：1827–2024 的学科剖面。
//
// 读 web/openalex-history.json —— 与已退役的 evolution-river.js **同一个快照文件**，
// 没有新增数据、没有新增构建脚本、没有网络。
//
// ------------------------------------------------------------------ 为什么不是"河"
//
// 前一个实现是河流图：时间在 X 轴上铺开，Y 是**份额**，每年归一到 100%，所以河高恒定。
// 它的问题不是画得不好，是**选错了图种** —— 时间被摊成几条并排的带子，绝对体量被归一化
// 抹掉（1827 年 6,870 篇与 2024 年 10,872,134 篇一样高），而且仓库里已经有 Alluvial。
//
// 这里换成地质剖面：**时间竖着走，老的在下面**，每年的横向宽度就是那一年的体量，
// 层内按学科份额切分。于是外轮廓的起伏 = 知识总量的真实涨落，而层内色带的厚薄变化
// = 学科结构的重组。两个通道各管一个量，不冗余。
//
// ------------------------------------------------------------------ 宽 ∝ √作品数（实测逼出来的）
//
// 用户选的是"绝对宽度"。但实测：最宽的一层（2020 年）11,473,511 篇，最窄的一层
// （1827 年）6,870 篇，**相差 1,670 倍**。线性标度下 1827 年只有 **0.85 像素** ——
// 不是"细"，是画不出来，整个 19 世纪会是一根亚像素的发丝
// （198 年里 71 年 < 8px，11 年 < 1px，最小的几年已经落在亚像素里）。
//
// 所以宽度取 **√**：1827 年 34.6px，最小层 32.9px，0 年 < 8px，总比 43×。
// 这不是审美折中 —— **层的面积 ∝ 作品数**，而人读"有多少"读的正是面积不是长度。
// 同一条规则在 Coral 里已经用过（`r ∝ √W`）。代价是顺着一条边量出来的长度不是线性的，
// 这一点写进图例。**"绝对量"本身没变**：外轮廓由绝对作品数决定，不是份额归一化。
//
// ------------------------------------------------------------------ 层序固定，不按当年大小排
//
// 层内的带序**固定**为 2024 份额降序（meta.top8）+ Other(18) + Unclassified，198 年不变。
// 这是"隆起"能被看见的全部原因：同一个学科永远在同一横位，它的份额涨落就表现为
// 那一条色带**变厚变薄**，看起来就是从邻近的层里拱出来。若按当年大小排序，色带会互换位置，
// 结构变化就变成了噪声。（mut-evolution.mjs 里有一条专门抓这个。）
//
// ------------------------------------------------------------------ 诚实边界（这一段的数字全是实测）
//
// · **这段窗口里没有出生，也没有灭绝。** 26 个 field 在 198 年里**年年非零** ——
//   1827 年就已经 26 个全在了。能看到的"横空出世"是**份额**从 ~1% 起涨
//   （CS 0.77% → 6.74%），不是从无到有。
// · **分裂与合并观测不到。** OpenAlex 的分类法不随时间变，每篇 work 只有一个
//   primary_topic，所以"一个学科裂成两个"在这份数据里不是可观测事件。
// · **断层阈值是量出来的，不是挑的。** 逐年成分变化（26 个 field 的份额向量，
//   半 L1 距离）：未平滑时 p50 2.16% / p95 6.28%，头部是 1850 的 10.16%、1877 的 8.50%
//   —— 那全是**早年小样本噪声**（1827 全年只有 6,870 篇，一篇就能推动份额）。
//   5 年居中平滑后 p50 0.81% / **p90 1.66%** / p95 1.85%，头部变成有量的年段：
//   **1943–1949**（14.8–22.8 万篇）与 **2019–2021**（1,100 万篇）。
//   本文件取 **p90** 为阈值，而且是**运行时按载入的数据现算**的（`deriveStats`），
//   不是写死的数 —— 换一份快照，阈值跟着数据走。
//
// 2025/2026 不画：这两年 OpenAlex 的未分类率跳到 24.4% 和 70.3%（索引与分类滞后，
// 不是科学事实的变化）。原始数字仍在 JSON 里，`meta.excludedYears` 记着原因。

const PAD_T = 118;           // 顶部留出带标签的位置
const PAD_B = 58;
const PAD_L = 92;            // 年份标尺
const PAD_R = 92;

const LABEL_MIN_W = 26;      // 2024 年那层薄于这个宽度就不标名字，交给图例
const FONT_LABEL = 11.5;
const FONT_AXIS = 10.5;
const FONT_FAULT = 10;

// 断层：5 年平滑后的逐年成分变化（半 L1）分位数阈值。实测 p90 = 1.68%。
const FAULT_Q = 0.90;
// 段内平均体量低于这个数就标 low n。实测两档之间隔着 8 倍（0.66–1.8 万 vs 14.8–22.8 万），
// 所以这条线上下都不会压到任何一段。
const LOW_N_VOL = 100000;

// 图例要在**第一次 draw 之前**就能说出"线性标度下第一年有多宽多细"，而那时还没有布局。
// 几何一律在 1600×900 world 坐标里（与其它视图同一约定），所以这个宽度是常数，
// 不是猜的：把它算出来印出去，比在文案里写死一个数要诚实 —— 换数据它就跟着变。
const WORLD_W = 1600;
// 线性标度下整个窗口里有多少年的层宽会掉到 8px 以下（放不下标签）。
const NARROW_PX = 8;

// 8 个真实学科按 2024 份额降序依次取 CATEGORICAL_8_DARK 的槽位 1..8。
// 这个次序本身就是 CVD 安全机制（见 science-categories.mjs 的注释），不要重排。
// 参考调色板的 8 个 dark 槽是**相邻对全部通过**的那一组 —— 而堆叠带正是相邻关系。
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

// OpenAlex 的 field 名太长，图例和悬停里给全名，画布上用短的。
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

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

export function createEvolutionView(opts) {
  const onChange = (opts && opts.onChange) || (() => {});

  let data = null;
  let meta = null;
  let hover = null;
  let pinned = null;
  let expanded = false;
  let geo = null;
  let stats = null;

  function setData(d) {
    data = d || null;
    meta = (d && d.meta) || null;
    hover = null;
    pinned = null;
    expanded = false;
    geo = null;
    stats = null;
  }
  function getData() { return data; }
  function isExpanded() { return expanded; }

  const shortName = (f) => SHORT_NAMES[f.id]
    || (f.name.length > 26 ? f.name.slice(0, 25) + '…' : f.name);

  function yearRange() {
    const T0 = data.years.indexOf(meta.riverFirstYear);
    const T1 = data.years.indexOf(meta.riverLastYear);
    if (T0 < 0 || T1 < T0) return null;
    return { T0, T1, T: T1 - T0 + 1, years: data.years.slice(T0, T1 + 1) };
  }

  // 断层统计与几何无关（只跟数据有关），所以单独算一次并缓存 —— 图例要印出这个
  // 阈值，而图例可能在第一次 draw 之前就被调用。写死一个好看的数再让代码去凑是反的：
  // 阈值必须从载入的数据里现算。
  function deriveStats() {
    if (stats) return stats;
    if (!data || !meta || !data.years) return null;
    const r = yearRange();
    if (!r) return null;
    const { T0, T } = r;

    const totals = new Float64Array(T);
    let maxTotal = 0;
    for (let t = 0; t < T; t++) {
      totals[t] = data.totalByYear[T0 + t] || 0;
      if (totals[t] > maxTotal) maxTotal = totals[t];
    }

    // 只用**已分类**的 26 个 field 算成分：未分类是索引残差，不是学科结构的一部分。
    const K = 2;
    const smooth = data.fields.map((f) => {
      const s = Float64Array.from({ length: T }, (_, t) => (f.byYear[T0 + t] || 0) / (totals[t] || 1));
      return Float64Array.from({ length: T }, (_, t) => {
        let sum = 0, n = 0;
        for (let j = Math.max(0, t - K); j <= Math.min(T - 1, t + K); j++) { sum += s[j]; n++; }
        return sum / n;
      });
    });

    const tv = new Float64Array(T);
    for (let t = 1; t < T; t++) {
      let s = 0;
      for (const sm of smooth) s += Math.abs(sm[t] - sm[t - 1]);
      tv[t] = s / 2;
    }
    const thr = quantile(Array.from(tv.slice(1)).sort((a, b) => a - b), FAULT_Q);

    // 连续超阈值的年段合成一段 —— 单年尖峰是噪声，有量支撑的**段**才是结构变化。
    const faults = [];
    for (let t = 1; t < T; t++) {
      if (tv[t] <= thr) continue;
      const last = faults[faults.length - 1];
      if (last && last.t1 === t - 1) last.t1 = t;
      else faults.push({ t0: t, t1: t });
    }
    for (const f of faults) {
      let vol = 0, peak = 0;
      for (let t = f.t0; t <= f.t1; t++) { vol += totals[t]; peak = Math.max(peak, tv[t]); }
      f.meanVol = vol / (f.t1 - f.t0 + 1);
      f.lowN = f.meanVol < LOW_N_VOL;
      f.year0 = r.years[f.t0];
      f.year1 = r.years[f.t1];
      f.peak = peak;
    }

    stats = { T, T0, T1: r.T1, years: r.years, totals, maxTotal, tv, thr, faults };
    return stats;
  }

  // ------------------------------------------------------------------ layout
  function layout(w, h) {
    const sig = `${w}x${h}x${expanded ? 1 : 0}`;
    if (geo && geo.sig === sig) return geo;
    const st = deriveStats();
    if (!st) { geo = null; return null; }
    const { T, totals, years } = st;

    const maxTotal = st.maxTotal;   // 与断层统计同源，不重算一遍

    const top8 = meta.top8 || [];
    const byId = new Map(data.fields.map((f) => [f.id, f]));
    const rest = data.fields.filter((f) => !top8.includes(f.id));
    const vals = (f) => Float64Array.from({ length: T }, (_, t) => f.byYear[st.T0 + t] || 0);

    // 层内的带序**固定**，198 年不变：8 个学科（2024 份额降序）→ Other → Unclassified（残差在最右）。
    const bands = [];
    top8.forEach((id, i) => {
      const f = byId.get(id);
      if (!f) return;
      bands.push({ key: id, name: f.name, short: shortName(f), kind: 'field', slot: i,
                   color: CATEGORICAL_8_DARK[i], values: vals(f) });
    });

    const otherValues = new Float64Array(T);
    for (const f of rest) for (let t = 0; t < T; t++) otherValues[t] += f.byYear[st.T0 + t] || 0;

    if (!expanded) {
      bands.push({ key: '__other__', name: `Other (${rest.length} fields)`, short: `Other (${rest.length})`,
                   kind: 'other', color: AGGREGATE.other, values: otherValues, rest });
    } else {
      // 展开：18 条灰带，按名字排序（固定次序），整体占住原来 Other 的那一段。
      // 不给 18 个颜色 —— 没有 18 个能通过 CVD 全对门的色相，硬凑只会让相邻两条看不出区别。
      const sorted = rest.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      // 这 18 条**取代**那条 Other，不是加在它旁边：再放一条 Other 会让那一段被数两遍，
      // 总宽会翻倍，而"层内和 == 层宽"这条不变量仍然对得上，从图上只看到 Other 忽然变两倍宽。
      for (const f of sorted) {
        bands.push({ key: f.id, name: f.name, short: shortName(f), kind: 'other-field',
                     group: '__other__', color: AGGREGATE.other, values: vals(f) });
      }
    }

    bands.push({ key: '__unclassified__', name: 'Unclassified', short: 'Unclassified',
                 kind: 'unclassified', color: AGGREGATE.unclassified,
                 values: Float64Array.from({ length: T }, (_, t) => data.unclassifiedByYear[st.T0 + t] || 0) });

    // ---- 几何：中心对称的柱子，y 是年份（1827 在下），横向半宽 ∝ √当年总量 ----
    const x0 = PAD_L;
    const x1 = Math.max(x0 + 120, w - PAD_R);
    const cx = (x0 + x1) / 2;
    const maxHalf = (x1 - x0) / 2;
    const yTop = PAD_T;
    const yBottom = h - PAD_B;
    const sh = T > 0 ? (yBottom - yTop) / T : 0;

    const half = new Float64Array(T);
    for (let t = 0; t < T; t++) half[t] = maxHalf * Math.sqrt(maxTotal ? totals[t] / maxTotal : 0);

    // 每年左右边界：层内按当年份额切分，最后一刀**显式钉在 cx + half[t]**，
    // 免得浮点累加让"层内和 == 层宽"差出 1e-13。
    for (const b of bands) { b.xl = new Float64Array(T); b.xr = new Float64Array(T); }
    for (let t = 0; t < T; t++) {
      const total = totals[t] || 1;
      const right = cx + half[t];
      let x = cx - half[t];
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        b.xl[t] = x;
        x += (b.values[t] / total) * 2 * half[t];
        b.xr[t] = i === bands.length - 1 ? right : x;
      }
    }

    // 年的上下边界：yOfTop(t) === yOfBot(t+1)，所以相邻两年共用一条水平边，
    // 每条色带因此是连续的，而不是 198 个分开的方块。
    const yOfBot = (t) => yBottom - t * sh;
    const yOfTop = (t) => yBottom - (t + 1) * sh;

    geo = { sig, w, h, T, years, t0: st.T0, t1: st.T1, totals, maxTotal, bands,
            faults: st.faults, tv: st.tv, thr: st.thr,
            cx, x0, x1, maxHalf, yTop, yBottom, H: yBottom - yTop, sh, half, yOfTop, yOfBot,
            yOf: (year) => yBottom - ((year - years[0]) + 0.5) * sh };
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

    // 1. 层。每条带是一条**贯穿 198 年的竖向色带**：左右边界逐年变化，相邻两年共用
    //    一条水平边，所以带本身是连续的、像一层被压实的地层。
    //    198 年 × 10 带 ≈ 4,000 个顶点，一帧直接填 —— 不需要离屏缓存。
    for (const b of g.bands) {
      const p = new Path2D();
      // 左边：自下而上的阶梯
      p.moveTo(b.xl[0], g.yOfBot(0));
      for (let t = 0; t < g.T; t++) {
        p.lineTo(b.xl[t], g.yOfBot(t));
        p.lineTo(b.xl[t], g.yOfTop(t));
      }
      // 右边：自上而下的阶梯，顶边在两次之间自然接上
      for (let t = g.T - 1; t >= 0; t--) {
        p.lineTo(b.xr[t], g.yOfTop(t));
        p.lineTo(b.xr[t], g.yOfBot(t));
      }
      p.closePath();
      b.path = p;

      ctx.globalAlpha = lit(b) ? (b.kind === 'unclassified' ? 0.95 : 1) : 0.18;
      if (b.kind === 'field') {
        const grad = ctx.createLinearGradient(0, g.yBottom, 0, g.yTop);
        grad.addColorStop(0, shadeColor(b.color, -0.20));
        grad.addColorStop(0.55, b.color);
        grad.addColorStop(1, shadeColor(b.color, 0.20));
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = b.color;
      }
      ctx.fill(p);
    }
    ctx.globalAlpha = 1;

    // 2. 带之间画细白线。相邻两条同色（展开后的 18 条灰带）时，不画线就分不开。
    //    每条带画的是它自己的**左边界**，所以 n 条带刚好画 n 条分隔线（最左边那条是外轮廓）。
    ctx.save();
    ctx.strokeStyle = AGGREGATE.rule;
    ctx.lineWidth = 1 / k;
    for (const b of g.bands) {
      ctx.beginPath();
      for (let t = 0; t < g.T; t++) {
        ctx.lineTo(b.xl[t], g.yOfBot(t));
        ctx.lineTo(b.xl[t], g.yOfTop(t));
      }
      ctx.stroke();
    }
    ctx.restore();

    drawFaults(ctx, g, k);
    drawYearAxis(ctx, g, k);
    drawBandLabels(ctx, g, focus, k);

    // 3. 悬停的那一层整层描边
    if (focus && g.years.includes(focus.year)) {
      const t = g.years.indexOf(focus.year);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.moveTo(g.cx - g.half[t], g.yOfTop(t));
      ctx.lineTo(g.cx + g.half[t], g.yOfTop(t));
      ctx.lineTo(g.cx + g.half[t], g.yOfBot(t));
      ctx.lineTo(g.cx - g.half[t], g.yOfBot(t));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawYearAxis(ctx, g, k) {
    ctx.save();
    ctx.font = `${FONT_AXIS / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = 'rgba(150,162,180,0.85)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const x = g.x0 - 10 / k;
    for (let year = Math.ceil(g.years[0] / 25) * 25; year <= g.years[g.years.length - 1]; year += 25) {
      const y = g.yOf(year);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.moveTo(g.cx - g.maxHalf, y);
      ctx.lineTo(g.cx + g.maxHalf, y);
      ctx.stroke();
      ctx.fillText(String(year), x, y);
    }
    ctx.restore();
  }

  // 断层：**标注**，不是变形。把连续超阈值的年段画成两条横贯该段的虚线 + 段标。
  // 用户明确选了"线性时间 × 绝对宽度、不做事件局部变形"，所以这里绝不把图层扭歪 ——
  // 扭歪之后年份轴就不再是线性的了，而那是整张图的读数基础。
  function drawFaults(ctx, g, k) {
    if (!g.faults.length) return;
    ctx.save();
    ctx.font = `600 ${FONT_FAULT / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textBaseline = 'middle';
    for (const f of g.faults) {
      let hw = 0;
      for (let t = f.t0; t <= f.t1; t++) hw = Math.max(hw, g.half[t]);
      const yA = g.yOfTop(f.t1);
      const yB = g.yOfBot(f.t0);
      ctx.globalAlpha = f.lowN ? 0.32 : 0.62;
      ctx.strokeStyle = f.lowN ? 'rgba(200,140,90,0.9)' : 'rgba(255,214,120,0.95)';
      ctx.lineWidth = 1.5 / k;
      ctx.setLineDash([5 / k, 4 / k]);
      ctx.beginPath();
      ctx.moveTo(g.cx - hw, yA);
      ctx.lineTo(g.cx + hw, yA);
      ctx.moveTo(g.cx - hw, yB);
      ctx.lineTo(g.cx + hw, yB);
      ctx.stroke();
      ctx.setLineDash([]);

      const label = `${f.year0 === f.year1 ? f.year0 : `${f.year0}–${f.year1}`}`
        + `  ${f.lowN ? 'low n' : 'fault'}`;
      // 段够宽就把标放在段内右侧，否则放到段的右边（早年那些段很窄，右边一定是空的）。
      const wide = hw > 200;
      ctx.textAlign = wide ? 'right' : 'left';
      const lx = wide ? g.cx + hw - 8 / k : g.cx + hw + 6 / k;
      const ly = (yA + yB) / 2;
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = BG;
      ctx.strokeText(label, lx, ly);
      ctx.fillStyle = f.lowN ? 'rgba(214,163,116,0.95)' : 'rgba(255,214,120,0.98)';
      ctx.fillText(label, lx, ly);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 每条带在**2024 那一层的顶边上**直接标注 —— 那是最宽的一年，位置也唯一。
  // 身份不能只靠颜色：8 个色相里有两对在 CVD 下接近。
  function drawBandLabels(ctx, g, focus, k) {
    const last = g.T - 1;
    ctx.save();
    // 名字是"屏幕空间里的常数大小"，世界空间里的宽度就随 1/k 增长：窗口越窄，这一行
    // 在世界坐标里越宽。1600 宽时还放得下，1280 时就放不下了，于是最外侧的名字被排出
    // 画面（截图里 "Unclassified" 被右边缘切掉）。所以先按可用跨度收缩字号，压到下限
    // 还放不下再丢掉最宽的几条 —— 丢掉的仍然能在图例和悬停里读到。
    const gap = 6 / k;
    const minX = g.x0 + 4 / k;   // 4/k 的余量盖住描边光晕
    const maxX = g.x1 - 4 / k;
    const span = maxX - minX;

    const collect = (size) => {
      // 先定字体再量宽度，否则量到的是上一个字号。
      ctx.font = `600 ${size / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
      const out = [];
      for (const b of g.bands) {
        if (!b.short || b.xr[last] - b.xl[last] < LABEL_MIN_W) continue;
        out.push({ b, want: (b.xl[last] + b.xr[last]) / 2,
                   lo: b.xl[last], hi: b.xr[last], w: ctx.measureText(b.short).width });
      }
      return out;
    };
    const rowWidth = (list) =>
      list.reduce((s, it) => s + it.w, 0) + gap * Math.max(0, list.length - 1);

    let size = FONT_LABEL;
    let items = collect(size);
    while (items.length > 1 && rowWidth(items) > span && size > FONT_LABEL * 0.72) {
      const next = Math.max(FONT_LABEL * 0.72, size * span / rowWidth(items));
      if (next >= size - 0.01) break;
      size = next;
      items = collect(size);
    }
    while (items.length > 1 && rowWidth(items) > span) {
      let wide = 0;
      for (let i = 1; i < items.length; i++) if (items[i].w > items[wide].w) wide = i;
      items.splice(wide, 1);
    }

    // 落位：让每个名字尽量待在自己那层正上方的"理想位置"，同时既不重叠也不出框。
    // 做法是把**排紧**（左端贴 minX 依次排开，行宽已保证 ≤ span，所以一定塞得下）
    // 与理想位置之间做线性插值，二分出还塞得进框的最大系数。单侧推链是不够的 ——
    // 名字之间的**理想间距**可能比排紧所需还宽，那时右端会被顶出画外（写错过一次）。
    items.sort((p, q) => p.want - q.want);
    const n = items.length;
    if (n) {
      const pack = new Float64Array(n), ideal = new Float64Array(n);
      let cur = minX;
      for (let i = 0; i < n; i++) {
        pack[i] = cur;
        ideal[i] = items[i].want - items[i].w / 2;
        cur += items[i].w + gap;
      }
      const place = (t) => {
        const out = new Float64Array(n);
        let c = minX;
        for (let i = 0; i < n; i++) {
          const l = Math.max(pack[i] + t * (ideal[i] - pack[i]), c);
          out[i] = l;
          c = l + items[i].w + gap;
        }
        return out;
      };
      const fits = (lo) => lo[n - 1] + items[n - 1].w <= maxX + 1e-6;
      let at = place(1);
      if (!fits(at)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 40; i++) {
          const m = (lo + hi) / 2;
          if (fits(place(m))) lo = m; else hi = m;
        }
        at = place(lo);
        if (!fits(at)) at = place(0);
      }
      for (let i = 0; i < n; i++) items[i].want = at[i] + items[i].w / 2;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const focus2 = focus || pinned;
    const ty = g.yTop - 8 / k;
    for (const it of items) {
      const b = it.b;
      const on = !focus2 || focus2.key === b.key || focus2.group === b.key;
      ctx.globalAlpha = on ? 1 : 0.25;
      const mid = (it.lo + it.hi) / 2;
      // 名字被推开时拉一条引线回到它真实的横位
      if (Math.abs(it.want - mid) > 1) {
        ctx.strokeStyle = on ? 'rgba(180,190,205,0.45)' : 'rgba(180,190,205,0.15)';
        ctx.lineWidth = 1 / k;
        ctx.beginPath();
        ctx.moveTo(mid, g.yTop - 1 / k);
        ctx.lineTo(it.want, ty + 1 / k);
        ctx.stroke();
      }
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = BG;
      ctx.strokeText(b.short, it.want, ty);
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(b.short, it.want, ty);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------------------- pick
  function pick(wx, wy) {
    if (!geo) return null;
    const g = geo;
    if (wy < g.yTop - 12 || wy > g.yBottom + 12) return null;
    const t = Math.max(0, Math.min(g.T - 1, Math.floor((g.yBottom - wy) / (g.sh || 1))));
    const year = g.years[t];
    if (wx < g.cx - g.maxHalf - 8 || wx > g.cx + g.maxHalf + 8) return null;

    for (const b of g.bands) {
      if (wx >= b.xl[t] && wx <= b.xr[t]) {
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
        .map((b) => ({ b, v: b.values[t] }))
        .sort((p, q) => q.v - p.v)
        .slice(0, 3)
        .map((x) => `${x.b.short || x.b.name} ${pct(x.v / (geo.totals[t] || 1))}`)
        .join(', ');
      const unc = geo.bands.find((b) => b.kind === 'unclassified');
      const fault = geo.faults.find((x) => t >= x.t0 && t <= x.t1);
      return `${f.year}  ·  ${f.total.toLocaleString()} works indexed\n`
        + `largest: ${ranked}\n`
        + `unclassified (no primary field): `
        + `${unc.values[t].toLocaleString()} (${pct(unc.values[t] / (geo.totals[t] || 1))})`
        + (fault ? `\ncomposition shift here: ${pct(geo.tv[t])} · threshold ${pct(geo.thr)}`
                 + `${fault.lowN ? ' — low sample, read as noise' : ''}` : '');
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
    const st = deriveStats();
    const T1 = data.years.indexOf(meta.riverLastYear);
    const total = data.totalByYear[T1];
    const firstYear = meta.riverFirstYear;
    const firstTotal = data.totalByYear[data.years.indexOf(firstYear)];
    const rest = data.fields.filter((f) => !(meta.top8 || []).includes(f.id));
    const byId = new Map(data.fields.map((f) => [f.id, f]));
    const thrTxt = st ? (st.thr * 100).toFixed(2) + '%' : '—';
    // 线性标度下的层宽 —— 现算，不写死。0.85px 这个数正是"为什么必须用 √"的全部论据，
    // 而它随数据变，所以它必须是从载入的数据里算出来的。
    const linMaxHalf = (WORLD_W - PAD_L - PAD_R) / 2;
    const linWidth = (v) => 2 * linMaxHalf * (st && st.maxTotal ? v / st.maxTotal : 0);
    const firstLinPx = linWidth(firstTotal).toFixed(2);
    const narrowYears = st ? Array.from(st.totals).filter((v) => linWidth(v) < NARROW_PX).length : 0;

    let html = '<div style="color:var(--muted);font-size:10.5px;margin-bottom:6px;line-height:1.5;'
      + 'max-width:315px;">'
      + `<b>Each horizontal layer is one year; ${firstYear} at the bottom, ${meta.riverLastYear} on top.</b> `
      + `A layer&rsquo;s <b>width</b> is that year&rsquo;s volume, so the outline swells from `
      + `${firstTotal.toLocaleString()} works to ${total.toLocaleString()} — about `
      + `${Math.round(total / firstTotal).toLocaleString()}×. Within a layer the bands split by `
      + 'subject share in a <b>fixed order that never changes</b> — which is why a rising subject '
      + 'thickens in place and reads as pushing up through its neighbours.'
      + '</div>';

    html += '<div style="color:var(--muted);font-size:10.5px;margin-bottom:6px;line-height:1.5;'
      + 'max-width:315px;">'
      + '<b>Width ∝ √works, not linearly.</b> On a linear scale the first year would be '
      + `<b>${firstLinPx} px</b> wide — a hairline; measured against this window, `
      + `<b>${narrowYears} of ${st ? st.T : 0} years</b> would fall under ${NARROW_PX} px and be `
      + 'unreadable. So a layer&rsquo;s <b>area</b>, not its edge length, is proportional to volume.'
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
      const share = f.byYear[T1] / total;
      const first = f.byYear[data.years.indexOf(firstYear)] / firstTotal;
      html += row(CATEGORICAL_8_DARK[i], f.name, share,
                   `${f.byYear[T1].toLocaleString()} works · `
                   + `${share > first ? 'up from' : 'down from'} ${(first * 100).toFixed(2)}% in ${firstYear}`);
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
      + '<b>Uplift and erosion are real here — births and extinctions are not.</b> All 26 fields have '
      + 'a non-zero count in <b>every one of the 198 years</b>, so nothing is born or dies inside this '
      + 'window; what looks like an arrival is a <b>share</b> rising from near 1% '
      + '(Computer Science 0.77% → 6.74%). <b>Splitting and merging cannot be shown</b>: the OpenAlex '
      + 'taxonomy is fixed over time and every work carries exactly one primary topic.'
      + '</div>';

    html += '<div style="color:var(--muted);font-size:10.5px;margin-top:8px;line-height:1.5;'
      + 'max-width:315px;">'
      + '<b>Faults are annotated, never drawn as displacement</b> — the year axis stays linear. '
      + 'A fault is a <b>run</b> of years whose subject composition moved more than the 90th percentile '
      + `of year-on-year change, measured after a 5-year smoothing: <b>${thrTxt}</b>. The unsmoothed `
      + 'leaders (10.2% in 1850, 8.5% in 1877) are <b>sampling noise</b> — the first year holds '
      + `${firstTotal.toLocaleString()} works in total, so a handful of papers moves a share. `
      + `Runs averaging under ${LOW_N_VOL.toLocaleString()} works are labelled <b>low n</b>, `
      + 'not read as history.'
      + '</div>';

    html += '<div style="color:var(--muted);font-size:10.5px;margin-top:8px;line-height:1.5;'
      + 'max-width:315px;">'
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
    get faults() { return geo ? geo.faults : []; },
  };
}
