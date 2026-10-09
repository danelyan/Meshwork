import { createHeadRenderer } from '@/components/head/renderer';

vi.mock('@/components/head/model', () => ({
  softenForehead: (model: { positions: Float32Array }) => model.positions,
  repairedNormals: (model: { normals: Float32Array }) => model.normals,
  parseHeadGlb: () => ({
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0, 0, 0]), uv: new Float32Array([0, 0]), images: [new Blob(), new Blob(), new Blob()],
    mouthParts: new Float32Array([0]),
    morphs: Array.from({ length: 3 }, () => ({ positions: new Float32Array([0, 0, 0]), normals: new Float32Array([0, 0, 0]) })),
  }),
}));

function stage() {
  const canvas = document.createElement('canvas');
  const gl = {
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, FLOAT: 3, VERTEX_SHADER: 4,
    FRAGMENT_SHADER: 5, COMPILE_STATUS: 6, LINK_STATUS: 7, DEPTH_TEST: 8,
    LEQUAL: 9, COLOR_BUFFER_BIT: 16, DEPTH_BUFFER_BIT: 32, TRIANGLES: 10, UNSIGNED_INT: 11,
    FRAMEBUFFER: 40, FRAMEBUFFER_COMPLETE: 41, TEXTURE_2D: 42, TEXTURE0: 43,
    RGBA8: 44, RGBA: 45, UNSIGNED_BYTE: 46, DEPTH_COMPONENT16: 47,
    createVertexArray: vi.fn(() => ({})), bindVertexArray: vi.fn(), deleteVertexArray: vi.fn(),
    createTexture: vi.fn(() => ({})), bindTexture: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(), activeTexture: vi.fn(), deleteTexture: vi.fn(),
    createFramebuffer: vi.fn(() => ({})), bindFramebuffer: vi.fn(), framebufferTexture2D: vi.fn(), framebufferRenderbuffer: vi.fn(), deleteFramebuffer: vi.fn(),
    createRenderbuffer: vi.fn(() => ({})), bindRenderbuffer: vi.fn(), renderbufferStorage: vi.fn(), deleteRenderbuffer: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 41), disable: vi.fn(), drawArrays: vi.fn(), uniform1i: vi.fn(),
    blendFuncSeparate: vi.fn(), cullFace: vi.fn(), polygonOffset: vi.fn(), generateMipmap: vi.fn(), depthMask: vi.fn(), clearDepth: vi.fn(), colorMask: vi.fn(),
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true), createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true), useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})), bindBuffer: vi.fn(), bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => name),
    uniform3fv: vi.fn(), uniform2f: vi.fn(), uniform1f: vi.fn(), uniform4f: vi.fn(),
    enable: vi.fn(), depthFunc: vi.fn(), viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), drawElements: vi.fn(),
    deleteBuffer: vi.fn(), deleteShader: vi.fn(), deleteProgram: vi.fn(),
  };
  // jsdom has no GPU. This minimal context observes positioning and resource lifecycle;
  // shader compilation and actual pixels are verified in the browser.
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as unknown as WebGL2RenderingContext);
  let bounds = new DOMRect(720, 120, 400, 600);
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => bounds);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('devicePixelRatio', 2); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
  const palette: Record<string, string> = { '--blue': '#4f42e9', '--paper': '#f1f1f3', '--ink': '#111111', '--muted': '#6b6b70' };
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => palette[name] ?? '' }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
  const queued = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { queued.set(++id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((key: number) => queued.delete(key)));
  const disconnect = vi.fn();
  const observer = class { observe() {} disconnect = disconnect; };
  vi.stubGlobal('IntersectionObserver', observer);
  vi.stubGlobal('ResizeObserver', observer);
  return {
    canvas, gl, queued, disconnect,
    move(top: number) { bounds = new DOMRect(720, top, 400, 600); },
    frame(now: number) {
      const first = queued.entries().next().value as [number, FrameRequestCallback];
      queued.delete(first[0]); first[1](now);
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('separate glass portrait', () => {
  it('turns visibly toward the left edge and back across the page', async () => {
    const s = stage();
    vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 800);
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, false, vi.fn());
    s.frame(50);
    const point = (x: number) => {
      const event = new Event('pointermove');
      Object.assign(event, { clientX: x, clientY: 400, pointerType: 'mouse' });
      document.dispatchEvent(event);
    };
    point(0);
    for (let i = 1; i <= 25; i++) s.frame(50 + i * 50);
    const left = s.gl.uniform2f.mock.calls.filter(call => call[0] === 'uAngle').at(-1)!;
    expect(left[1]).toBeLessThan(-.75);
    expect(left[1]).toBeGreaterThan(-1.1);
    point(1280);
    for (let i = 1; i <= 25; i++) s.frame(1300 + i * 50);
    const right = s.gl.uniform2f.mock.calls.filter(call => call[0] === 'uAngle').at(-1)!;
    expect(right[1]).toBeGreaterThan(-.1);
    expect(right[1]).toBeLessThan(.05);
    expect(fetch).toHaveBeenCalledOnce();
    renderer.dispose();
  });
  it('renders both glass surfaces and refracts the static grid on a transparent local canvas', async () => {
    const s = stage();
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, true, vi.fn());
    s.frame(40);
    expect(s.canvas.width).toBe(600);
    expect(s.gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(s.gl.uniform1i).toHaveBeenCalledWith('uMode', 5);
    expect(s.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(s.gl.drawArrays).toHaveBeenCalledOnce();
    expect(s.gl.createFramebuffer).toHaveBeenCalledOnce();
    expect(s.gl.uniform1f).toHaveBeenCalledWith('uBackface', 1);
    expect(s.gl.uniform1f).toHaveBeenCalledWith('uBackface', 0);
    expect(s.canvas.dataset.rendered).toBe('glass');
    renderer.dispose();
  });
  it('cleans resources once and stops responding after disposal', async () => {
    const s = stage();
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, false, vi.fn());
    renderer.dispose(); renderer.dispose();
    expect(s.gl.deleteBuffer).toHaveBeenCalledTimes(13);
    expect(s.gl.deleteShader).toHaveBeenCalledTimes(4);
    expect(s.gl.deleteTexture).toHaveBeenCalledTimes(3);
    expect(s.gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(s.gl.deleteFramebuffer).toHaveBeenCalledOnce();
    expect(s.disconnect).toHaveBeenCalledTimes(2);
    expect(s.queued.size).toBe(0);
  });
  it('pauses pointer tracking without refetching the model', async () => {
    const s = stage();
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, false, vi.fn());
    s.frame(50);
    renderer.setPaused?.(true);
    if (s.queued.size) s.frame(100);
    const event = new Event('pointermove');
    Object.assign(event, {clientX: 1200, clientY: 100, pointerType: 'mouse'});
    document.dispatchEvent(event);
    expect(s.queued.size).toBe(0);
    renderer.setPaused?.(false); s.frame(100);
    expect(fetch).toHaveBeenCalledOnce();
    renderer.dispose();
  });
  it('animates the mouth and blink while freezing the pose during pause', async () => {
    const s = stage();
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, false, vi.fn());
    s.frame(50);
    renderer.setSpeech?.(1, .4, .2);
    for (let i = 1; i <= 64; i++) s.frame(50 + i * 50);
    expect(s.gl.uniform1f.mock.calls.filter(call => call[0] === 'uMouth').at(-1)![1]).toBeGreaterThan(.9);
    expect(s.gl.uniform1f.mock.calls.some(call => call[0] === 'uBlink' && call[1] > .8)).toBe(true);
    renderer.setPaused?.(true);
    if (s.queued.size) s.frame(3300);
    const phase = s.gl.uniform1f.mock.calls.filter(call => call[0] === 'uTime').at(-1);
    renderer.setSpeech?.(0);
    document.dispatchEvent(new Event('visibilitychange'));
    s.frame(10000);
    expect(s.gl.uniform1f.mock.calls.filter(call => call[0] === 'uTime').at(-1)).toEqual(phase);
    renderer.setPaused?.(false); s.frame(10050); s.frame(10100);
    expect(fetch).toHaveBeenCalledOnce();
    renderer.dispose();
  });
});
