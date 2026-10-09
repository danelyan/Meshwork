/** Smooth cell coverage transitions as the nose/lips cross heightfield samples.
 * A 25 ms time constant hides single-frame cell pops without altering the target shape.
 * The first frame is copied immediately so the face does not inflate on load.
 */
export function stabilizeHeightmap(previous, target, elapsedMs, initialized) {
  const blend = initialized ? 1 - Math.exp(-Math.min(100, Math.max(0, elapsedMs)) / 25) : 1;
  for (let i = 0; i < target.length; i++) previous[i] += (target[i] - previous[i]) * blend;
  return previous;
}
