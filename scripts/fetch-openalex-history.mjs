// 学科演化河流图（Evolution River）的数据：OpenAlex 逐年、按顶层 field 的作品数。
//
// 为什么是 OpenAlex 而不是 map_of_science：map_of_science 的 data.tsv / basic_data.jsonl
// **没有时间字段、也没有引用关系**（本地与上游字段完全相同，逐字段比对过）。所以
// 「学科随时间的兴衰」在那个数据集里根本做不出来。这里是唯一的替代来源。
//
// 这是仓库里唯一的 Node 网络脚本 —— 其余 scripts/*.mjs 全是离线构建器。它跟其它数据构建器
// 同目录同约定（ROOT = process.cwd()，零依赖，Node 18+ 内置 fetch），且不属于 PhilPapers
// 那条线。跑完一次把 web/openalex-history.json 提交成快照，之后**全部离线**，
// 与 Philpapers-API/src/fetch_categories.py 把网络当一次性 bootstrap 的做法一致。
//
// 用法：
//   OPENALEX_MAILTO=you@example.com node scripts/fetch-openalex-history.mjs
//   node scripts/fetch-openalex-history.mjs --mailto=you@example.com
//
// 礼貌池（polite pool）需要一个**真实**的联系邮箱。这里不编造地址：没给就照常请求，
// 只是优先级低一些、更容易被限流，脚本会如实报告。
//
// 请求数：1（field 列表）+ 26×2（每 field 两个年份窗口）+ 2（总量两个窗口）+ 1（抽查）= 56
//
// 踩过的坑：**`per-page` 会同时限制 `group_by` 返回的组数**，不只是作品列表的长度。
// 用 `per-page=1` 时 `group_by` 只回了 1 个组，看起来像「数据只有 1 个 field」。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, 'web', 'openalex-history.json');
const API = 'https://api.openalex.org';

const FIRST_YEAR = 1827;
const LAST_YEAR = 2026;
// group_by 上限 200 组，227 年会被截断 —— 所以拆两个窗口，都比 200 小。
const WINDOWS = [[FIRST_YEAR, 1925], [1926, LAST_YEAR]];
const GROUP_PAGE = 200;          // 必须 >= 窗口年数，见上面那个坑
const TIMEOUT_MS = 60000;
const RETRIES = 4;
const DELAY_MS = 140;

const mailto = (process.argv.find((a) => a.startsWith('--mailto=')) || '').slice(9)
  || process.env.OPENALEX_MAILTO || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, params) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (mailto) url.searchParams.set('mailto', mailto);

  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) {
      // 退避：429 优先听 Retry-After，否则指数退避。
      const wait = lastErr?.retryAfter ?? Math.min(30000, 1000 * 2 ** attempt);
      console.log(`    retry ${attempt}/${RETRIES} in ${Math.round(wait / 1000)}s ...`);
      await sleep(wait);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        const e = new Error(`HTTP ${res.status}`);
        e.retryAfter = Number.isFinite(ra) && ra > 0 ? ra * 1000 : null;
        lastErr = e;
        clearTimeout(timer);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      const body = await res.json();
      clearTimeout(timer);
      await sleep(DELAY_MS);
      return body;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err.name === 'AbortError') lastErr = new Error(`timeout after ${TIMEOUT_MS}ms`);
    }
  }
  throw new Error(`gave up on ${url.pathname}${url.search}: ${lastErr?.message || lastErr}`);
}

// group_by 的返回是 [{key, key_display_name, count}, ...]；key 可能是 null（缺失值）。
function groupMap(body) {
  const m = new Map();
  for (const g of body.group_by || []) m.set(g.key, g.count);
  return m;
}

function idOf(url) {
  return typeof url === 'string' ? url.replace(`${API}/`, '') : url;
}

async function main() {
  console.log(`OpenAlex history -> web/openalex-history.json`);
  console.log(`years ${FIRST_YEAR}..${LAST_YEAR}, polite pool mailto: ${mailto || '(none — expect more throttling)'}`);
  console.log('');

  // 1. field 列表（不硬编码 26 个 id —— 分类法变了脚本也不用改）
  console.log('fetching field list ...');
  const fieldsBody = await api('/fields', { 'per-page': 200 });
  const fields = (fieldsBody.results || []).map((f) => ({
    id: idOf(f.id),
    name: f.display_name,
    worksCount: f.works_count ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
  console.log(`  ${fields.length} fields`);

  const YEARS = [];
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) YEARS.push(y);
  const yearIndex = new Map(YEARS.map((y, i) => [y, i]));

  // 2. 每个 field 的逐年计数
  const byField = new Map(fields.map((f) => [f.id, new Array(YEARS.length).fill(0)]));
  let req = 0;
  for (const f of fields) {
    for (const [lo, hi] of WINDOWS) {
      req++;
      const body = await api('/works', {
        filter: `primary_topic.field.id:${f.id},publication_year:${lo}-${hi}`,
        group_by: 'publication_year',
        'per-page': GROUP_PAGE,
      });
      let hit = 0;
      for (const [key, count] of groupMap(body)) {
        const i = yearIndex.get(Number(key));
        if (i === undefined) continue;           // 窗口边界外的年份，忽略
        byField.get(f.id)[i] = count;
        hit++;
      }
      console.log(`  [${String(req).padStart(2)}/56] ${f.name.padEnd(34)} ${lo}-${hi}  ${hit} years`);
    }
  }

  // 3. 每年的**总作品数**（不带 field 过滤）—— 未分类率的分母
  const totalByYear = new Array(YEARS.length).fill(0);
  for (const [lo, hi] of WINDOWS) {
    req++;
    const body = await api('/works', {
      filter: `publication_year:${lo}-${hi}`,
      group_by: 'publication_year',
      'per-page': GROUP_PAGE,
    });
    for (const [key, count] of groupMap(body)) {
      const i = yearIndex.get(Number(key));
      if (i !== undefined) totalByYear[i] = count;
    }
    console.log(`  [${String(req).padStart(2)}/56] TOTAL ${lo}-${hi}`);
  }

  // 4. 逐年求和，未分类 = 总量 − 26 个 field 之和
  const sumByYear = YEARS.map((_, i) => fields.reduce((s, f) => s + byField.get(f.id)[i], 0));
  const unclassifiedByYear = YEARS.map((_, i) => Math.max(0, totalByYear[i] - sumByYear[i]));

  // 5. 抽查一次：直接问 OpenAlex「这一年有多少作品没有 primary field」
  //    如果与相减得到的数对不上，说明 field 列表不完整（比如有第 27 个 field），
  //    那整条未分类带就是错的 —— 宁可报错也不要画一张错的图。
  const checkYear = 2024;
  req++;
  let checkCount = null;
  try {
    const checkBody = await api('/works', {
      filter: `publication_year:${checkYear},primary_topic.field.id:null`,
      'per-page': 1,
    });
    checkCount = checkBody?.meta?.count ?? null;
  } catch (err) {
    // 抽查是加分项，不是前提：它挂了就如实说，不要因此把整份数据丢掉。
    console.log(`    (check request failed: ${err.message})`);
  }
  const derived = unclassifiedByYear[yearIndex.get(checkYear)];
  console.log(`  [${String(req).padStart(2)}/56] CHECK ${checkYear} unclassified: direct ${checkCount?.toLocaleString() ?? 'n/a'} vs derived ${derived.toLocaleString()}`);

  const fails = [];
  if (!fields.length) fails.push('no fields returned');
  if (!totalByYear.some((t) => t > 0)) fails.push('no total works returned');
  const maxTotal = Math.max(...totalByYear);
  if (maxTotal < 1e6) fails.push(`largest year only ${maxTotal} works — API shape likely changed`);
  if (checkCount !== null) {
    const drift = Math.abs(checkCount - derived);
    if (drift > 0) {
      fails.push(`unclassified for ${checkYear}: direct ${checkCount} != derived ${derived} (drift ${drift}) — field list is incomplete`);
    }
  }

  // 6. 最后几年不可信 —— 这是实测出来的，不是猜的。
  //
  //   2012–2024 的未分类率稳定在 3.6%–8.4%；2025 跳到 **24.4%**，2026 跳到 **70.3%**，
  //   同时 2026 的总量虚高到 32,348,291 篇（2024 是 10,872,134）。这不是科学事实的变化，
  //   是 OpenAlex 对**当年**的索引与分类滞后：大批作品已经进了库（带上了 publication_year），
  //   但 primary_topic 还没算出来。
  //
  //   把它照实画进河里会**更**误导 —— 最右一列会变成 70% 的灰带，读者会以为 2026 年
  //   七成研究无法归类。所以河流只画到可信年份为止，被排除的年份连原因一起记进 meta，
  //   原始数字仍然全部保留在文件里，没有丢数据。
  //
  //   判定规则：最后一个「未分类率 ≤ 前十年中位数的两倍」的年份。取中位数而不是均值，
  //   是因为 2021/2022 已经有 8.1%/8.4% 的抬升，均值会被它带偏。
  let lastTrustworthyYear = LAST_YEAR;
  while (lastTrustworthyYear > FIRST_YEAR) {
    const i = yearIndex.get(lastTrustworthyYear);
    if (!totalByYear[i]) { lastTrustworthyYear--; continue; }
    const prior = [];
    for (let y = lastTrustworthyYear - 10; y < lastTrustworthyYear; y++) {
      const j = yearIndex.get(y);
      if (j !== undefined && totalByYear[j]) prior.push(unclassifiedByYear[j] / totalByYear[j]);
    }
    if (prior.length < 5) break;
    prior.sort((a, b) => a - b);
    const median = prior[Math.floor(prior.length / 2)];
    if (unclassifiedByYear[i] / totalByYear[i] <= median * 2) break;
    lastTrustworthyYear--;
  }

  const excludedYears = YEARS.filter((y) => y > lastTrustworthyYear).map((y) => {
    const i = yearIndex.get(y);
    return { year: y, total: totalByYear[i], unclassified: unclassifiedByYear[i] };
  });

  // 7. Top-8 在这里定死（按最后一个可信年份的份额），渲染时不再随过滤变化。
  const topYear = lastTrustworthyYear;
  const share = (f, y) => {
    const i = yearIndex.get(y);
    return totalByYear[i] ? byField.get(f.id)[i] / totalByYear[i] : 0;
  };
  const top8 = [...fields]
    .sort((a, b) => share(b, topYear) - share(a, topYear))
    .slice(0, 8)
    .map((f) => f.id);

  const out = {
    meta: {
      source: 'OpenAlex',
      endpoint: `${API}/works`,
      filterUnit: 'primary_topic.field.id',
      fetched: new Date().toISOString().slice(0, 10),
      mailto: mailto || null,
      firstYear: FIRST_YEAR,
      lastYear: LAST_YEAR,
      // 河流**只画这一段**。lastYear 之后的数据是索引滞后，不是科学事实。见 excludedYears。
      riverFirstYear: FIRST_YEAR,
      riverLastYear: lastTrustworthyYear,
      windows: WINDOWS,
      fieldCount: fields.length,
      top8,
      topYear,
      unclassifiedCheckYear: checkYear,
      unclassifiedDirect: checkCount,
      excludedYears,
      notes: [
        'counts are works per publication_year per primary_topic.field',
        'unclassified = total works that year minus the sum over all fields (works with no primary field)',
        'field taxonomy is fixed over time, and each work has exactly one primary_topic — the data supports birth and rise/fall, not splitting or merging',
        'excludedYears are indexed but not yet classified by OpenAlex (unclassified rate jumps from ~8% to 24% to 70%); they are kept in the arrays but must not be drawn',
      ],
    },
    years: YEARS,
    totalByYear,
    sumFieldsByYear: sumByYear,
    unclassifiedByYear,
    fields: fields.map((f) => ({ id: f.id, name: f.name, byYear: byField.get(f.id) })),
  };

  if (fails.length) {
    console.error('\nFAIL (nothing written)\n' + fails.join('\n'));
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  console.log('');
  console.log(`fields              ${fields.length}`);
  console.log(`years               ${YEARS.length}`);
  console.log(`peak year           ${YEARS[totalByYear.indexOf(maxTotal)]} (${maxTotal.toLocaleString()} works)`);
  console.log(`river draws         ${out.meta.riverFirstYear}..${out.meta.riverLastYear}`);
  for (const e of excludedYears) {
    console.log(`  excluded ${e.year}: ${e.total.toLocaleString()} works, ${(e.unclassified / e.total * 100).toFixed(1)}% unclassified (indexing lag, not science)`);
  }
  console.log(`top-8 chosen by     ${topYear}`);
  console.log('');
  console.log('top 8 by share of ' + topYear + ':');
  for (const id of top8) {
    const f = fields.find((x) => x.id === id);
    console.log(`  ${f.name.padEnd(38)} ${(share(f, topYear) * 100).toFixed(2)}%`);
  }
  console.log('');
  console.log('unclassified rate, sampled:');
  for (const y of [FIRST_YEAR, 1850, 1900, 1950, 1980, 2000, 2010, 2020, 2024, LAST_YEAR]) {
    const i = yearIndex.get(y);
    const pct = totalByYear[i] ? (unclassifiedByYear[i] / totalByYear[i] * 100) : 0;
    console.log(`  ${y}  ${String(totalByYear[i]).padStart(11)} works   unclassified ${pct.toFixed(1).padStart(5)}%`);
  }
  console.log('');
  console.log(`wrote web/openalex-history.json  ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
  console.log('checks passed');
}

main().catch((err) => {
  console.error(`\nFAIL (nothing written)\n${err.message}`);
  process.exit(1);
});
