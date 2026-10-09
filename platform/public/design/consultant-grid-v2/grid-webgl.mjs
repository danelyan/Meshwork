// Native WebGL2. The first pass writes depth only; the second draws the grid.
// Colors and camera are retained from the supplied consultant-handoff renderer.
export function surfaceTopology(width, height) {
  // One ring beyond the heightfield is a flat continuation of the same sheet.
  const vertices = new Float32Array((width + 2) * (height + 2) * 2);
  let p = 0;
  for (let y = -1; y <= height; y++) for (let x = -1; x <= width; x++) {
    vertices[p++] = x; vertices[p++] = y;
  }
  const indices = new Uint32Array((width + 1) * (height + 1) * 6);
  p = 0;
  for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
    const a = y * (width + 2) + x, b = a + 1, c = a + width + 2, d = c + 1;
    indices.set([a, b, d, a, d, c], p); p += 6;
  }
  return { vertices, indices };
}

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 cell;
uniform sampler2D heightmap;
uniform vec2 size, atlasSize, atlasOrigin, planeExtent;
uniform float cellSize, focal, relief, yaw, pitch;
out vec2 sheet;
out float height;
out vec2 slope;
float hAt(vec2 xy) {
  vec2 g = (xy - atlasOrigin) / cellSize;
  if (any(lessThan(g, vec2(0))) || any(greaterThanEqual(g, atlasSize-1.0))) return 0.0;
  ivec2 i = ivec2(floor(g)); vec2 a = fract(g);
  return mix(mix(texelFetch(heightmap,i,0).r, texelFetch(heightmap,i+ivec2(1,0),0).r,a.x),
    mix(texelFetch(heightmap,i+ivec2(0,1),0).r,texelFetch(heightmap,i+ivec2(1,1),0).r,a.x),a.y);
}
void main() {
  sheet = atlasOrigin + cell * cellSize;
  if (cell.x < 0.0) sheet.x = -planeExtent.x;
  if (cell.x >= atlasSize.x) sheet.x = planeExtent.x;
  if (cell.y < 0.0) sheet.y = -planeExtent.y;
  if (cell.y >= atlasSize.y) sheet.y = planeExtent.y;
  height = hAt(sheet);
  float e = 0.012;
  slope = vec2(hAt(sheet+vec2(e,0))-hAt(sheet-vec2(e,0)),
    hAt(sheet+vec2(0,e))-hAt(sheet-vec2(0,e))) / (2.0*e) * relief;
  float z = height * relief, y = sheet.y + 0.04;
  float yy = y*cos(pitch)-z*sin(pitch), zz = y*sin(pitch)+z*cos(pitch);
  float xx = sheet.x*cos(yaw)+zz*sin(yaw), z2 = -sheet.x*sin(yaw)+zz*cos(yaw);
  float depth = 5.0-z2;
  // Perspective near 0.1, far 100. Identical projection in both passes.
  gl_Position = vec4(vec2(xx,yy)*focal*2.0/size, 1.002002*depth-0.2002002, depth);
}`;

const fragment = `#version 300 es
precision highp float;
in vec2 sheet;
in float height;
in vec2 slope;
uniform bool depthOnly;
uniform vec2 size, pointer;
uniform float stepSize, dpr, hover, talk;
out vec4 color;
void main() {
  if (depthOnly) { color=vec4(0); return; }
  vec2 grid=sheet/stepSize;
  vec2 rate=max(fwidth(grid),vec2(0.00001));
  vec2 dist=abs(fract(grid+0.5)-0.5)/rate;
  // At a nose/lip silhouette only one family may be undersampled.
  // Fading both families together makes the still-visible cross-lines blink out.
  vec2 resolved=1.0-smoothstep(vec2(0.25),vec2(0.75),rate);
  vec2 lines=(1.0-smoothstep(vec2(0),vec2(dpr),dist))*resolved;
  float line=max(lines.x,lines.y);
  vec2 screen=vec2(gl_FragCoord.x/dpr,size.y-gl_FragCoord.y/dpr);
  float radius=min(size.x,size.y)*0.2;
  float glow=hover*exp(-dot(screen-pointer,screen-pointer)/(2.0*radius*radius));
  float dotSize=mix(1.0,1.5,smoothstep(0.4,0.7,glow))*dpr;
  float dotCoverage=(1.0-smoothstep(dotSize-0.5,dotSize+0.5,max(dist.x,dist.y)))*min(resolved.x,resolved.y);
  vec3 normal=normalize(vec3(-slope,1));
  float lam=dot(normal,vec3(-0.5,0.55,0.62));
  float ink=0.1+smoothstep(0.002,0.03,height)*(0.14*clamp(1.0-lam,0.0,1.0)+talk*0.05)+glow*0.3;
  float blue=smoothstep(0.25,0.5,glow);
  float alpha=max(line*(ink+blue*0.15),dotCoverage*(0.14+glow*0.35));
  color=vec4(mix(vec3(17.0)/255.0,vec3(64,47,255)/255.0,blue),alpha);
}`;

export function drawDepthAndGrid(gl, count, depthUniform) {
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.colorMask(false, false, false, false);
  gl.uniform1i(depthUniform, 1);
  gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
  gl.colorMask(true, true, true, true);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1i(depthUniform, 0);
  gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
  gl.depthMask(true);
}

export function createGridGPU(canvas, width, height, origin, cellSize) {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) throw new Error('WebGL2 недоступен. Откройте сохранённый v1.');
  const shaders = [], buffers = [];
  const program = gl.createProgram(), vao = gl.createVertexArray(), texture = gl.createTexture();
  const destroy = () => {
    buffers.forEach(b => gl.deleteBuffer(b)); shaders.forEach(s => gl.deleteShader(s));
    gl.deleteProgram(program); gl.deleteVertexArray(vao); gl.deleteTexture(texture);
  };
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type); shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.bindVertexArray(vao);
    const mesh = surfaceTopology(width, height);
    for (const [target, data] of [[gl.ARRAY_BUFFER, mesh.vertices], [gl.ELEMENT_ARRAY_BUFFER, mesh.indices]]) {
      const buffer = gl.createBuffer(); buffers.push(buffer);
      gl.bindBuffer(target, buffer); gl.bufferData(target, data, gl.STATIC_DRAW);
    }
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(['heightmap', 'size', 'atlasSize', 'atlasOrigin', 'planeExtent', 'cellSize', 'focal', 'relief', 'yaw', 'pitch', 'depthOnly', 'pointer', 'stepSize', 'dpr', 'hover', 'talk'].map(n => [n, gl.getUniformLocation(program, n)]));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
    gl.uniform1i(uniforms.heightmap, 0);
    gl.uniform2f(uniforms.atlasSize, width, height);
    gl.uniform2f(uniforms.atlasOrigin, origin[0], origin[1]);
    gl.uniform1f(uniforms.cellSize, cellSize);
    canvas.dataset.renderer = 'webgl2-depth-grid';
    return {
      draw(heights, p) {
        gl.useProgram(program); gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, heights);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.colorMask(true, true, true, true); gl.depthMask(true);
        gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniform2f(uniforms.size, p.w, p.h);
        gl.uniform2f(uniforms.planeExtent, (p.w/p.h)*1.2+0.8, 1.0);
        gl.uniform2f(uniforms.pointer, p.x, p.y);
        for (const key of ['focal','relief','yaw','pitch','stepSize','dpr','hover','talk']) gl.uniform1f(uniforms[key],p[key]);
        drawDepthAndGrid(gl, mesh.indices.length, uniforms.depthOnly);
      }, destroy,
    };
  } catch (error) { destroy(); throw error; }
}
