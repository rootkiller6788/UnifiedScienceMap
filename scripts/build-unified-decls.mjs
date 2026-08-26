import fs from 'node:fs';

const MATH_DATA = 'web/decls.json';
const PHYS_DATA = 'web/physlib-decls.json';
const CSLIB_DATA = 'web/cslib-decls.json';
const SCILEAN_DATA = 'web/scilean-decls.json';
const MATH_HISTORY = 'web/mathlib-history.json';
const PHYS_HISTORY = 'web/physlib-history.json';
const CSLIB_HISTORY = 'web/cslib-history.json';
const SCILEAN_HISTORY = 'web/scilean-history.json';
const OUT = 'web/unified-decls.json';

const math = readJson(MATH_DATA);
const phys = fs.existsSync(PHYS_DATA) ? readJson(PHYS_DATA) : null;
const cslib = fs.existsSync(CSLIB_DATA) ? readJson(CSLIB_DATA) : null;
const scilean = fs.existsSync(SCILEAN_DATA) ? readJson(SCILEAN_DATA) : null;
const mathHistory = fs.existsSync(MATH_HISTORY) ? readJson(MATH_HISTORY) : null;
const physHistory = fs.existsSync(PHYS_HISTORY) ? readJson(PHYS_HISTORY) : null;
const cslibHistory = fs.existsSync(CSLIB_HISTORY) ? readJson(CSLIB_HISTORY) : null;
const scileanHistory = fs.existsSync(SCILEAN_HISTORY) ? readJson(SCILEAN_HISTORY) : null;

const unified = emptyUnified();
appendDataset(unified, math, {
  sourceRepo: 'mathlib',
  defaultPackage: 'Mathlib',
  domain: 'Math',
  history: mathHistory,
});

if (phys) {
  appendDataset(unified, phys, {
    sourceRepo: 'physlib',
    defaultPackage: 'Physlib',
    domain: 'Physics',
    history: physHistory,
  });
}

if (cslib) {
  appendDataset(unified, cslib, {
    sourceRepo: 'cslib',
    defaultPackage: 'Cslib',
    domain: 'Computer Science',
    history: cslibHistory,
  });
}

if (scilean) {
  appendDataset(unified, scilean, {
    sourceRepo: 'scilean',
    defaultPackage: 'SciLean',
    domain: 'Scientific Computing',
    history: scileanHistory,
  });
}

recomputeDirs(unified);
unified.meta.generated = new Date().toISOString();
unified.meta.conceptCount = unified.nodes.label.length;
unified.meta.nodeCount = unified.nodes.label.length;
unified.meta.edgeCount = unified.edges.length;
unified.meta.dirCount = unified.dirs.length;
unified.meta.sources = [
  'mathlib',
  ...(phys ? ['physlib'] : []),
  ...(cslib ? ['cslib'] : []),
  ...(scilean ? ['scilean'] : []),
];
unified.meta.layout = 'unified-system-map';
unified.meta.history = {
  mathlib: !!mathHistory,
  physlib: !!physHistory,
  cslib: !!cslibHistory,
  scilean: !!scileanHistory,
};

fs.writeFileSync(OUT, JSON.stringify(unified));
console.log(`wrote ${OUT}: ${unified.nodes.label.length} nodes, ${unified.edges.length} edges, ${unified.dirs.length} dirs`);

function emptyUnified() {
  return {
    meta: {},
    dirs: [],
    domains: [],
    nodes: {
      label: [],
      kind: [],
      dir: [],
      module: [],
      depth: [],
      x: [],
      y: [],
      year: [],
      sourceRepo: [],
      sourcePackage: [],
      domain: [],
      subject: [],
      createdAt: [],
      lastTouchedAt: [],
      commitCount: [],
      firstAuthor: [],
      contributors: [],
    },
    edges: [],
    githubContributions: {
      repos: {},
      authors: {},
    },
  };
}

function appendDataset(out, data, opts) {
  const offset = out.nodes.label.length;
  const n = data.nodes.label.length;
  for (const [s, t] of data.edges || []) out.edges.push([s + offset, t + offset]);
  for (const edge of data.externalEdges || []) {
    if (edge.sourceRepo === 'mathlib') out.edges.push([edge.source, edge.target + offset]);
  }

  for (let i = 0; i < n; i++) {
    const sourcePackage = data.nodes.source?.[i] || packageFromModule(data.nodes.module[i], opts.defaultPackage);
    const h = opts.history?.nodes;
    out.nodes.label.push(data.nodes.label[i]);
    out.nodes.kind.push(data.nodes.kind[i]);
    out.nodes.dir.push(data.nodes.dir[i]);
    out.nodes.module.push(data.nodes.module[i]);
    out.nodes.depth.push(data.nodes.depth[i]);
    out.nodes.x.push(data.nodes.x[i]);
    out.nodes.y.push(data.nodes.y[i]);
    out.nodes.year.push(data.nodes.year[i]);
    out.nodes.sourceRepo.push(opts.sourceRepo);
    out.nodes.sourcePackage.push(sourcePackage);
    out.nodes.domain.push(opts.domain);
    out.nodes.subject.push(data.nodes.dir[i]);
    out.nodes.createdAt.push(h?.createdAt?.[i] ?? null);
    out.nodes.lastTouchedAt.push(h?.lastTouchedAt?.[i] ?? null);
    out.nodes.commitCount.push(h?.commitCount?.[i] ?? 0);
    out.nodes.firstAuthor.push(h?.firstAuthor?.[i] ?? null);
    out.nodes.contributors.push(h?.contributors?.[i] ?? []);
  }

  out.githubContributions.repos[opts.sourceRepo] = opts.history?.meta || null;
}

function recomputeDirs(out) {
  const byName = new Map();
  for (let i = 0; i < out.nodes.label.length; i++) {
    const name = out.nodes.dir[i];
    let d = byName.get(name);
    if (!d) {
      d = { name, count: 0, sx: 0, sy: 0, sd: 0, domains: new Map() };
      byName.set(name, d);
    }
    d.count++;
    d.sx += out.nodes.x[i];
    d.sy += out.nodes.y[i];
    d.sd += out.nodes.depth[i] || 0;
    d.domains.set(out.nodes.domain[i], (d.domains.get(out.nodes.domain[i]) || 0) + 1);
  }
  out.dirs = [...byName.values()]
    .map((d) => ({
      name: d.name,
      count: d.count,
      cx: d.sx / d.count,
      cy: d.sy / d.count,
      meanDepthY: d.sd / d.count,
      domains: Object.fromEntries(d.domains),
    }))
    .sort((a, b) => a.cx - b.cx || a.name.localeCompare(b.name));

  const domains = new Map();
  const authors = new Map();
  for (let i = 0; i < out.nodes.domain.length; i++) {
    domains.set(out.nodes.domain[i], (domains.get(out.nodes.domain[i]) || 0) + 1);
    for (const name of out.nodes.contributors[i] || []) {
      let a = authors.get(name);
      if (!a) {
        a = { nodeCount: 0, domains: new Map(), subjects: new Map(), repos: new Map() };
        authors.set(name, a);
      }
      a.nodeCount++;
      a.domains.set(out.nodes.domain[i], (a.domains.get(out.nodes.domain[i]) || 0) + 1);
      a.subjects.set(out.nodes.subject[i], (a.subjects.get(out.nodes.subject[i]) || 0) + 1);
      a.repos.set(out.nodes.sourceRepo[i], (a.repos.get(out.nodes.sourceRepo[i]) || 0) + 1);
    }
  }
  out.domains = [...domains.entries()].map(([name, count]) => ({ name, count }));
  out.githubContributions.authors = Object.fromEntries(
    [...authors.entries()]
      .sort((a, b) => b[1].nodeCount - a[1].nodeCount || a[0].localeCompare(b[0]))
      .map(([name, a]) => [name, {
        nodeCount: a.nodeCount,
        repos: topEntries(a.repos),
        domains: topEntries(a.domains),
        subjects: topEntries(a.subjects, 8),
      }]),
  );
}

function topEntries(map, limit = 5) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit));
}

function packageFromModule(module, fallback) {
  return module?.split('.')?.[0] || fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
