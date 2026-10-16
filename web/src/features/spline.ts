import { FEATURES, type Spline, type SplineKind, type SplinePoint } from './features'

/** A curve resampled along its arc length: positions in world metres, `s` = arc length at each sample. */
export interface SplineSamples {
  xs: Float32Array
  zs: Float32Array
  s: Float32Array
  /** Width at each sample: control-point widths interpolated along the arc. */
  widths: Float32Array
  length: number
}

/** World-metre bounding box. */
export interface Bounds {
  x0: number
  z0: number
  x1: number
  z1: number
}

/** Dense evaluation steps per metre of chord, before resampling by arc length. */
const DENSITY = 20

/** Drops consecutive points closer than a micrometre, which would give zero-length segments. */
function dedupe(points: SplinePoint[]): SplinePoint[] {
  const out: SplinePoint[] = []
  for (const p of points) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 1e-6) out.push(p)
  }
  return out
}

/** A point on the centripetal Catmull-Rom segment p1→p2 (Barry–Goldman), t in [0, 1]. */
function catmullRom(p0: SplinePoint, p1: SplinePoint, p2: SplinePoint, p3: SplinePoint, t: number): SplinePoint {
  const knot = (a: SplinePoint, b: SplinePoint) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)), 1e-6)
  const t1 = knot(p0, p1)
  const t2 = t1 + knot(p1, p2)
  const t3 = t2 + knot(p2, p3)
  const u = t1 + (t2 - t1) * t
  const lerp = (a: SplinePoint, b: SplinePoint, ta: number, tb: number): SplinePoint => {
    const w = (u - ta) / (tb - ta)
    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w }
  }
  const a1 = lerp(p0, p1, 0, t1)
  const a2 = lerp(p1, p2, t1, t2)
  const a3 = lerp(p2, p3, t2, t3)
  const b1 = lerp(a1, a2, 0, t2)
  const b2 = lerp(a2, a3, t1, t3)
  return lerp(b1, b2, t1, t2)
}

/**
 * Samples the curve through `points` about every `step` metres of arc length. Each segment is resampled on its
 * own, so every control point is a sample and spacing is at most `step`.
 */
export function sampleSpline(points: SplinePoint[], step = 0.5, width = 0): SplineSamples {
  const pts = dedupe(points)
  const xs: number[] = [pts[0].x]
  const zs: number[] = [pts[0].z]
  const s: number[] = [0]
  const ws: number[] = [pts[0].width ?? width]
  const n = pts.length
  for (let k = 0; k + 1 < n; k++) {
    const p1 = pts[k]
    const p2 = pts[k + 1]
    const w1 = p1.width ?? width
    const w2 = p2.width ?? width
    // Phantom end points mirror the neighbour, so the curve leaves each end heading at the next point.
    const p0 = k > 0 ? pts[k - 1] : { x: 2 * p1.x - p2.x, z: 2 * p1.z - p2.z }
    const p3 = k + 2 < n ? pts[k + 2] : { x: 2 * p2.x - p1.x, z: 2 * p2.z - p1.z }
    const dense = Math.max(8, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) * DENSITY))
    const dx = [p1.x]
    const dz = [p1.z]
    const ds = [0]
    for (let i = 1; i <= dense; i++) {
      const q = i === dense ? p2 : catmullRom(p0, p1, p2, p3, i / dense)
      ds.push(ds[i - 1] + Math.hypot(q.x - dx[i - 1], q.z - dz[i - 1]))
      dx.push(q.x)
      dz.push(q.z)
    }
    const segLength = ds[dense]
    const parts = Math.max(1, Math.ceil(segLength / step - 1e-9))
    const base = s[s.length - 1]
    let j = 0
    for (let i = 1; i <= parts; i++) {
      if (i === parts) {
        xs.push(p2.x)
        zs.push(p2.z)
        s.push(base + segLength)
        ws.push(w2)
        break
      }
      const target = (segLength * i) / parts
      while (ds[j + 1] < target) j++
      const w = (target - ds[j]) / (ds[j + 1] - ds[j])
      xs.push(dx[j] + (dx[j + 1] - dx[j]) * w)
      zs.push(dz[j] + (dz[j + 1] - dz[j]) * w)
      s.push(base + target)
      ws.push(w1 + (w2 - w1) * (i / parts))
    }
  }
  return { xs: Float32Array.from(xs), zs: Float32Array.from(zs), s: Float32Array.from(s), widths: Float32Array.from(ws), length: s[s.length - 1] }
}

/** The closest point of the sampled polyline to (x, z): nearest sample index, distance and arc length there. */
export function nearestOnSamples(sm: SplineSamples, x: number, z: number): { index: number; distance: number; s: number } {
  const { xs, zs } = sm
  let best = { index: 0, distance: Math.hypot(x - xs[0], z - zs[0]), s: 0 }
  for (let i = 0; i + 1 < xs.length; i++) {
    const ax = xs[i]
    const az = zs[i]
    const ex = xs[i + 1] - ax
    const ez = zs[i + 1] - az
    const len2 = ex * ex + ez * ez
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / len2)) : 0
    const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t))
    if (d < best.distance) best = { index: t < 0.5 ? i : i + 1, distance: d, s: sm.s[i] + (sm.s[i + 1] - sm.s[i]) * t }
  }
  return best
}

/** Snaps `p` exactly onto the nearest end of a `kind` spline within the snap distance; otherwise returns `p`. */
export function snapToEnd(p: SplinePoint, splines: Spline[], kind: SplineKind, exclude?: string): SplinePoint {
  let best: SplinePoint = p
  let bestDistance: number = FEATURES.snapDistance
  for (const sp of splines) {
    if (sp.kind !== kind || sp.id === exclude) continue
    for (const end of [sp.points[0], sp.points[sp.points.length - 1]]) {
      const d = Math.hypot(end.x - p.x, end.z - p.z)
      if (d <= bestDistance) {
        best = { x: end.x, z: end.z }
        bestDistance = d
      }
    }
  }
  return best
}

/** The samples' bounding box grown by `pad` metres on every side. */
export function splineBounds(sm: SplineSamples, pad: number): Bounds {
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (let i = 0; i < sm.xs.length; i++) {
    x0 = Math.min(x0, sm.xs[i])
    x1 = Math.max(x1, sm.xs[i])
    z0 = Math.min(z0, sm.zs[i])
    z1 = Math.max(z1, sm.zs[i])
  }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad }
}
