export async function createWasmSpatialIndex({ url = 'spatial-index.wasm', onError } = {}) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const bytes = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new WasmSpatialIndex(instance.exports);
  } catch (err) {
    if (onError) onError('WASM index disabled: ' + err.message);
    return null;
  }
}

class WasmSpatialIndex {
  constructor(exports) {
    this.exports = exports;
    this.memory = exports.memory;
    this.count = 0;
    this.maxOutput = exports.max_output();
    this.output = null;
    this.hidden = null;
  }

  init({ data, nodeDirIdx, degrees }) {
    const n = data.nodes.x.length;
    if (n > this.exports.max_nodes()) {
      throw new Error(`WASM index capacity exceeded: ${n}`);
    }
    this.count = n;

    new Float32Array(this.memory.buffer, this.exports.xs_ptr(), n).set(data.nodes.x);
    new Float32Array(this.memory.buffer, this.exports.ys_ptr(), n).set(data.nodes.y);
    new Uint16Array(this.memory.buffer, this.exports.dirs_ptr(), n).set(nodeDirIdx);
    new Int32Array(this.memory.buffer, this.exports.degrees_ptr(), n).set(degrees);
    this.hidden = new Uint8Array(this.memory.buffer, this.exports.hidden_ptr(), 64);
    this.output = new Uint32Array(this.memory.buffer, this.exports.output_ptr(), this.maxOutput);
  }

  filterVisible({ left, right, top, bottom, cap, dirs, hiddenDirs }) {
    this.hidden.fill(0);
    for (let i = 0; i < dirs.length && i < this.hidden.length; i++) {
      this.hidden[i] = hiddenDirs.has(dirs[i].name) ? 1 : 0;
    }
    const count = this.exports.filter_visible(
      this.count,
      Math.fround(left),
      Math.fround(right),
      Math.fround(top),
      Math.fround(bottom),
      Math.min(cap, this.maxOutput),
    );
    return this.output.subarray(0, count);
  }
}
