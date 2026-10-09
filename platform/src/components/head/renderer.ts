import { parseHeadGlb, repairedNormals, softenForehead } from './model';
import { headPointer } from './pointer';
import { smoothMetalSurface } from './surface';
import { headMotion, headPose, mouthWeights, portraitZoom } from './motion';
import { fragmentShader, vertexShader } from './shaders';

export type HeadRenderer = { dispose(): void; setPaused?(paused: boolean): void; setSpeech?(mouth: number, lipRound?: number, lipWide?: number): void };

function rgb(value: string): [number, number, number] {
  const match = value.trim().match(/^#([\da-f]{6})$/i);
  if (!match) throw new Error('Expected a six-digit color token');
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Soft pearlescent portrait with a fading neck and facial animation. */
export async function createHeadRenderer(canvas: HTMLCanvasElement, signal: AbortSignal, reducedMotion: boolean, onContextLost: () => void): Promise<HeadRenderer> {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!gl) throw new Error('WebGL 2 unavailable');
  const buffers: WebGLBuffer[] = [], textures: WebGLTexture[] = [], shaders: WebGLShader[] = [], bitmaps: ImageBitmap[] = [];
  let program: WebGLProgram | null = null, raf = 0, disposed = false;
  const release = () => {
    buffers.forEach(buffer => gl.deleteBuffer(buffer));
    textures.forEach(texture => gl.deleteTexture(texture));
    shaders.forEach(shader => gl.deleteShader(shader));
    if (program) gl.deleteProgram(program);
    bitmaps.forEach(bitmap => bitmap.close());
  };
  try {
    const response = await fetch('/models/head-mouth.glb', { signal });
    if (!response.ok) throw new Error('Head model unavailable');
    const model = parseHeadGlb(await response.arrayBuffer());
    signal.throwIfAborted();
    for (const image of [model.images[0], model.images[2]]) {
      if (!image) throw new Error('Missing head texture');
      bitmaps.push(await createImageBitmap(image));
    }
    signal.throwIfAborted();
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader unavailable');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
      return shader;
    };
    program = gl.createProgram();
    if (!program) throw new Error('Program unavailable');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
    gl.useProgram(program);
    const bind = (data: Float32Array | Uint32Array, target = gl.ARRAY_BUFFER as number) => {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Buffer unavailable');
      buffers.push(buffer); gl.bindBuffer(target, buffer); gl.bufferData(target, data, gl.STATIC_DRAW);
      return buffer;
    };
    const softened = smoothMetalSurface(model, softenForehead(model));
    [model.positions, model.normals, model.uv, softened, repairedNormals(model, softened)].forEach((data, index) => {
      bind(data); gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, index === 2 ? 2 : 3, gl.FLOAT, false, 0, 0);
    });
    bind(model.mouthParts); gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 1, gl.FLOAT, false, 0, 0);
    model.morphs.forEach((morph, index) => {
      for (const [location, data] of [[7 + index, morph.positions], [10 + index, morph.normals]] as const) {
        bind(data); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
      }
    });
    const triangles = model.indices;
    const triangleBuffer = bind(triangles, gl.ELEMENT_ARRAY_BUFFER);
    bitmaps.forEach((bitmap, index) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Texture unavailable');
      textures.push(texture); gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
    });
    const uniform = (name: string) => gl.getUniformLocation(program!, `u${name}`);
    const angleUniform = uniform('Angle'), pointerUniform = uniform('Pointer'), aspectUniform = uniform('Aspect');
    gl.uniform1i(uniform('Texture'), 0); gl.uniform1i(uniform('NormalMap'), 1);
    const css = getComputedStyle(canvas);
    gl.uniform3fv(uniform('Accent'), rgb(css.getPropertyValue('--blue')));
    gl.uniform3fv(uniform('Silver'), rgb(css.getPropertyValue('--paper')));
    gl.uniform1f(uniform('Strength'), 1); gl.uniform1f(uniform('Smooth'), 1);
    gl.uniform1f(uniform('Zoom'), 1); gl.uniform1f(uniform('Time'), 0); gl.uniform1f(uniform('Burst'), 0);
    gl.uniform1i(uniform('Mode'), 0); gl.uniform1i(uniform('Wire'), 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    let [targetX, targetY] = headPose(0, 0);
    let angleX = targetX, angleY = targetY;
    let pointerX = 0, pointerY = 0, lastDraw = 0, visible = true, paused = false;
    let previousTime: number | null = null, elapsed = 0;
    let speechTarget: [number, number, number] = [0, 0, 0];
    const speech: [number, number, number] = [0, 0, 0];
    const mouthUniform = uniform('Mouth'), roundUniform = uniform('LipRound'), wideUniform = uniform('LipWide');
    const blinkUniform = uniform('Blink'), breathUniform = uniform('Breath');
    const pointer = (event: PointerEvent) => {
      if (paused || event.pointerType === 'touch') return;
      const bounds = canvas.getBoundingClientRect();
      [pointerX, pointerY] = headPointer(event.clientX, event.clientY, innerWidth, innerHeight, bounds.left + bounds.width / 2, bounds.top + bounds.height * .4);
      [targetX, targetY] = headPose(pointerX, pointerY);
      schedule();
    };
    const leave = () => { if (paused) return; pointerX = 0; pointerY = 0; [targetX, targetY] = headPose(0, 0); schedule(); };
    const schedule = () => { if (!disposed && !raf) raf = requestAnimationFrame(frame); };
    function frame(now: number) {
      raf = 0;
      if (disposed || !visible || document.hidden) { previousTime = null; return; }
      if (!reducedMotion && now - lastDraw < 1000 / 30) { schedule(); return; }
      lastDraw = now;
      if (!paused && !reducedMotion) {
        const dt = previousTime === null ? 0 : Math.max(0, Math.min(.1, (now - previousTime) / 1000));
        elapsed += dt; previousTime = now;
        const follow = 1 - Math.exp(-dt * 5.2), lips = 1 - Math.exp(-dt * 22);
        angleX += (targetX - angleX) * follow; angleY += (targetY - angleY) * follow;
        speech.forEach((value, index) => { speech[index] = value + (speechTarget[index]! - value) * lips; });
      } else { previousTime = null; }
      const motion = headMotion(reducedMotion ? 0 : elapsed);
      const bounds = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 1.5);
      const width = Math.max(1, Math.round(bounds.width * dpr)), height = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl!.viewport(0, 0, width, height); gl!.clearColor(0, 0, 0, 0); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
      gl!.uniform1f(uniform('Zoom'), portraitZoom(width / height));
      gl!.uniform2f(angleUniform, angleX + motion.yaw, angleY + motion.pitch);
      gl!.uniform2f(pointerUniform, pointerX, pointerY); gl!.uniform1f(aspectUniform, width / height);
      gl!.uniform1f(uniform('Time'), elapsed);
      gl!.uniform1f(blinkUniform, motion.blink); gl!.uniform1f(breathUniform, motion.breath);
      gl!.uniform1f(mouthUniform, speech[0]); gl!.uniform1f(roundUniform, speech[1]); gl!.uniform1f(wideUniform, speech[2]);
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, triangleBuffer); gl!.uniform1i(uniform('Wire'), 0);
      // Thin ear surfaces must remain visible from either side of a turn.
      gl!.disable(gl!.CULL_FACE); gl!.depthMask(true); gl!.uniform1f(uniform('Backface'), 0);
      gl!.drawElements(gl!.TRIANGLES, triangles.length, gl!.UNSIGNED_INT, 0);
      canvas.dataset.rendered = 'pearlescent';
      if (!paused && !reducedMotion) schedule();
    }
    const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(raf); raf = 0; onContextLost(); };
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; previousTime = null; if (visible) schedule(); });
    const resize = new ResizeObserver(schedule);
    observer.observe(canvas); resize.observe(canvas);
    if (!reducedMotion) { document.addEventListener('pointermove', pointer, { passive: true }); document.addEventListener('pointerleave', leave); }
    const visibility = () => { previousTime = null; schedule(); };
    document.addEventListener('visibilitychange', visibility); canvas.addEventListener('webglcontextlost', lost);
    schedule();
    return { setPaused(value) {
      paused = value; previousTime = null;
      if (value) { cancelAnimationFrame(raf); raf = 0; } else schedule();
    },
      setSpeech(mouth, round, wide) { speechTarget = mouthWeights(mouth, round, wide); if (!paused && !reducedMotion) schedule(); }, dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); resize.disconnect();
      document.removeEventListener('pointermove', pointer); document.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', visibility); canvas.removeEventListener('webglcontextlost', lost); release();
    } };
  } catch (error) { release(); throw error; }
}
