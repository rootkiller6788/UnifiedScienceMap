import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const IN_FILE = path.join(ROOT, 'science-map', 'UCSDmap_with_disciplines.net.txt');
const OUT_FILE = path.join(ROOT, 'web', 'ucsd-science-map.json');
const WORLD_W = 1600;
const WORLD_H = 900;
const PAD_X = 115;
const PAD_Y = 75;

const COLOR_MAP = {
  Red: '#ff334d',
  BrickRed: '#ff5a3d',
  Dandelion: '#ffd84d',
  Emerald: '#00d68f',
  Blue: '#2f80ff',
  SkyBlue: '#00d4ff',
  Lavender: '#a78bfa',
  Mulberry: '#d946ef',
  Peach: '#ff9f6e',
  OliveGreen: '#9bd23c',
  Mahogany: '#ff0055',
  Yellow: '#f4ff00',
  Gray50: '#808080',
};

function parse() {
  const lines = fs.readFileSync(IN_FILE, 'utf8').split(/\r?\n/);
  const vertices = [];
  const edges = [];
  let section = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('*')) {
      section = trimmed.toLowerCase().startsWith('*edges') ? 'edges' : 'vertices';
      continue;
    }
    if (section === 'vertices') {
      const m = trimmed.match(/^(\d+)\s+"([^"]+)"\s+([-\d.]+)\s+([-\d.]+)\s+x_fact\s+([-\d.]+).*?\bic\s+(\S+)/);
      if (!m) continue;
      vertices.push({
        id: Number(m[1]),
        label: m[2],
        rawX: Number(m[3]),
        rawY: Number(m[4]),
        size: Number(m[5]),
        colorName: m[6],
      });
    } else if (section === 'edges') {
      const parts = trimmed.split(/\s+/).map(Number);
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        edges.push([parts[0] - 1, parts[1] - 1, Number.isFinite(parts[2]) ? parts[2] : 1]);
      }
    }
  }
  const minX = Math.min(...vertices.map((d) => d.rawX));
  const maxX = Math.max(...vertices.map((d) => d.rawX));
  const minY = Math.min(...vertices.map((d) => d.rawY));
  const maxY = Math.max(...vertices.map((d) => d.rawY));
  for (const v of vertices) {
    const nx = (v.rawX - minX) / Math.max(1e-9, maxX - minX);
    const ny = (v.rawY - minY) / Math.max(1e-9, maxY - minY);
    v.x = Math.round((PAD_X + nx * (WORLD_W - PAD_X * 2)) * 100) / 100;
    v.y = Math.round((WORLD_H - PAD_Y - ny * (WORLD_H - PAD_Y * 2)) * 100) / 100;
    v.color = COLOR_MAP[v.colorName] || '#e5e7eb';
    delete v.rawX;
    delete v.rawY;
  }
  const groups = new Map();
  for (const v of vertices) {
    const g = groups.get(v.colorName) || { name: v.colorName, color: v.color, count: 0 };
    g.count++;
    groups.set(v.colorName, g);
  }
  const out = {
    meta: {
      source: 'UCSD Map of Science 2010',
      nodeCount: vertices.length,
      edgeCount: edges.length,
      worldWidth: WORLD_W,
      worldHeight: WORLD_H,
    },
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
    nodes: vertices,
    edges,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log(`wrote ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`${vertices.length} nodes, ${edges.length} edges`);
}

parse();
