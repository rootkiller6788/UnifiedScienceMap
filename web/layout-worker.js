// layout-worker.js — 力导向布局计算，跑在 Web Worker 里，不阻塞主线程 UI。
// 每批 tick 后把节点坐标 postMessage 回主线程用于渲染动画；收敛后发 end。

import * as d3 from 'https://cdn.jsdelivr.net/npm/d3-force@3/+esm';

const TICK_BATCH = 3;     // 每帧步进的 tick 数
const FRAME_MS = 33;      // ~30fps
const ALPHA_MIN = 0.001;

let sim = null;
let nodes = [];
let timer = null;

function start({ nodeCount, edges, alphaDecay }) {
  nodes = Array.from({ length: nodeCount }, () => ({ index: 0 }));
  const links = edges.map(([s, t]) => ({ source: s, target: t }));
  sim = d3
    .forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.index).distance(24))
    .force('charge', d3.forceManyBody().strength(-42))
    .force('collide', d3.forceCollide().radius(1.5))
    .force('center', d3.forceCenter(0, 0))
    .alphaDecay(alphaDecay ?? 0.02)
    .alphaMin(ALPHA_MIN);

  postMessage({ type: 'ready', nodeCount });
  loop();
}

function loop() {
  if (sim.alpha() < ALPHA_MIN) {
    finish();
    return;
  }
  for (let i = 0; i < TICK_BATCH; i++) sim.tick();
  emit();
  timer = setTimeout(loop, FRAME_MS);
}

function emit() {
  const xs = new Float32Array(nodes.length);
  const ys = new Float32Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    xs[i] = nodes[i].x ?? 0;
    ys[i] = nodes[i].y ?? 0;
  }
  // 用 transferable buffer，避免结构化克隆拷贝
  postMessage({ type: 'tick', xs, ys }, [xs.buffer, ys.buffer]);
}

function finish() {
  emit();
  postMessage({ type: 'end' });
  sim = null;
}

function stop() {
  clearTimeout(timer);
  timer = null;
  if (sim) sim.stop();
  sim = null;
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'start') {
    stop();
    start(msg);
  } else if (msg.type === 'stop') {
    stop();
  }
};
