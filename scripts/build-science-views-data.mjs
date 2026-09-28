// 从 map_of_science 的 data.tsv + keys.tsv 一次扫描，产出两个新图的数据：
//
//   web/sunburst-data.json    Science → 11 domain → 299,286 条 topic 弧
//   web/interdisc-data.json   11 节点 + 55 条边（shared / Jaccard / lift）
//
// 两个文件同源，所以放同一个脚本里。拆成两个只会把 readTsv 复制两遍
// （build-science-atlas-data.mjs 已经有一份了）。
//
// 单位说明（重要，两处都依赖）：一条 (domain, keyword) 弧的**权重 = 该 domain 下含这个
// keyword 的所有 cluster 的 num_recent_articles 之和**。所以权重的总和等于
// 「文章 × 主题对」= 129,731,896，而不是文章数 25,968,533。选它是因为它**直接实测**、
// 两环之间**精确闭合**；又因为每个 cluster 的关键词数在 11 个学科里都恒为 4.94–4.99，
// 它与文章数给出的百分比逐位相同（差 <0.1%），所以读者看到的结论不受这个选择影响。
//
// 用法：node scripts/build-science-views-data.mjs   （在仓库根目录跑）

import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES, CATEGORY_IDS, categoryName } from './science-categories.mjs';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'map_of_science', 'asset');
const WEB_DIR = path.join(ROOT, 'web');

// ---------------------------------------------------------------------------
// 读取

function readTsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split('\t');
  return lines.map((line) => {
    const cols = line.split('\t');
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? '';
    return row;
  });
}

// ---------------------------------------------------------------------------
// 置换零模型：lift 的分母
//
// 零假设 = 把 cluster 的 domain 标签随机重排（保持每个 domain 的 cluster 数不变），
// cluster 与关键词的归属不动。于是「含关键词 kw 的那 f 个 cluster」就是一个均匀随机的
// f-子集，落在 domain A（有 a 个 cluster）里的个数服从超几何分布：
//
//   P(命中 A 至少一个) = 1 − C(N−a, f)/C(N, f)
//
// 两边都命中的概率用容斥：
//
//   P(kw ∈ A∩B) = 1 − C(N−a,f)/C(N,f) − C(N−b,f)/C(N,f) + C(N−a−b,f)/C(N,f)
//
// f = 1 时这个式子恒等于 0 —— 一个只出现在 1 个 cluster 里的关键词，结构上不可能被两个
// 学科共享。这正是**朴素独立模型**（把每个关键词的份额当成可花的）算错的地方：274,422 个
// 关键词里有 237,325 个（86.5%）是 f=1，朴素模型把它们的期望份额高估成了非零。
//
// P 只依赖 (a, b, f)，所以按 f 做直方图后，55 对边各算 1,049 次即可 —— 不用逐关键词展开。

const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS_C[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const logChoose = (n, k) =>
  (k < 0 || n < 0 || k > n) ? -Infinity : lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

const chooseRatio = (m, f, logCNf) =>
  m < f ? 0 : Math.exp(logChoose(m, f) - logCNf);

// ---------------------------------------------------------------------------

function isBridgeTopicCandidate(kw) {
  const s = String(kw || '').trim();
  if (s.length < 3) return false;
  if (!/[A-Za-z0-9]/.test(s)) return false;
  if (/^[\W_]+$/.test(s)) return false;
  const low = s.toLowerCase();
  if ([
    'google scholar',
    'web of science',
    'scopus',
    'pubmed',
    'crossref',
    'doi',
    'orcid',
    'elsevier',
    'springer',
    'wiley',
    'taylor & francis',
    'proposed method',
    'proposed approach',
  ].includes(low)) return false;
  if (low.includes('google') || low.includes('academic google')) return false;
  if (low.includes('proposed method') || low.includes('proposed approach')) return false;
  if (/^(article|review|study|research|analysis|method|methods|result|results)$/i.test(s)) return false;
  return true;
}

function build() {
  const rows = readTsv(path.join(SOURCE_DIR, 'data.tsv'));
  const keyRows = readTsv(path.join(SOURCE_DIR, 'keys.tsv'));

  const keyName = new Map();
  for (const r of keyRows) {
    const id = Number(r.index);
    if (Number.isFinite(id)) keyName.set(id, r.key ?? '');
  }

  const N = rows.length;                       // 85,643 clusters

  // 每簇扫描一次，同时喂给两边。
  const domTopicArticles = new Map();          // domainId -> Map(keyword, 文章数之和)
  const domKeywords = new Map();               // domainId -> Set(keyword)   全局去重
  const keywordFreq = new Map();               // keyword -> 含它的 cluster 数
  const domClusters = new Map();
  const domArticles = new Map();
  const domKeywordOccurrences = new Map();
  let duplicateKeywordsInsideCluster = 0;
  let missingKeyIds = 0;

  // 珊瑚图要的是**逐簇**的数据（位置 + 学科 + 文章数 + 概念表），而旭日图只要聚合值。
  // 所以这里顺手把每一簇留下了 —— 留着的是**关键词名字**，因为全局词表（以及名字到下标的
  // 映射 topicId）要等这一圈跑完才能定下来。存的是一组指针，不是 42 万个新字符串。
  const clusterRows = [];

  for (const row of rows) {
    const dom = Number(row.cluster_category) || 0;
    const articles = Number(row.num_recent_articles) || 0;
    const kept = [];

    domClusters.set(dom, (domClusters.get(dom) || 0) + 1);
    domArticles.set(dom, (domArticles.get(dom) || 0) + articles);

    let perDom = domTopicArticles.get(dom);
    if (!perDom) { perDom = new Map(); domTopicArticles.set(dom, perDom); }
    let kwSet = domKeywords.get(dom);
    if (!kwSet) { kwSet = new Set(); domKeywords.set(dom, kwSet); }

    const ids = (row.key_concepts || '').split(',').map(Number).filter(Number.isFinite);
    const seenHere = new Set();
    for (const id of ids) {
      const name = keyName.get(id);
      if (name === undefined) { missingKeyIds++; continue; }
      if (!name) continue;
      if (seenHere.has(name)) { duplicateKeywordsInsideCluster++; continue; }
      seenHere.add(name);

      perDom.set(name, (perDom.get(name) || 0) + articles);
      kwSet.add(name);
      keywordFreq.set(name, (keywordFreq.get(name) || 0) + 1);
      domKeywordOccurrences.set(dom, (domKeywordOccurrences.get(dom) || 0) + 1);
      kept.push(name);
    }
    // 过滤之后的保留结果 —— 和旭日图的 arcs 用的是同一套过滤，所以两边的账对得上。
    clusterRows.push({ x: Number(row.x), y: Number(row.y), dom, articles, names: kept });
  }

  // ---------------------------------------------------------------- sunburst
  //
  // 全局词表：按总权重降序（跨 domain 累加），同权重按字符串 —— 完全确定，重跑逐字节相同。
  const globalWeight = new Map();
  for (const perDom of domTopicArticles.values()) {
    for (const [kw, w] of perDom) globalWeight.set(kw, (globalWeight.get(kw) || 0) + w);
  }
  const topics = [...globalWeight.keys()].sort((a, b) => {
    const d = globalWeight.get(b) - globalWeight.get(a);
    return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
  });
  const topicId = new Map(topics.map((t, i) => [t, i]));

  for (const t of topics) {
    if (t.includes('\n')) throw new Error(`keyword contains a newline: ${JSON.stringify(t)}`);
  }

  // 弧：按 (domain, 权重降序, topicId) 排 —— domain 内连续、重弧在前，渲染侧可以直接
  // 按这个顺序累积角度，重弧自然压在 263,881 条权重 1 的底子上。
  const arcs = [];
  const domains = [];
  let totalArcWeight = 0;
  let maxArcWeight = 0;

  for (const dom of CATEGORY_IDS) {
    const perDom = domTopicArticles.get(dom) || new Map();
    const list = [...perDom.entries()]
      .map(([kw, w]) => ({ id: topicId.get(kw), w }))
      .sort((a, b) => (b.w - a.w) || (a.id - b.id));
    for (const a of list) {
      arcs.push(dom, a.id, a.w);
      totalArcWeight += a.w;
      if (a.w > maxArcWeight) maxArcWeight = a.w;
    }
    domains.push({
      id: dom,
      name: categoryName(dom),
      color: CATEGORIES[dom]?.atlasColor || '#e5e7eb',
      arcCount: list.length,
      distinctKeywords: (domKeywords.get(dom) || new Set()).size,
      keywordOccurrences: domKeywordOccurrences.get(dom) || 0,
      clusters: domClusters.get(dom) || 0,
      articles: domArticles.get(dom) || 0,
      arcWeight: list.reduce((s, a) => s + a.w, 0),
    });
  }

  const sunburst = {
    meta: {
      source: 'map_of_science',
      unit: 'article-topic pairs',
      clusterCount: N,
      totalArticles: [...domArticles.values()].reduce((a, b) => a + b, 0),
      topicCount: topics.length,
      arcCount: arcs.length / 3,
      arcWeightTotal: totalArcWeight,
      maxArcWeight,
      categoryCount: CATEGORY_IDS.length,
    },
    categories: CATEGORY_IDS.map((id) => ({
      id,
      name: categoryName(id),
      color: CATEGORIES[id]?.atlasColor || '#e5e7eb',
    })),
    domains,
    // 换行连接的单个字符串，不是 JSON 数组 —— 省掉 274,422 组引号与逗号。
    topics: topics.join('\n'),
    arcs,
  };

  // --------------------------------------------------------------- interdisc
  const nodes = CATEGORY_IDS.map((id) => ({
    id,
    name: categoryName(id),
    color: CATEGORIES[id]?.atlasColor || '#e5e7eb',
    clusters: domClusters.get(id) || 0,
    articles: domArticles.get(id) || 0,
    distinctKeywords: (domKeywords.get(id) || new Set()).size,
    keywordOccurrences: domKeywordOccurrences.get(id) || 0,
  }));

  const freqHist = new Map();
  let maxF = 0;
  for (const f of keywordFreq.values()) {
    freqHist.set(f, (freqHist.get(f) || 0) + 1);
    if (f > maxF) maxF = f;
  }
  const logCNf = new Float64Array(maxF + 1);
  for (let f = 0; f <= maxF; f++) logCNf[f] = logChoose(N, f);

  // 每对边的期望共享数 = Σ_f hist[f] · P(a, b, f)，只算 1,049 个数，不逐关键词展开。
  function expectedShared(a, b) {
    let sum = 0;
    for (const [f, hist] of freqHist) {
      const p = 1 - chooseRatio(N - a, f, logCNf[f])
                  - chooseRatio(N - b, f, logCNf[f])
                  + chooseRatio(N - a - b, f, logCNf[f]);
      sum += hist * p;
    }
    return sum;
  }

  const edges = [];
  for (let i = 0; i < CATEGORY_IDS.length; i++) {
    for (let j = i + 1; j < CATEGORY_IDS.length; j++) {
      const A = CATEGORY_IDS[i], B = CATEGORY_IDS[j];
      const ka = domKeywords.get(A) || new Set();
      const kb = domKeywords.get(B) || new Set();
      const [small, big] = ka.size <= kb.size ? [ka, kb] : [kb, ka];
      let shared = 0;
      for (const kw of small) if (big.has(kw)) shared++;

      const union = ka.size + kb.size - shared;
      // expected 只留两位小数（它是个展示值），但 lift 必须由**同一个**两位小数推出来 ——
      // 否则文件里的两个字段对不上：读的人拿 shared/expected 算一遍，得到的是另一个 lift。
      // 实测差在第 6 位，肉眼看不见，但「文件内部自洽」是一条能被测的性质，不该白丢。
      const expected = Math.round(expectedShared(domClusters.get(A) || 0, domClusters.get(B) || 0) * 100) / 100;
      edges.push({
        a: A, b: B, shared, union,
        jaccard: union > 0 ? shared / union : 0,
        expected,
        lift: expected > 0 ? shared / expected : 0,
      });
    }
  }

  const bridgeTopics = [];
  const seenBridgeTopic = new Set();
  for (const kw of topics) {
    if (!isBridgeTopicCandidate(kw)) continue;
    const bridgeKey = String(kw).trim().toLowerCase();
    if (seenBridgeTopic.has(bridgeKey)) continue;
    seenBridgeTopic.add(bridgeKey);
    const domainsForKeyword = [];
    let totalWeight = 0;
    for (const dom of CATEGORY_IDS) {
      const w = (domTopicArticles.get(dom) || new Map()).get(kw) || 0;
      if (w > 0) {
        domainsForKeyword.push({ id: dom, weight: w });
        totalWeight += w;
      }
    }
    if (domainsForKeyword.length < 2) continue;
    const entropyDenom = Math.log(domainsForKeyword.length);
    let entropy = 1;
    if (entropyDenom > 0) {
      entropy = 0;
      for (const d of domainsForKeyword) {
        const p = d.weight / totalWeight;
        entropy -= p * Math.log(p);
      }
      entropy /= entropyDenom;
    }
    const score = Math.log1p(totalWeight) * Math.pow(domainsForKeyword.length, 1.4) * (0.35 + entropy * 0.65);
    bridgeTopics.push({
      id: topicId.get(kw),
      topic: kw,
      domains: domainsForKeyword.sort((a, b) => b.weight - a.weight),
      totalWeight,
      domainCount: domainsForKeyword.length,
      entropy: Math.round(entropy * 10000) / 10000,
      score: Math.round(score * 10000) / 10000,
    });
  }
  bridgeTopics.sort((a, b) => (b.score - a.score) || (b.totalWeight - a.totalWeight) || (a.topic < b.topic ? -1 : 1));

  // 关键词频次直方图：freqHist[f] = 恰好出现在 f 个 cluster 里的关键词个数。
  // 它进 JSON 不是为了画图，是为了让 check-interdisc.mjs 能**独立重算**每条边的
  // expected / lift —— 否则那句「55 对 lift 全部 < 1」就只能听构建脚本自己说。
  const freqHistArray = new Array(maxF + 1).fill(0);
  for (const [f, n] of freqHist) freqHistArray[f] = n;

  const interdisc = {
    meta: {
      source: 'map_of_science',
      clusterCount: N,
      totalArticles: nodes.reduce((s, n) => s + n.articles, 0),
      totalKeywordOccurrences: [...domKeywordOccurrences.values()].reduce((a, b) => a + b, 0),
      globalDistinctKeywords: keywordFreq.size,
      edgeCount: edges.length,
      // 零模型参数，图例里要写明「lift 是跟随机重排比，不是跟独立假设比」
      nullModel: 'cluster-to-discipline label permutation',
      maxKeywordFrequency: maxF,
    },
    // 索引 = 频次 f，值 = 频次恰为 f 的关键词个数。freqHist[1] = 237,325。
    freqHist: freqHistArray,
    nodes,
    edges,
    bridgeTopics: bridgeTopics.slice(0, 420),
  };

  // ------------------------------------------------------------------- coral
  //
  // 珊瑚图往下走一层，要的是 cluster 本身：位置（真实降维坐标）、学科、文章数、
  // 以及它挂着的那些概念。旭日图只需要聚合值，所以这一层是这次新拿出来的。
  //
  // 结构用 CSR 三元组：`cOff[i] .. cOff[i+1]` 就是第 i 簇的概念在 `cIdx` 里的那一段。
  // 不写成「每簇一个小数组」是因为 JSON 里那会是 85,643 组方括号 —— 同样的数字，
  // 多出几 MB 的标点，而切片本身是 O(1) 的。
  //
  // 概念存**下标**不存名字：全局词表 sunburst-data.json 里已经有了，再抄一份
  // 274,422 个字符串只是把同一个词表存两遍。名字 → 下标在这次构建里做完，之后
  // 两个文件共用同一套下标（这也是为什么珊瑚的数据文件必须跟旭日图同源生成）。
  const round2 = (v) => Math.round(v * 100) / 100;
  const cx = new Array(N);
  const cy = new Array(N);
  const cd = new Array(N);
  const ca = new Array(N);
  const cOff = new Array(N + 1);
  const cIdx = [];

  for (let i = 0; i < N; i++) {
    const r = clusterRows[i];
    cx[i] = round2(r.x);
    cy[i] = round2(r.y);
    cd[i] = r.dom;
    ca[i] = r.articles;
    cOff[i] = cIdx.length;
    for (const name of r.names) cIdx.push(topicId.get(name));
  }
  cOff[N] = cIdx.length;

  const coral = {
    meta: {
      source: 'map_of_science',
      clusterCount: N,
      totalArticles: sunburst.meta.totalArticles,
      conceptPairs: cIdx.length,
      topicCount: topics.length,
      categoryCount: CATEGORY_IDS.length,
      // 生长层的吸引子是聚合出来的（挨得极近的 cluster 合成一个点）。这是这张图里
      // 唯一不是原样呈现数据的地方，所以写在数据里，别让渲染侧自己猜一个说法出去。
      note: 'cluster x/y are the raw map coordinates; the growth layer aggregates them into attractors',
    },
    categories: sunburst.categories,
    // 四条平行数组，不是 [x,y,dom,articles] 的数组之数组 —— 同长度、同下标，读起来
    // 也比 85,643 个四元组便宜。
    cl: { x: cx, y: cy, dom: cd, articles: ca },
    cOff,
    cIdx,
  };

  // -------------------------------------------------------------- 自检 + 写出
  const fails = [];
  const check = (cond, msg) => { if (!cond) fails.push(msg); };

  const arcCount = arcs.length / 3;
  let arcWeight = 0;
  for (let i = 2; i < arcs.length; i += 3) arcWeight += arcs[i];
  const domArcWeight = domains.reduce((s, d) => s + d.arcWeight, 0);
  const domArcCount = domains.reduce((s, d) => s + d.arcCount, 0);

  // 两个总量都要钉住 —— 它们差 300 倍，误用哪一个都会让旭日图的角度全错，
  // 而且错得**看不出来**（每一条弧的比例都对，只有总量不对，而总量正是环 1 的长度）。
  const occurrences = interdisc.meta.totalKeywordOccurrences;
  check(arcCount === 299286, `sunburst: ${arcCount} arcs, expected 299,286`);
  check(arcWeight === 129731896, `sunburst: article-topic weight ${arcWeight}, expected 129,731,896`);
  check(occurrences === 426647, `sunburst: keyword occurrences ${occurrences}, expected 426,647`);
  check(domArcCount === arcCount, `sunburst: per-domain arcs ${domArcCount} != ${arcCount}`);
  check(domArcWeight === arcWeight, `sunburst: per-domain weight ${domArcWeight} != ${arcWeight}`);
  check(topics.length === 274422, `sunburst: ${topics.length} topics, expected 274,422`);
  check(new Set(topics).size === topics.length, 'sunburst: topic dictionary has duplicates');
  check(edges.length === 55, `interdisc: ${edges.length} edges, expected 55`);
  check(nodes.reduce((s, n) => s + n.clusters, 0) === N, 'interdisc: node clusters do not sum to N');
  check(freqHist.get(1) === 237325, `frequency-1 keywords ${freqHist.get(1)}, expected 237,325`);
  check(freqHistArray.reduce((a, b) => a + b, 0) === topics.length,
        'frequency histogram accounts for every distinct keyword');
  check(freqHistArray[0] === 0, 'no keyword has frequency 0');
  for (const e of edges) {
    const re = e.shared / e.union;
    check(Math.abs(re - e.jaccard) < 1e-12, `edge ${e.a}-${e.b}: jaccard does not match shared/union`);
  }
  for (const e of edges) {
    check(e.shared > 0, `edge ${e.a}-${e.b}: zero shared keywords`);
    check(e.lift < 1, `edge ${e.a}-${e.b}: lift ${e.lift.toFixed(3)} not below 1`);
  }

  // ---- coral
  //
  // 这几条钉的是「珊瑚图拿到的是完整的一层，不是抽样」。下游的生长算法会把 cluster
  // 聚合成吸引子，聚合是**一一映射**这件事只能在这里验：少一部分 cluster，画出来
  // 的珊瑚照样好看，只是有一块数据凭空消失了 —— 那种错看图看不出来。
  const coralArticles = ca.reduce((a, b) => a + b, 0);
  check(N === 85643, `coral: ${N} clusters, expected 85,643`);
  check(coralArticles === 25968533, `coral: cluster articles ${coralArticles}, expected 25,968,533`);
  check(coralArticles === sunburst.meta.totalArticles,
        `coral: cluster articles ${coralArticles} != sunburst total ${sunburst.meta.totalArticles}`);
  check(cIdx.length === 426647, `coral: ${cIdx.length} (cluster, concept) pairs, expected 426,647`);
  check(cOff.length === N + 1 && cOff[N] === cIdx.length, 'coral: CSR offsets do not close');
  check(cOff[0] === 0, 'coral: CSR does not start at 0');
  {
    let monotone = true, inRange = true;
    for (let i = 0; i < N; i++) if (cOff[i + 1] < cOff[i]) monotone = false;
    for (let k = 0; k < cIdx.length; k++) {
      const v = cIdx[k];
      if (!Number.isInteger(v) || v < 0 || v >= topics.length) { inRange = false; break; }
    }
    check(monotone, 'coral: CSR offsets are not monotone');
    check(inRange, 'coral: a concept index falls outside the topic dictionary');
  }
  // 每个概念都至少被一簇引用 —— 词表是**从这些 cluster 里**建的，所以漏掉任何一个都
  // 意味着两边的账对不上（比如某个概念只在被过滤的那条路上出现过）。
  check(new Set(cIdx).size === topics.length,
        `coral: only ${new Set(cIdx).size} of ${topics.length} topics are referenced by a cluster`);
  for (const dom of CATEGORY_IDS) {
    let n = 0;
    for (let i = 0; i < N; i++) if (cd[i] === dom) n++;
    check(n === (domClusters.get(dom) || 0), `coral: discipline ${dom} has ${n} clusters, sunburst says ${domClusters.get(dom) || 0}`);
  }
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(cx[i]) || !Number.isFinite(cy[i])) { check(false, `coral: cluster ${i} has a non-finite coordinate`); break; }
    if (!Number.isInteger(cd[i]) || cd[i] < 0 || cd[i] >= CATEGORY_IDS.length) { check(false, `coral: cluster ${i} has an out-of-range discipline`); break; }
    if (!Number.isFinite(ca[i]) || ca[i] < 0) { check(false, `coral: cluster ${i} has a bad article count`); break; }
    if (cOff[i + 1] === cOff[i]) { check(false, `coral: cluster ${i} has no concepts after filtering`); break; }
  }

  // 自检不过就不落盘 —— 免得留下一个半对的数据文件被下游当成真的。
  if (fails.length) {
    console.error('\nFAIL (nothing written)\n' + fails.join('\n'));
    process.exit(1);
  }

  fs.writeFileSync(path.join(WEB_DIR, 'sunburst-data.json'), JSON.stringify(sunburst));
  fs.writeFileSync(path.join(WEB_DIR, 'interdisc-data.json'), JSON.stringify(interdisc));
  fs.writeFileSync(path.join(WEB_DIR, 'coral-data.json'), JSON.stringify(coral));

  const sz = (f) => (fs.statSync(path.join(WEB_DIR, f)).size / 1048576).toFixed(2) + ' MB';

  console.log(`rows                ${N.toLocaleString()}`);
  console.log(`clusters            ${N.toLocaleString()}`);
  console.log(`articles            ${sunburst.meta.totalArticles.toLocaleString()}`);
  console.log(`distinct keywords   ${topics.length.toLocaleString()}`);
  console.log(`arcs                ${arcCount.toLocaleString()}   weight ${arcWeight.toLocaleString()}`);
  console.log(`max arc weight      ${sunburst.meta.maxArcWeight.toLocaleString()}`);
  console.log(`f=1 keywords        ${(freqHist.get(1) || 0).toLocaleString()}  (${((freqHist.get(1) || 0) / topics.length * 100).toFixed(1)}%)`);
  console.log(`edges               ${edges.length}`);
  console.log('');
  console.log('id  name              clusters   articles  distinctKw   arcs   arcWeight');
  for (const d of domains) {
    console.log(`${String(d.id).padStart(2)}  ${d.name.padEnd(17)} ${String(d.clusters).padStart(8)} ${String(d.articles).padStart(11)} ${String(d.distinctKeywords).padStart(11)} ${String(d.arcCount).padStart(6)} ${String(d.arcWeight).padStart(11)}`);
  }
  console.log('');
  console.log('top 5 edges by Jaccard:');
  for (const e of [...edges].sort((x, y) => y.jaccard - x.jaccard).slice(0, 5)) {
    console.log(`  ${nodes[e.a].name} <-> ${nodes[e.b].name}: shared ${e.shared}, jaccard ${(e.jaccard * 100).toFixed(2)}%, expected ${e.expected}, lift ${e.lift.toFixed(3)}`);
  }
  const lifts = edges.map((e) => e.lift).sort((x, y) => x - y);
  console.log(`lift range ${lifts[0].toFixed(3)} .. ${lifts[lifts.length - 1].toFixed(3)}, median ${lifts[27].toFixed(3)}, pairs above 1: ${lifts.filter((l) => l > 1).length}`);
  console.log('');
  console.log(`wrote web/sunburst-data.json    ${sz('sunburst-data.json')}`);
  console.log(`wrote web/interdisc-data.json   ${sz('interdisc-data.json')}`);
  console.log(`wrote web/coral-data.json       ${sz('coral-data.json')}   ${N.toLocaleString()} clusters, ${cIdx.length.toLocaleString()} concept pairs`);
  if (duplicateKeywordsInsideCluster) console.log(`note: ${duplicateKeywordsInsideCluster} repeated keyword ids inside a single cluster (deduped)`);
  if (missingKeyIds) console.log(`note: ${missingKeyIds} key_concepts ids not present in keys.tsv (skipped)`);

  console.log('\nchecks passed');
}

build();
