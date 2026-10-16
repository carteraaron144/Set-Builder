import { clipRect, HEIGHT_SPACING, type Heightmap, type Rect } from '../terrain/layers'
import { FEATURES, type Cave, type CavePoint } from './features'

const { floorRatio, blend, margin, sampleStep } = FEATURES.cave

/** A cave centreline resampled into a polyline, in world metres. */
export interface CaveSamples {
  xs: Float32Array
  ys: Float32Array
  zs: Float32Array
}

/** World-metre box. */
export interface Box {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

/** A cave ready to carve: its signed distance (negative inside), world bounds and height-sample footprint. */
export interface CaveProfile {
  cave: Cave
  samples: CaveSamples
  bounds: Box
  /** Height samples within `margin` of the cave's box, or null if it lies outside the scene. */
  footprint: Rect | null
  sdf(x: number, y: number, z: number): number
}

type P3 = { x: number; y: number; z: number }

/** A point on the centripetal Catmull-Rom segment p1→p2 (Barry–Goldman), t in [0, 1]. */
function catmullRom(p0: P3, p1: P3, p2: P3, p3: P3, t: number): P3 {
  const knot = (a: P3, b: P3) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)), 1e-6)
  const t1 = knot(p0, p1)
  const t2 = t1 + knot(p1, p2)
  const t3 = t2 + knot(p2, p3)
  const u = t1 + (t2 - t1) * t
  const lerp = (a: P3, b: P3, ta: number, tb: number): P3 => {
    const w = (u - ta) / (tb - ta)
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w }
  }
  const a1 = lerp(p0, p1, 0, t1)
  const a2 = lerp(p1, p2, t1, t2)
  const a3 = lerp(p2, p3, t2, t3)
  return lerp(lerp(a1, a2, 0, t2), lerp(a2, a3, t1, t3), t1, t2)
}

/** Samples the curve through `points` at about `step` metres per sample; every control point is a sample. */
export function sampleCave(points: CavePoint[], step = sampleStep): CaveSamples {
  const pts: P3[] = []
  for (const p of points) {
    const q = pts[pts.length - 1]
    if (!q || Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > 1e-6) pts.push(p)
  }
  const out: P3[] = [pts[0]]
  const n = pts.length
  for (let k = 0; k + 1 < n; k++) {
    const p1 = pts[k]
    const p2 = pts[k + 1]
    // Phantom end points mirror the neighbour, as for paths.
    const p0 = k > 0 ? pts[k - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, z: 2 * p1.z - p2.z }
    const p3 = k + 2 < n ? pts[k + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, z: 2 * p2.z - p1.z }
    const parts = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z) / step))
    for (let i = 1; i < parts; i++) out.push(catmullRom(p0, p1, p2, p3, i / parts))
    out.push(p2)
  }
  return {
    xs: Float32Array.from(out, (p) => p.x),
    ys: Float32Array.from(out, (p) => p.y),
    zs: Float32Array.from(out, (p) => p.z),
  }
}

/** Polynomial smooth minimum: equals min(a, b) once they differ by k or more, and is at most k/4 below it. */
export function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - (h * h * k) / 4
}

/** Bins are this many metres square on the ground. */
const BIN = 8

export function profileCave(heights: Heightmap, cave: Cave): CaveProfile {
  const samples = sampleCave(cave.points)
  const { xs, ys, zs } = samples
  const r = cave.radius
  const chambers = cave.points.filter((p) => p.chamber > 0)

  const bounds: Box = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity }
  const grow = (x: number, z: number, y0: number, y1: number, rad: number) => {
    bounds.x0 = Math.min(bounds.x0, x - rad)
    bounds.x1 = Math.max(bounds.x1, x + rad)
    bounds.z0 = Math.min(bounds.z0, z - rad)
    bounds.z1 = Math.max(bounds.z1, z + rad)
    bounds.y0 = Math.min(bounds.y0, y0)
    bounds.y1 = Math.max(bounds.y1, y1)
  }
  for (let i = 0; i < xs.length; i++) grow(xs[i], zs[i], ys[i] - floorRatio * r, ys[i] + r, r)
  for (const c of chambers) grow(c.x, c.z, c.y - floorRatio * c.chamber, c.y + c.chamber, c.chamber)

  // Bin each segment (and chamber) into every ground cell its box, grown by the margin, touches. Outside the
  // bins the distance is at least the margin, so it is reported as Infinity.
  const half = heights.size / 2
  const cells = Math.ceil(heights.size / BIN)
  const segBins: number[][] = Array.from({ length: cells * cells }, () => [])
  const chamberBins: number[][] = Array.from({ length: cells * cells }, () => [])
  const cell = (v: number) => Math.min(cells - 1, Math.max(0, Math.floor((v + half) / BIN)))
  const binBox = (bins: number[][], id: number, x0: number, z0: number, x1: number, z1: number) => {
    for (let cz = cell(z0 - margin); cz <= cell(z1 + margin); cz++)
      for (let cx = cell(x0 - margin); cx <= cell(x1 + margin); cx++) bins[cz * cells + cx].push(id)
  }
  for (let s = 0; s + 1 < xs.length; s++)
    binBox(segBins, s, Math.min(xs[s], xs[s + 1]) - r, Math.min(zs[s], zs[s + 1]) - r, Math.max(xs[s], xs[s + 1]) + r, Math.max(zs[s], zs[s + 1]) + r)
  if (xs.length === 1) binBox(segBins, -1, xs[0] - r, zs[0] - r, xs[0] + r, zs[0] + r)
  chambers.forEach((c, i) => binBox(chamberBins, i, c.x - c.chamber, c.z - c.chamber, c.x + c.chamber, c.z + c.chamber))

  const point = (x: number, y: number, z: number, px: number, py: number, pz: number, rad: number) =>
    Math.max(Math.hypot(x - px, y - py, z - pz) - rad, py - floorRatio * rad - y)

  const sdf = (x: number, y: number, z: number): number => {
    if (x < -half - margin || x > half + margin || z < -half - margin || z > half + margin) return Infinity
    const b = cell(z) * cells + cell(x)
    let d = Infinity
    for (const s of segBins[b]) {
      if (s < 0) {
        d = Math.min(d, point(x, y, z, xs[0], ys[0], zs[0], r))
        continue
      }
      // Closest point on the segment, then the clipped capsule there.
      const ax = xs[s]
      const ay = ys[s]
      const az = zs[s]
      const bx = xs[s + 1] - ax
      const by = ys[s + 1] - ay
      const bz = zs[s + 1] - az
      const len2 = bx * bx + by * by + bz * bz
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / len2)) : 0
      d = Math.min(d, point(x, y, z, ax + bx * t, ay + by * t, az + bz * t, r))
    }
    for (const i of chamberBins[b]) {
      const c = chambers[i]
      d = smoothMin(d, point(x, y, z, c.x, c.y, c.z, c.chamber), blend)
    }
    return d
  }

  const toSample = (w: number) => (w + half) / HEIGHT_SPACING
  const footprint = clipRect(
    {
      x0: Math.floor(toSample(bounds.x0 - margin)),
      z0: Math.floor(toSample(bounds.z0 - margin)),
      x1: Math.ceil(toSample(bounds.x1 + margin)),
      z1: Math.ceil(toSample(bounds.z1 + margin)),
    },
    heights.resolution,
  )
  return { cave, samples, bounds, footprint, sdf }
}
