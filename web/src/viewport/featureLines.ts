import { sampleCave } from '../features/caves'
import type { Features } from '../features/features'
import { sampleSpline } from '../features/spline'

/** Line-segment vertex pairs (x, y, z each) along `xs`/`zs`, joined end to start. */
function strip(out: number[], n: number, at: (k: number) => [number, number, number]): void {
  for (let k = 1; k < n; k++) out.push(...at(k - 1), ...at(k))
}

/**
 * The centrelines of every path (not rivers) and cave as line-segment positions: paths follow the ground at
 * `groundY`, caves run through their points at depth.
 */
export function centrelineSegments(f: Features, groundY: (x: number, z: number) => number): { paths: Float32Array; caves: Float32Array } {
  const paths: number[] = []
  const caves: number[] = []
  for (const s of f.splines) {
    if (s.kind !== 'path' || s.points.length < 2) continue
    const sm = sampleSpline(s.points, 1)
    strip(paths, sm.xs.length, (k) => [sm.xs[k], groundY(sm.xs[k], sm.zs[k]), sm.zs[k]])
  }
  for (const c of f.caves) {
    if (c.points.length < 2) continue
    const sm = sampleCave(c.points, 1, c.radius)
    strip(caves, sm.xs.length, (k) => [sm.xs[k], sm.ys[k], sm.zs[k]])
  }
  return { paths: Float32Array.from(paths), caves: Float32Array.from(caves) }
}
