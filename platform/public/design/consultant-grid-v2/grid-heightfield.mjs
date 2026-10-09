// Projected coordinates are in heightfield cells. Extend the front envelope by
// one cell with continuous coverage, rather than switching a lip-edge sample
// directly between background depth and face depth as a triangle passes it.
export function rasterizeHeightfield(points, triangles, width, height, output) {
  output.fill(0);
  for (let k = 0; k < triangles.length; k += 3) {
    const a = triangles[k] * 3, b = triangles[k + 1] * 3, c = triangles[k + 2] * 3;
    const x0 = points[a], y0 = points[a + 1], z0 = points[a + 2];
    const x1 = points[b], y1 = points[b + 1], z1 = points[b + 2];
    const x2 = points[c], y2 = points[c + 1], z2 = points[c + 2];
    if (Math.max(z0, z1, z2) <= 0) continue;
    const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    const left = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - 1));
    const right = Math.min(width - 1, Math.floor(Math.max(x0, x1, x2) + 1));
    const top = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 1));
    const bottom = Math.min(height - 1, Math.floor(Math.max(y0, y1, y2) + 1));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const w0 = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / area;
      const w1 = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / area;
      const w2 = 1 - w0 - w1;
      const index = y * width + x;
      let depth = output[index];
      if (Math.abs(area) > 1e-10 && w0 >= 0 && w1 >= 0 && w2 >= 0) {
        depth = Math.max(depth, w0 * z0 + w1 * z1 + w2 * z2);
      }
      // Take the front envelope of all three edges, including inside thin
      // triangles. Selecting just the nearest edge jumps between the front and
      // back of the upper lip when its projection becomes almost edge-on.
      for (let edge = 0; edge < 3; edge++) {
        const i = edge === 0 ? a : edge === 1 ? b : c;
        const j = edge === 0 ? b : edge === 1 ? c : a;
        // Keep the high endpoint of a collapsed lip edge in the envelope too.
        const vx = x - points[i], vy = y - points[i + 1];
        const vertexDistance2 = vx * vx + vy * vy;
        if (vertexDistance2 < 1 && points[i + 2] > depth) {
          const coverage = 1 - Math.sqrt(vertexDistance2);
          depth = Math.max(depth, points[i + 2] * coverage * coverage * (3 - 2 * coverage));
        }
        if (Math.max(points[i + 2], points[j + 2]) <= depth) continue;
        const dx = points[j] - points[i], dy = points[j + 1] - points[i + 1];
        const length2 = dx * dx + dy * dy;
        const u = length2 > 0 ? Math.max(0, Math.min(1,
          ((x - points[i]) * dx + (y - points[i + 1]) * dy) / length2)) : 0;
        const ex = x - points[i] - dx * u, ey = y - points[i + 1] - dy * u;
        const d2 = ex * ex + ey * ey;
        if (d2 >= 1) continue;
        const z = points[i + 2] + (points[j + 2] - points[i + 2]) * u;
        const coverage = 1 - Math.sqrt(d2);
        depth = Math.max(depth, z * coverage * coverage * (3 - 2 * coverage));
      }
      if (depth > output[index]) output[index] = depth;
    }
  }
  return output;
}
