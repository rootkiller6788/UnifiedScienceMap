export class GlRenderer {
  constructor(canvas, { onError } = {}) {
    this.canvas = canvas;
    this.gl = canvas?.getContext('webgl2', { antialias: true, alpha: false }) || null;
    this.onError = onError || (() => {});
    this.nodes = null;
    this.edges = null;
  }

  get supported() {
    return !!this.gl;
  }

  resize(width, height, dpr) {
    if (!this.canvas) return;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  init({ data, dirColor, nodeDirIdx, degrees, maxDegree }) {
    if (!this.gl) return;
    this.initNodes({ data, dirColor, nodeDirIdx, degrees, maxDegree });
    this.initEdges({ data, dirColor, nodeDirIdx });
  }

  render({ transform, dpr, hiddenDirs, basePoint, edgeStartK, width, height, dirs }) {
    if (!this.gl || !this.nodes) return false;
    const gl = this.gl;
    const hidden = this.hiddenUniform(dirs, hiddenDirs);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);

    this.renderEdges({ transform, hidden, edgeStartK, width, height });
    this.renderNodes({ transform, dpr, hidden, basePoint, width, height });
    return true;
  }

  initNodes({ data, dirColor, nodeDirIdx, degrees, maxDegree }) {
    const gl = this.gl;
    const { nodes } = data;
    const n = nodes.x.length;
    const stride = 7;
    const bufferData = new Float32Array(n * stride);
    const sqrtMax = Math.sqrt(maxDegree);
    for (let i = 0; i < n; i++) {
      const rgb = parseRgb(dirColor.get(nodes.dir[i]).rgb);
      const o = i * stride;
      bufferData[o] = nodes.x[i];
      bufferData[o + 1] = nodes.y[i];
      bufferData[o + 2] = rgb[0] / 255;
      bufferData[o + 3] = rgb[1] / 255;
      bufferData[o + 4] = rgb[2] / 255;
      bufferData[o + 5] = Math.sqrt(degrees[i]) / sqrtMax;
      bufferData[o + 6] = nodeDirIdx[i];
    }

    const program = this.createProgram(NODE_VERTEX_SHADER, NODE_FRAGMENT_SHADER);
    if (!program) return;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bufferData, gl.STATIC_DRAW);
    this.bindAttrib(program, 'a_pos', 2, stride, 0);
    this.bindAttrib(program, 'a_color', 3, stride, 2);
    this.bindAttrib(program, 'a_degree', 1, stride, 5);
    this.bindAttrib(program, 'a_dir', 1, stride, 6);
    gl.bindVertexArray(null);

    this.nodes = {
      program,
      vao,
      count: n,
      uResolution: gl.getUniformLocation(program, 'u_resolution'),
      uTransform: gl.getUniformLocation(program, 'u_transform'),
      uDpr: gl.getUniformLocation(program, 'u_dpr'),
      uBasePoint: gl.getUniformLocation(program, 'u_basePoint'),
      uHidden: gl.getUniformLocation(program, 'u_hidden'),
    };
  }

  initEdges({ data, dirColor, nodeDirIdx }) {
    const gl = this.gl;
    const { nodes, edges } = data;
    const stride = 7;
    const bufferData = new Float32Array(edges.length * 2 * stride);
    for (let ei = 0; ei < edges.length; ei++) {
      const [s, t] = edges[ei];
      const colorA = parseRgb(dirColor.get(nodes.dir[s]).rgb);
      const colorB = parseRgb(dirColor.get(nodes.dir[t]).rgb);
      writeEdgeVertex(bufferData, ei * 2 * stride, nodes.x[s], nodes.y[s], colorA, nodeDirIdx[s], nodeDirIdx[t]);
      writeEdgeVertex(bufferData, (ei * 2 + 1) * stride, nodes.x[t], nodes.y[t], colorB, nodeDirIdx[s], nodeDirIdx[t]);
    }

    const program = this.createProgram(EDGE_VERTEX_SHADER, EDGE_FRAGMENT_SHADER);
    if (!program) return;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bufferData, gl.STATIC_DRAW);
    this.bindAttrib(program, 'a_pos', 2, stride, 0);
    this.bindAttrib(program, 'a_color', 3, stride, 2);
    this.bindAttrib(program, 'a_dirA', 1, stride, 5);
    this.bindAttrib(program, 'a_dirB', 1, stride, 6);
    gl.bindVertexArray(null);

    this.edges = {
      program,
      vao,
      count: edges.length * 2,
      uResolution: gl.getUniformLocation(program, 'u_resolution'),
      uTransform: gl.getUniformLocation(program, 'u_transform'),
      uAlpha: gl.getUniformLocation(program, 'u_alpha'),
      uHidden: gl.getUniformLocation(program, 'u_hidden'),
    };
  }

  renderNodes({ transform, dpr, hidden, basePoint, width, height }) {
    const gl = this.gl;
    const layer = this.nodes;
    if (!layer) return;
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(layer.program);
    gl.bindVertexArray(layer.vao);
    gl.uniform2f(layer.uResolution, width, height);
    gl.uniform3f(layer.uTransform, transform.x, transform.y, transform.k);
    gl.uniform1f(layer.uDpr, dpr);
    gl.uniform1f(layer.uBasePoint, basePoint);
    gl.uniform1fv(layer.uHidden, hidden);
    gl.drawArrays(gl.POINTS, 0, layer.count);
    gl.bindVertexArray(null);
  }

  renderEdges({ transform, hidden, edgeStartK, width, height }) {
    const gl = this.gl;
    const layer = this.edges;
    if (!layer) return;
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(layer.program);
    gl.bindVertexArray(layer.vao);
    gl.uniform2f(layer.uResolution, width, height);
    gl.uniform3f(layer.uTransform, transform.x, transform.y, transform.k);
    gl.uniform1f(layer.uAlpha, edgeAlphaForZoom(transform.k, edgeStartK));
    gl.uniform1fv(layer.uHidden, hidden);
    gl.drawArrays(gl.LINES, 0, layer.count);
    gl.bindVertexArray(null);
  }

  hiddenUniform(dirs, hiddenDirs) {
    const hidden = new Float32Array(64);
    for (let i = 0; i < dirs.length && i < hidden.length; i++) {
      hidden[i] = hiddenDirs.has(dirs[i].name) ? 1 : 0;
    }
    return hidden;
  }


  createProgram(vertexSource, fragmentSource) {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.onError('WebGL program failed: ' + gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      this.onError('WebGL shader failed: ' + gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  bindAttrib(program, name, size, stride, offsetFloats) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * Float32Array.BYTES_PER_ELEMENT, offsetFloats * Float32Array.BYTES_PER_ELEMENT);
  }
}

const NODE_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec3 a_color;
in float a_degree;
in float a_dir;
uniform vec2 u_resolution;
uniform vec3 u_transform;
uniform float u_dpr;
uniform float u_basePoint;
uniform float u_hidden[64];
out vec3 v_color;
out float v_hidden;
void main() {
  vec2 screen = a_pos * u_transform.z + u_transform.xy;
  vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = u_dpr * u_basePoint * (0.68 + 1.15 * a_degree);
  v_color = a_color;
  v_hidden = u_hidden[int(a_dir + 0.5)];
}`;

const NODE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_color;
in float v_hidden;
out vec4 outColor;
void main() {
  if (v_hidden > 0.5) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float core = smoothstep(1.0, 0.12, d);
  float edge = smoothstep(1.0, 0.76, d) * 0.22;
  outColor = vec4(v_color, max(core, edge));
}`;

const EDGE_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec3 a_color;
in float a_dirA;
in float a_dirB;
uniform vec2 u_resolution;
uniform vec3 u_transform;
uniform float u_hidden[64];
out vec3 v_color;
out float v_hidden;
void main() {
  vec2 screen = a_pos * u_transform.z + u_transform.xy;
  vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
  v_hidden = max(u_hidden[int(a_dirA + 0.5)], u_hidden[int(a_dirB + 0.5)]);
}`;

const EDGE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_color;
in float v_hidden;
uniform float u_alpha;
out vec4 outColor;
void main() {
  if (v_hidden > 0.5) discard;
  outColor = vec4(v_color, u_alpha);
}`;

function edgeAlphaForZoom(k, startK) {
  const start = Number.isFinite(startK) ? startK : 1.0;
  const threshold = start * 1.3;
  const t = Math.max(0.0, Math.min(1.0, (k - threshold) / Math.max(1.0, start * 4.5)));
  const eased = Math.pow(t, 3.2);
  return 0.1 * eased;
}

function writeEdgeVertex(data, offset, x, y, rgb, dirA, dirB) {
  data[offset] = x;
  data[offset + 1] = y;
  data[offset + 2] = rgb[0] / 255;
  data[offset + 3] = rgb[1] / 255;
  data[offset + 4] = rgb[2] / 255;
  data[offset + 5] = dirA;
  data[offset + 6] = dirB;
}

function parseRgb(rgb) {
  return rgb.split(',').map((v) => Number(v.trim()));
}
