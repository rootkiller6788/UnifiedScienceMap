import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES, CATEGORY_IDS, categoryName } from './science-categories.mjs';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'map_of_science', 'asset');
const OUT_FILE = path.join(ROOT, 'web', 'science-atlas-data.json');
const WORLD_W = 1600;
const WORLD_H = 900;
const PAD_X = 110;
const PAD_Y = 70;
const GRID_W = 180;
const GRID_H = 100;

// 学科名与颜色的 id 映射在 ./science-categories.mjs —— 与 build-science-views-data.mjs 共用。
// 这里原来是自己一份**按位置**索引的数组，顺序与数据集的 cluster_category 分配不符，
// 11 个名字里 10 个是错的（见那个文件的头注释）。

function readTsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split('\t');
  return lines.map((line) => {
    const cols = line.split('\t');
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? '';
    return row;
  });
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function quantile(values, q) {
  const arr = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const p = (arr.length - 1) * q;
  const i = Math.floor(p);
  const f = p - i;
  return arr[i] * (1 - f) + arr[Math.min(i + 1, arr.length - 1)] * f;
}

function scalePoint(row, bounds) {
  const x = Number(row.x);
  const y = Number(row.y);
  const nx = (x - bounds.minX) / Math.max(1e-9, bounds.maxX - bounds.minX);
  const ny = (y - bounds.minY) / Math.max(1e-9, bounds.maxY - bounds.minY);
  return {
    x: PAD_X + nx * (WORLD_W - PAD_X * 2),
    y: WORLD_H - PAD_Y - ny * (WORLD_H - PAD_Y * 2),
  };
}

function makeLabelMap() {
  const labels = new Map();
  const file = path.join(SOURCE_DIR, 'labels.tsv');
  if (!fs.existsSync(file)) return labels;
  for (const row of readTsv(file)) {
    const id = Number(row.cluster_id);
    const label = (row.label || '').trim();
    if (Number.isFinite(id) && label && id < 900000) labels.set(id, label);
  }
  return labels;
}

function makeKeyMap() {
  const keys = new Map();
  const file = path.join(SOURCE_DIR, 'keys.tsv');
  if (!fs.existsSync(file)) return keys;
  for (const row of readTsv(file)) {
    const id = Number(row.index);
    const key = (row.key || '').trim();
    if (Number.isFinite(id) && key) keys.set(id, key);
  }
  return keys;
}

function build() {
  const rows = readTsv(path.join(SOURCE_DIR, 'data.tsv'));
  const labels = makeLabelMap();
  const keys = makeKeyMap();
  const xs = rows.map((r) => Number(r.x));
  const ys = rows.map((r) => Number(r.y));
  const articles = rows.map((r) => Number(r.num_recent_articles));
  const growth = rows.map((r) => Number(r.growth_rating));
  const bounds = {
    minX: quantile(xs, 0.002),
    maxX: quantile(xs, 0.998),
    minY: quantile(ys, 0.002),
    maxY: quantile(ys, 0.998),
  };
  const maxArticles = Math.max(...articles);
  const cells = new Map();
  const categoryStats = new Map();
  const points = [];

  for (const row of rows) {
    const clusterId = Number(row.cluster_id);
    const p = scalePoint(row, bounds);
    const articleCount = Number(row.num_recent_articles) || 0;
    const growthRating = Number(row.growth_rating) || 0;
    const category = Number(row.cluster_category) || 0;
    const label = labels.get(clusterId) || '';
    const keyConcepts = (row.key_concepts || '').split(',').slice(0, 5).map(Number).filter(Number.isFinite);
    const topic = keyConcepts.map((id) => keys.get(id)).filter(Boolean).slice(0, 2).join(' / ');
    const item = {
      id: clusterId,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      articles: articleCount,
      growth: Math.round(growthRating * 100) / 100,
      category,
      label,
      topic,
      keyConcepts,
    };
    points.push(item);

    const gx = Math.max(0, Math.min(GRID_W - 1, Math.floor((item.x / WORLD_W) * GRID_W)));
    const gy = Math.max(0, Math.min(GRID_H - 1, Math.floor((item.y / WORLD_H) * GRID_H)));
    const ck = `${gx},${gy}`;
    let cell = cells.get(ck);
    if (!cell) {
      cell = { x: gx, y: gy, count: 0, articles: 0, growthMass: 0, topCategory: category, categories: new Map() };
      cells.set(ck, cell);
    }
    cell.count += 1;
    cell.articles += articleCount;
    cell.growthMass += growthRating * Math.sqrt(Math.max(1, articleCount));
    cell.categories.set(category, (cell.categories.get(category) || 0) + articleCount);

    let stat = categoryStats.get(category);
    if (!stat) {
      stat = { id: category, name: categoryName(category), color: CATEGORIES[category]?.atlasColor || '#e5e7eb', count: 0, articles: 0, growthMass: 0 };
      categoryStats.set(category, stat);
    }
    stat.count += 1;
    stat.articles += articleCount;
    stat.growthMass += growthRating * Math.sqrt(Math.max(1, articleCount));
  }

  const maxCellArticles = Math.max(...[...cells.values()].map((c) => c.articles), 1);
  const maxCellGrowth = Math.max(...[...cells.values()].map((c) => c.growthMass), 1);
  const density = [...cells.values()].map((cell) => {
    const [topCategory] = [...cell.categories.entries()].sort((a, b) => b[1] - a[1])[0] || [cell.topCategory];
    return {
      x: cell.x,
      y: cell.y,
      count: cell.count,
      articles: cell.articles,
      densityNorm: Math.round(Math.sqrt(cell.articles / maxCellArticles) * 10000) / 10000,
      growthNorm: Math.round(Math.sqrt(cell.growthMass / maxCellGrowth) * 10000) / 10000,
      topCategory,
    };
  });

  const cityLabels = points
    .filter((p) => p.label || p.topic)
    .sort((a, b) => (b.articles + b.growth * 28) - (a.articles + a.growth * 28))
    .slice(0, 320)
    .map((p) => ({
      id: p.id,
      label: p.label || p.topic,
      x: p.x,
      y: p.y,
      articles: p.articles,
      growth: p.growth,
      category: p.category,
    }));

  const atlasPoints = points
    .sort((a, b) => b.articles - a.articles)
    .slice(0, 12000)
    .map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      articles: p.articles,
      growth: p.growth,
      category: p.category,
      label: p.label || p.topic,
    }));

  const frontierPoints = points
    .filter((p) => p.growth >= 78 || (p.growth >= 65 && p.articles >= 400))
    .sort((a, b) => (b.growth * Math.sqrt(b.articles)) - (a.growth * Math.sqrt(a.articles)))
    .slice(0, 4200)
    .map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      articles: p.articles,
      growth: p.growth,
      category: p.category,
      label: p.label || p.topic,
    }));

  const categories = [...categoryStats.values()]
    .sort((a, b) => a.id - b.id)
    .map((c) => ({
      ...c,
      avgGrowth: Math.round((c.growthMass / Math.max(1, Math.sqrt(c.articles))) * 100) / 100,
    }));

  const out = {
    meta: {
      source: 'map_of_science',
      clusterCount: rows.length,
      atlasPointCount: atlasPoints.length,
      frontierPointCount: frontierPoints.length,
      gridWidth: GRID_W,
      gridHeight: GRID_H,
      worldWidth: WORLD_W,
      worldHeight: WORLD_H,
      maxArticles,
      bounds,
    },
    categories,
    density,
    labels: cityLabels,
    atlasPoints,
    frontierPoints,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log(`wrote ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`${rows.length.toLocaleString()} clusters, ${density.length.toLocaleString()} cells, ${cityLabels.length} labels`);
}

build();
