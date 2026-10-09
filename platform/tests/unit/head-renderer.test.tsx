import { createHeadRenderer } from '@/components/head/renderer';

vi.mock('@/components/head/model', () => ({
  softenForehead: (model: { positions: Float32Array }) => model.positions,
  repairedNormals: (model: { normals: Float32Array }) => model.normals,
  parseHeadGlb: () => ({
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0, 0, 0]),
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
    depthMask: vi.fn(), clearDepth: vi.fn(), colorMask: vi.fn(),
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
  vi.stubGlobal('devicePixelRatio', 2);
  const palette: Record<string, string> = { '--paper': '#f1f1f3', '--ink': '#111111', '--muted': '#6b6b70' };
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

describe('grid relief stage', () => {
  it('pins the sheet to CSS page coordinates across high DPI and scroll', async () => {
    const s = stage();
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, true, vi.fn());
    s.frame(40);
    expect(s.canvas.width).toBe(600); // DPR capped to 1.5.
    expect(s.canvas.height).toBe(900);
    expect(s.gl.uniform2f).toHaveBeenCalledWith('uPageOffset', 0, 0);
    expect(s.gl.drawArrays).toHaveBeenCalledOnce();
    expect(s.gl.uniform1f).toHaveBeenCalledWith('uTime', 0);
    // An unbound renderbuffer name cannot be attached; a color-only FBO can
    // still report COMPLETE and would let back triangles overwrite the face.
    expect(s.gl.bindRenderbuffer.mock.invocationCallOrder[0]).toBeLessThan(s.gl.framebufferRenderbuffer.mock.invocationCallOrder[0]!);
    expect(s.gl.uniform4f).toHaveBeenLastCalledWith('uViewport', 720, 120, 400, 600);
    expect(s.canvas.dataset.rendered).toBe('grid-relief');
    expect(s.queued.size).toBe(0);
    s.move(40);
    document.dispatchEvent(new Event('scroll'));
    s.frame(80);
    expect(s.gl.uniform4f).toHaveBeenLastCalledWith('uViewport', 720, 40, 400, 600);
    renderer.dispose();
  });

  it('cleans GPU resources and stops responding to page scroll after disposal', async () => {
    const s = stage();
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, false, vi.fn());
    renderer.dispose(); renderer.dispose();
    expect(s.gl.deleteBuffer).toHaveBeenCalledTimes(3);
    expect(s.gl.deleteShader).toHaveBeenCalledTimes(4);
    expect(s.gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(s.gl.deleteTexture).toHaveBeenCalledOnce();
    expect(s.gl.deleteFramebuffer).toHaveBeenCalledOnce();
    expect(s.gl.deleteRenderbuffer).toHaveBeenCalledOnce();
    expect(s.gl.deleteVertexArray).toHaveBeenCalledTimes(2);
    expect(s.disconnect).toHaveBeenCalledTimes(2);
    expect(s.queued.size).toBe(0);
    document.dispatchEvent(new Event('scroll'));
    expect(s.queued.size).toBe(0);
  });

  it('freezes motion and resumes without reloading the model', async () => {
    const s = stage();
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, false, vi.fn());
    s.frame(50); s.frame(100);
    expect(s.queued.size).toBe(1);
    renderer.setPaused?.(true); s.frame(150);
    expect(s.queued.size).toBe(0);
    const pose = s.gl.uniform2f.mock.calls.filter(call => call[0] === 'uAngle').at(-1);
    const phase = s.gl.uniform1f.mock.calls.filter(call => call[0] === 'uTime').at(-1);
    document.dispatchEvent(new Event('scroll')); s.frame(1000);
    expect(s.gl.uniform2f.mock.calls.filter(call => call[0] === 'uAngle').at(-1)).toEqual(pose);
    expect(s.gl.uniform1f.mock.calls.filter(call => call[0] === 'uTime').at(-1)).toEqual(phase);
    renderer.setPaused?.(false); s.frame(1050);
    expect(s.queued.size).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('releases both rendering passes when the request is aborted', async () => {
    const s = stage(), controller = new AbortController();
    await createHeadRenderer(s.canvas, controller.signal, false, vi.fn());
    controller.abort();
    expect(s.gl.deleteFramebuffer).toHaveBeenCalledOnce();
    expect(s.queued.size).toBe(0);
  });

  it('projects the right-column anchor relative to the full sheet', async () => {
    const s = stage(), anchor = document.createElement('div');
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 160, 200, 400));
    const renderer = await createHeadRenderer(s.canvas, new AbortController().signal, true, vi.fn(), anchor);
    s.frame(40);
    expect(s.gl.uniform4f).toHaveBeenCalledWith('uAnchor', 180, 40, 200, 400);
    expect(s.gl.uniform2f).toHaveBeenCalledWith('uStage', 400, 600);
    renderer.dispose();
  });
});
