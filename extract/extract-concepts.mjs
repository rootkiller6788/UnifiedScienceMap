// extract-concepts.mjs
// 合并 docs/undergrad.yaml + docs/overview.yaml + docs/100.yaml，提取精选数学概念/定理，
// 为每个概念赋予「三层抽象层级 tier」+「历史年代 era」+「确定性地图坐标 x/y」，输出 web/concepts.json。
//
// 布局是确定性的（非力导向）：一张 16:9 的科研地图。
//   X 轴 = 历史时间（era 排名，早→晚 从左到右）
//   Y 轴 = 三层抽象：
//     上层(具体/离散代数)：群、环、域、线性代数、组合、数论、欧氏几何、数系
//     中层(基础通用骨架)：集合论、逻辑、范畴论
//     下层(抽象/连续/分析)：拓扑、分析、测度、概率、分布、动力系统、微分几何
//
// 连线 = 模块 import 近似（概念 decl 定位到所在模块，模块间 import 依赖即连线）。
//
// 用法：node extract/extract-concepts.mjs
// 输出：web/concepts.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const YAML_UNDERGRAD = path.join(ROOT, 'docs', 'undergrad.yaml');
const YAML_OVERVIEW = path.join(ROOT, 'docs', 'overview.yaml');
const YAML_100 = path.join(ROOT, 'docs', '100.yaml');
const MATHLIB_DIR = path.join(ROOT, 'Mathlib');
const OUT = path.join(ROOT, 'web', 'concepts.json');

// ---- 世界坐标（16:9）----
const W = 1600, H = 900;
const PLOT = { left: 95, right: 1565, top: 55, bottom: 845 };
const TIER_Y = { 0: 172, 1: 450, 2: 728 }; // 上层=0(具体)，中层=1(基础)，下层=2(抽象)
const GAP = 26; // 团间水平间隙

// ---- 三层抽象 ----
const TIER_CONCRETE = 0;  // 具体/离散代数
const TIER_FOUNDATION = 1; // 基础骨架（集合论/逻辑/范畴论）
const TIER_ABSTRACT = 2;  // 抽象/连续/分析

// ---- 分类规则（按优先级，首个命中即返回）----
// 规则匹配 branch+cluster+label 的小写串。返回 {tier, era} 或 null 继续下一条。
const CLASSIFY_RULES = [
  // 基础骨架（中层）：范畴论、逻辑、集合论、序理论
  { re: /categor|functor|monad|natural transformation|yoneda|topos|adjunction|abelian category|grothendieck|sheaf|presheaf|homological algebra/, tier: TIER_FOUNDATION, era: 1945 },
  { re: /logic|model theor|type theor|set theor|ordinal|cardinal|boolean|foundation|zorn|axiom of choice|well.order/, tier: TIER_FOUNDATION, era: 1890 },
  { re: /order theor|lattice|poset/, tier: TIER_FOUNDATION, era: 1900 },

  // 抽象/连续（下层）：拓扑、分析、测度、概率、分布、动力系统、微分几何
  { re: /topolog|homotop|homolog|metric space|uniform space|compact|connected space|separation|continuity|continuous|convergen|open set|closed set|closure|dense|neighbourhood|neighborhood/, tier: TIER_ABSTRACT, era: 1900 },
  { re: /measure|measurable|lebesgue|integra(l|ble|tion)|bochner|vitali|carath/, tier: TIER_ABSTRACT, era: 1902 },
  { re: /probabilit|probabilistic|stochastic|random|martingale|expected value|variance|independence/, tier: TIER_ABSTRACT, era: 1933 },
  { re: /distribution|schwartz|tempered|test function/, tier: TIER_ABSTRACT, era: 1945 },
  { re: /dynamical|dynamics|chaos|ergodic|lyapunov|flow|attractor/, tier: TIER_ABSTRACT, era: 1900 },
  { re: /differential equation|ode|pde|sturm|fourier series|harmonic analysis|laplace|poisson equation|heat equation|wave equation/, tier: TIER_ABSTRACT, era: 1850 },
  { re: /complex analysis|complex analy|holomorphic|analytic function|cauchy|residue|meromorphic|entire function/, tier: TIER_ABSTRACT, era: 1825 },
  { re: /real analysis|real analy|limits|limit|differentiab|derivative|integral|calculus|taylor|riemann (sum|integral)|darboux|mean value theorem|intermediate value/, tier: TIER_ABSTRACT, era: 1820 },
  { re: /functional analys|banach|hilbert|normed|operator norm|spectral|dual space/, tier: TIER_ABSTRACT, era: 1920 },
  { re: /convex|sublinear/, tier: TIER_ABSTRACT, era: 1900 },
  { re: /numerical|finite element|interpolat|spline/, tier: TIER_ABSTRACT, era: 1945 },
  { re: /manifold|differential geometr|riemannian|curvature|tangent|lie group|lie algebra/, tier: TIER_ABSTRACT, era: 1850 },
  { re: /algebraic geometr|scheme|variety|sheaf of/, tier: TIER_ABSTRACT, era: 1950 },
  { re: /analysis|analytic/, tier: TIER_ABSTRACT, era: 1850 },

  // 具体/离散代数（上层）：群、环、域、线性代数、组合、数论、几何、数系
  { re: /group|galois|sylow|subgroup|coset|normal subgroup|abelian|free group|permutation/, tier: TIER_CONCRETE, era: 1830 },
  { re: /ring|ideal|field|module|algebraic structure|monoid|semigroup|commutative algebra|localization|krull|noetherian|artinian/, tier: TIER_CONCRETE, era: 1870 },
  { re: /linear algebra|matrix|vector space|bilinear|quadratic form|eigenvalue|eigenvector|determinant|inner product|dual|tensor product|linear map/, tier: TIER_CONCRETE, era: 1850 },
  { re: /combinatoric|graph|permutation|counting|binomial|pigeonhole|matching|coloring|tree/, tier: TIER_CONCRETE, era: 1900 },
  { re: /number theory|prime|congruence|diophantine|quadratic reciprocity|arithmetic|p.adic|divisibility|gcd|modular/, tier: TIER_CONCRETE, era: 1800 },
  { re: /number|integer|rational|irrational|real number|complex number|natural|enumeration|denumerab|countable/, tier: TIER_CONCRETE, era: 1600 },
  { re: /euclidean|affine|geometr|polygon|triangle|circle|angle|congruent|parallel|isometry|conic|incidence/, tier: TIER_CONCRETE, era: -300 },
  { re: /finite|discrete|combinatorial|enumeration/, tier: TIER_CONCRETE, era: 1850 },
];

// 少数著名定理的历史年代精确覆盖（让 X 轴更真实）
const TITLE_ERA_OVERRIDE = [
  [/pythagorean|pythagoras/i, -500],
  [/irrational.*sqrt|sqrt.*irrational|incommensurab/i, -500],
  [/euclid|elements of/i, -300],
  [/fundamental theorem of (algebra|arithmetic)/i, 1800],
  [/quadratic reciprocity/i, 1801],
  [/g[iö]del|incompleteness/i, 1931],
  [/prime number theorem/i, 1896],
  [/four colour|four color/i, 1976],
  [/cayley.?hamilton/i, 1858],
  [/burnside/i, 1904],
  [/lagrange/i, 1770],
  [/cauchy/i, 1821],
  [/galois/i, 1830],
];

function classify(branch, cluster, label) {
  // 先用定理标题精确覆盖
  for (const [re, era] of TITLE_ERA_OVERRIDE) {
    if (re.test(label)) {
      // 只覆盖 era，tier 仍按规则（标题里通常没有学科词，走默认规则）
      const r = classifyByRules(branch, cluster, label);
      return { tier: r ? r.tier : TIER_CONCRETE, era };
    }
  }
  const r = classifyByRules(branch, cluster, label);
  return r || { tier: TIER_CONCRETE, era: 1850 };
}

function classifyByRules(branch, cluster, label) {
  const s = `${branch} ${cluster} ${label}`.toLowerCase();
  for (const rule of CLASSIFY_RULES) {
    if (rule.re.test(s)) return { tier: rule.tier, era: rule.era };
  }
  return null;
}

// ---- 解析 yaml（undergrad/overview 三层结构）----
function parseYamlTree(text, sourceName) {
  const concepts = [];
  let branch = '';
  let cluster = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, '').trimEnd();
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2].trim();
    const rawVal = m[3].trim();

    if (indent === 0) { branch = key; cluster = ''; }
    else if (indent === 2) { cluster = key; }
    else if (rawVal === '') { cluster = key; }
    else if (rawVal === "''" || rawVal === '""') continue; // 未形式化空值，跳过
    else if (rawVal.startsWith('http://') || rawVal.startsWith('https://') || rawVal.startsWith('Mathlib/')) continue;
    else {
      const decl = rawVal.replace(/^['"]|['"]$/g, '');
      concepts.push({ label: key, decl, branch, cluster, source: sourceName });
    }
  }
  return concepts;
}

// ---- 解析 100.yaml（平铺编号结构）----
function parseYaml100Fixed(text) {
  const items = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, '').trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const num = line.match(/^(\d+):\s*$/);
    if (num) { if (cur) items.push(cur); cur = { number: num[1] }; continue; }
    const field = line.match(/^(\s{2})([^:]+):\s*(.*)$/);
    if (!field || !cur) continue;
    const key = field[2].trim();
    const val = field[3].trim();
    if (key === 'title') cur.title = val.replace(/^['"]|['"]$/g, '');
    else if (key === 'decl' && !cur.decl) cur.decl = val.replace(/^['"]|['"]$/g, '');
    else if (key === 'statement' && !cur.decl) cur.decl = val.replace(/^['"]|['"]$/g, '');
  }
  if (cur) items.push(cur);
  return items
    .filter((c) => c.title && c.decl)
    .map((c) => ({ label: c.title, decl: c.decl, branch: 'Famous Theorems', cluster: '', source: '100.yaml' }));
}

// ---- 扫描源码：import 图 + 声明短名索引 ----
function scanSource() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.lean')) files.push(full);
    }
  };
  walk(MATHLIB_DIR);

  const rel = (p) => path.relative(ROOT, p);
  const modOf = (p) => rel(p).slice(0, -'.lean'.length).replaceAll(path.sep, '.');
  const IMPORT_RE = /^(?:public |private )?import\s+([A-Za-z][A-Za-z0-9_.]*)/;
  const DECL_RE = /^\s*(?:@\[[^\]]*\]\s*)?(?:theorem|lemma|def|structure|class|inductive|instance|abbrev|opaque|axiom)\s+([A-Za-z_][A-Za-z0-9_]*)/;

  const imports = new Set();
  const declToFiles = new Map();
  const nsToFiles = new Map();

  for (const p of files) {
    const mod = modOf(p);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const im = line.match(IMPORT_RE);
      if (im && im[1].startsWith('Mathlib.')) imports.add(im[1] + '|' + mod);
      const dm = line.match(DECL_RE);
      if (dm) {
        const sn = dm[1];
        if (!declToFiles.has(sn)) declToFiles.set(sn, new Set());
        declToFiles.get(sn).add(mod);
      }
      const ns = line.match(/^namespace\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (ns) {
        const n = ns[1];
        if (!nsToFiles.has(n)) nsToFiles.set(n, new Set());
        nsToFiles.get(n).add(mod);
      }
    }
  }
  return { imports, declToFiles, nsToFiles };
}

// ---- decl → 模块定位 ----
function locate(decl, declToFiles, nsToFiles) {
  const segs = decl.split('.');
  const short = segs[segs.length - 1];
  const ns = segs.length > 1 ? segs[segs.length - 2] : null;
  const cands = declToFiles.get(short);
  if (!cands || cands.size === 0) return null;
  if (cands.size === 1) return [...cands][0];
  const arr = [...cands];
  if (ns) {
    const nsFiles = nsToFiles.get(ns);
    if (nsFiles) {
      const hit = arr.filter((f) => nsFiles.has(f));
      if (hit.length) return hit[0];
    }
    const pathHit = arr.filter((f) => f.includes(ns));
    if (pathHit.length) return pathHit[0];
  }
  return arr[0];
}

// ---- 网格打包：把 n 个节点排成紧凑 blob（确定性，无重叠）----
function packGrid(n, cx, cy, maxW, maxH) {
  if (n <= 0) return [];
  if (n === 1) return [[0, 0]];
  const aspect = maxW / Math.max(1, maxH);
  let cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
  let rows = Math.ceil(n / cols);
  // 若行数超过可容纳，则重排
  const cellW = maxW / cols;
  const cellH = maxH / rows;
  const cell = Math.min(cellW, cellH);
  const actualW = cell * cols;
  const actualH = cell * rows;
  const offs = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    offs.push([(col - (cols - 1) / 2) * cell, (row - (rows - 1) / 2) * cell]);
  }
  return offs;
}

// ---- 确定性布局：三层水平带 × 团按年代排序 ----
function layout(nodes) {
  // 按 (tier, branch) 分组
  const groups = new Map();
  nodes.forEach((n) => {
    const k = n.tier + '|' + n.branch;
    if (!groups.has(k)) groups.set(k, { tier: n.tier, branch: n.branch, era: n.era, idxs: [] });
    const g = groups.get(k);
    g.idxs.push(n.id);
    // 同团内 era 取最小值（更早的年代代表团的起点）
    if (n.era < g.era) g.era = n.era;
  });

  for (const tier of [0, 1, 2]) {
    const gs = [...groups.values()].filter((g) => g.tier === tier);
    gs.sort((a, b) => (a.era - b.era) || a.branch.localeCompare(b.branch));

    const plotW = PLOT.right - PLOT.left;
    const nG = gs.length;
    const totalGap = Math.max(0, (nG - 1) * GAP);
    const usable = Math.max(1, plotW - totalGap);
    const totalWeight = gs.reduce((s, g) => s + Math.sqrt(g.idxs.length), 0);

    let cursor = PLOT.left;
    for (const g of gs) {
      const wSlot = usable * Math.sqrt(g.idxs.length) / totalWeight;
      const cx = cursor + wSlot / 2;
      const cy = TIER_Y[tier];
      const maxW = Math.max(20, wSlot - 8);
      const maxH = 210; // 三层带高度上限
      const offs = packGrid(g.idxs.length, cx, cy, maxW, maxH);
      g.idxs.forEach((id, i) => {
        nodes[id].x = cx + offs[i][0];
        nodes[id].y = cy + offs[i][1];
        nodes[id].groupX = cx;
        nodes[id].groupW = wSlot;
      });
      cursor += wSlot + GAP;
    }
  }
  return nodes;
}

// ---- 主流程 ----
function main() {
  const undergrad = parseYamlTree(fs.readFileSync(YAML_UNDERGRAD, 'utf8'), 'undergrad.yaml');
  const overview = parseYamlTree(fs.readFileSync(YAML_OVERVIEW, 'utf8'), 'overview.yaml');
  const hundred = parseYaml100Fixed(fs.readFileSync(YAML_100, 'utf8'));

  // 合并 + 去重（优先 undergrad 的 cluster 标签更细）
  const merged = [];
  const seen = new Set();
  for (const c of [...undergrad, ...overview, ...hundred]) {
    if (seen.has(c.decl)) continue;
    seen.add(c.decl);
    merged.push(c);
  }

  const { imports, declToFiles, nsToFiles } = scanSource();

  // 定位 + 分类
  const nodes = [];
  let droppedLocate = 0;
  for (const c of merged) {
    const module = locate(c.decl, declToFiles, nsToFiles);
    if (!module) { droppedLocate++; continue; }
    const { tier, era } = classify(c.branch, c.cluster, c.label);
    nodes.push({
      id: nodes.length,
      label: c.label,
      decl: c.decl,
      branch: c.branch,
      cluster: c.cluster,
      tier,
      era,
      module,
      x: 0, y: 0,
    });
  }

  layout(nodes);

  // 模块 → 概念索引（连线用）
  const conceptsByModule = new Map();
  nodes.forEach((n) => {
    if (!conceptsByModule.has(n.module)) conceptsByModule.set(n.module, []);
    conceptsByModule.get(n.module).push(n.id);
  });

  // 连线：模块 import 近似
  const edgeSet = new Set();
  const edges = [];
  const modules = [...conceptsByModule.keys()];
  for (const m1 of modules) {
    for (const m2 of modules) {
      if (m1 === m2) continue;
      const hasImport = imports.has(m1 + '|' + m2) || imports.has(m2 + '|' + m1);
      if (!hasImport) continue;
      const k = m1 < m2 ? m1 + '|' + m2 : m2 + '|' + m1;
      if (edgeSet.has(k)) continue;
      edgeSet.add(k);
      edges.push({
        source: nodes[conceptsByModule.get(m1)[0]].decl,
        target: nodes[conceptsByModule.get(m2)[0]].decl,
      });
    }
  }

  // 分支统计 + 分层统计
  const branchCount = {};
  const tierCount = { 0: 0, 1: 0, 2: 0 };
  for (const n of nodes) {
    branchCount[n.branch] = (branchCount[n.branch] || 0) + 1;
    tierCount[n.tier]++;
  }
  const branches = Object.entries(branchCount)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const sample = nodes.find((n) => n.branch === name);
      return { name, count, tier: sample.tier, era: sample.era };
    });

  // X 轴时间刻度（抽样锚点年）
  const eraAxis = [];
  for (const year of [-500, -300, 1600, 1800, 1850, 1900, 1933, 1945, 1976]) {
    // 找该年附近所有团的 x（取团起点 era 最接近的）
    const groups = [...new Set(nodes.map((n) => `${n.tier}|${n.branch}`))]
      .map((k) => nodes.find((n) => `${n.tier}|${n.branch}` === k));
    // 用所有节点近似
  }
  // 简化：用所有节点 era 的 min/max + 若干分位
  const eras = nodes.map((n) => n.era);
  const eraMin = Math.min(...eras);
  const eraMax = Math.max(...eras);

  const out = {
    meta: {
      generated: new Date().toISOString(),
      conceptCount: nodes.length,
      edgeCount: edges.length,
      branchCount: branches.length,
      source: 'undergrad.yaml + overview.yaml + 100.yaml',
      layout: 'map',
      world: { width: W, height: H, plot: PLOT },
      tierLabels: {
        0: '具体 / 离散代数（群·环·域·组合·数论·几何）',
        1: '基础通用骨架（集合论·逻辑·范畴论）',
        2: '抽象 / 连续（拓扑·分析·测度·概率·动力系统）',
      },
      eraMin,
      eraMax,
      droppedLocate,
    },
    nodes,
    edges,
    branches,
    tiers: [
      { id: 0, y: TIER_Y[0] },
      { id: 1, y: TIER_Y[1] },
      { id: 2, y: TIER_Y[2] },
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`✔ 写入 ${OUT}`);
  console.log(`  合并原始概念: ${merged.length}（undergrad ${undergrad.length} + overview ${overview.length} + 100.yaml ${hundred.length}，去重后）`);
  console.log(`  定位失败丢弃: ${droppedLocate}`);
  console.log(`  最终节点: ${nodes.length} · 连线: ${edges.length}`);
  console.log(`  三层分布: 上层(具体)${tierCount[0]} / 中层(基础)${tierCount[1]} / 下层(抽象)${tierCount[2]}`);
  console.log(`  历史年代范围: ${eraMin} ~ ${eraMax}`);
  console.log('  学科分布: ' + branches.map((b) => `${b.name}(${b.count})`).join(', '));
}

main();
