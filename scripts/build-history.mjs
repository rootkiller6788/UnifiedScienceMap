import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const dataPath = args.data;
const repoRoot = args.repo;
const outPath = args.out;

if (!dataPath || !repoRoot || !outPath) {
  console.error('Usage: node scripts/build-history.mjs --data web/decls.json --repo . --out web/mathlib-history.json');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const modules = [...new Set(data.nodes.module)].filter(Boolean);
const fileToModule = new Map();
for (const module of modules) {
  fileToModule.set(module.split('.').join('/').toLowerCase() + '.lean', module);
}

const result = spawnSync('git', [
  '-c',
  `safe.directory=${path.resolve(repoRoot).replace(/\\/g, '/')}`,
  '-C',
  repoRoot,
  'log',
  '--format=@@@%H%x09%ct%x09%an',
  '--name-only',
  '--',
  '*.lean',
], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const moduleHistory = new Map();
let current = null;
let repoCommitCount = 0;
for (const raw of result.stdout.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith('@@@')) {
    const [, ts, author] = line.slice(3).split('\t');
    current = { ts: Number(ts), author: author || 'Unknown' };
    repoCommitCount++;
    continue;
  }
  if (!current || !line.endsWith('.lean')) continue;
  const module = fileToModule.get(line.replace(/\\/g, '/').toLowerCase());
  if (!module) continue;
  const h = ensure(moduleHistory, module);
  if (!h.createdAt || current.ts < h.createdAt) {
    h.createdAt = current.ts;
    h.firstAuthor = current.author;
  }
  h.lastTouchedAt = Math.max(h.lastTouchedAt || 0, current.ts);
  h.commitCount++;
  h.contributors.set(current.author, (h.contributors.get(current.author) || 0) + 1);
}

const moduleOut = {};
for (const module of modules) {
  const h = moduleHistory.get(module);
  if (!h) continue;
  moduleOut[module] = {
    createdAt: iso(h.createdAt),
    lastTouchedAt: iso(h.lastTouchedAt),
    commitCount: h.commitCount,
    firstAuthor: h.firstAuthor,
    mainContributors: topContributors(h.contributors),
  };
}

const n = data.nodes.label.length;
const nodes = {
  createdAt: new Array(n),
  lastTouchedAt: new Array(n),
  commitCount: new Array(n),
  firstAuthor: new Array(n),
  contributors: new Array(n),
};

let matchedNodes = 0;
for (let i = 0; i < n; i++) {
  const h = moduleOut[data.nodes.module[i]];
  if (h) matchedNodes++;
  nodes.createdAt[i] = h?.createdAt || null;
  nodes.lastTouchedAt[i] = h?.lastTouchedAt || null;
  nodes.commitCount[i] = h?.commitCount || 0;
  nodes.firstAuthor[i] = h?.firstAuthor || null;
  nodes.contributors[i] = h?.mainContributors?.map((c) => c.name) || [];
}

const out = {
  meta: {
    generated: new Date().toISOString(),
    repoRoot: path.resolve(repoRoot),
    sourceData: dataPath,
    nodeCount: n,
    moduleCount: modules.length,
    matchedModules: Object.keys(moduleOut).length,
    unmatchedModules: modules.length - Object.keys(moduleOut).length,
    matchedNodes,
    repoCommitCount,
  },
  modules: moduleOut,
  nodes,
};

fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath}: ${matchedNodes}/${n} nodes, ${Object.keys(moduleOut).length}/${modules.length} modules`);

function ensure(map, key) {
  let value = map.get(key);
  if (!value) {
    value = { createdAt: 0, lastTouchedAt: 0, commitCount: 0, firstAuthor: null, contributors: new Map() };
    map.set(key, value);
  }
  return value;
}

function topContributors(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, commits]) => ({ name, commits }));
}

function iso(ts) {
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1];
    i++;
  }
  return out;
}
