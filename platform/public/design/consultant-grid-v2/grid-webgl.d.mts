export function surfaceTopology(width: number, height: number): { vertices: Float32Array; indices: Uint32Array };
export function drawDepthAndGrid(gl: WebGL2RenderingContext, count: number, depthUniform: WebGLUniformLocation | null): void;
export function createGridGPU(canvas: HTMLCanvasElement, width: number, height: number, origin: [number, number], cellSize: number): {
  draw(heights: Float32Array, params: { w: number; h: number; dpr: number; focal: number; relief: number; yaw: number; pitch: number; stepSize: number; talk: number; hover: number; x: number; y: number }): void;
  destroy(): void;
};
