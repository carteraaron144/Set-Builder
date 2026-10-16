import type { SceneSize } from '../scene/scene'
import { clipRect, HEIGHT_SPACING, heightAt, type Heightmap, type Rect } from '../terrain/layers'
import { FEATURES, type Spline } from './features'
import { sampleSpline, splineBounds, type SplineSamples } from './spline'

/** Surface kinds painted over the terrain colour, one per height sample. */
export const SURFACE = { none: 0, dirt: 1, cobble: 2, verge: 3, bed: 4 } as const

/** Per height sample: which surface colour to blend in, and how much (0–255). */
export interface SurfaceMap {
  kind: Uint8Array
  weight: Uint8Array
}

/** A spline prepared for carving: its samples and the heights it carves to along them. */
export interface SplineProfile {
  spline: Spline
  samples: SplineSamples
  /** Per sample: the path's grade, or the river's bank (non-increasing along the flow). */
  grade: Float32Array
  /** Per sample: the river's water surface; null for paths. */
  water: Float32Array | null
  /** Height-sample indices the spline can change; null when it is entirely outside the scene. */
  footprint: Rect | null
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Half-width plus shoulder: how far from the centreline a spline changes heights. */
function reachOf(s: Spline): number {
  return s.width / 2 + FEATURES[s.kind].shoulder
}

function riverDepth(width: number): number {
  const r = FEATURES.river
  return Math.min(r.maxDepth, Math.max(r.minDepth, width * r.depthRatio))
}

/** World-metre bounds to an inclusive sample-index rect on a grid with the given spacing, clipped. */
function indexRect(b: { x0: number; z0: number; x1: number; z1: number }, size: SceneSize, spacing: number, res: number): Rect | null {
  const half = size / 2
  return clipRect(
    {
      x0: Math.floor((b.x0 + half) / spacing),
      z0: Math.floor((b.z0 + half) / spacing),
      x1: Math.ceil((b.x1 + half) / spacing),
      z1: Math.ceil((b.z1 + half) / spacing),
    },
    res,
  )
}

/**
 * Moving average of `v` over arc length, with the window radius shrinking to zero at the ends so the result
 * there equals the input (snapped splines then meet at the same height).
 */
function smoothAlong(v: Float64Array, s: Float32Array, radius: number): Float32Array {
  const n = v.length
  const length = s[n - 1]
  const out = new Float32Array(n)
  let lo = 0
  for (let i = 0; i < n; i++) {
    const r = Math.min(radius, s[i], length - s[i])
    while (s[lo] < s[i] - r - 1e-6) lo++
    let sum = 0
    let count = 0
    for (let k = lo; k < n && s[k] <= s[i] + r + 1e-6; k++) {
      if (s[k] < s[i] - r - 1e-6) continue
      sum += v[k]
      count++
    }
    out[i] = sum / count
  }
  return out
}

export function profileSpline(base: Heightmap, spline: Spline): SplineProfile {
  const samples = sampleSpline(spline.points)
  const n = samples.xs.length
  const raw = new Float64Array(n)
  for (let i = 0; i < n; i++) raw[i] = heightAt(base, samples.xs[i], samples.zs[i])
  const grade = smoothAlong(raw, samples.s, FEATURES.path.gradeWindow / 2)
  let water: Float32Array | null = null
  if (spline.kind === 'river') {
    // The river flows away from its higher end; a running minimum keeps the bank from ever climbing.
    const reversed = grade[n - 1] > grade[0]
    for (let k = 1; k < n; k++) {
      const i = reversed ? n - 1 - k : k
      const prev = reversed ? i + 1 : i - 1
      grade[i] = Math.min(grade[i], grade[prev])
    }
    water = Float32Array.from(grade, (g) => g - FEATURES.river.freeboard)
  }
  const res = base.resolution
  const footprint = indexRect(splineBounds(samples, reachOf(spline)), base.size, HEIGHT_SPACING, res)
  return { spline, samples, grade, water, footprint }
}

const intersect = (a: Rect, b: Rect): Rect | null => {
  const r = { x0: Math.max(a.x0, b.x0), z0: Math.max(a.z0, b.z0), x1: Math.min(a.x1, b.x1), z1: Math.min(a.z1, b.z1) }
  return r.x0 > r.x1 || r.z0 > r.z1 ? null : r
}

/**
 * Visits every sample of `rect` (on a grid with the given spacing) within `radius` of the profile's centreline,
 * with its distance to the nearest segment, that segment's index and the position t along it. A sample near
 * several segments is visited once, for the nearest (the earliest on ties), so results never depend on `rect`.
 */
function nearestInRect(
  p: SplineProfile,
  rect: Rect,
  size: SceneSize,
  spacing: number,
  radius: number,
  visit: (i: number, j: number, d: number, seg: number, t: number) => void,
): void {
  const { xs, zs } = p.samples
  const w = rect.x1 - rect.x0 + 1
  const dist = new Float64Array(w * (rect.z1 - rect.z0 + 1)).fill(Infinity)
  const seg = new Int32Array(dist.length)
  const ts = new Float64Array(dist.length)
  const half = size / 2
  for (let k = 0; k + 1 < xs.length; k++) {
    const ax = xs[k]
    const az = zs[k]
    const ex = xs[k + 1] - ax
    const ez = zs[k + 1] - az
    const len2 = ex * ex + ez * ez
    const box = {
      x0: Math.floor((Math.min(ax, ax + ex) - radius + half) / spacing),
      z0: Math.floor((Math.min(az, az + ez) - radius + half) / spacing),
      x1: Math.ceil((Math.max(ax, ax + ex) + radius + half) / spacing),
      z1: Math.ceil((Math.max(az, az + ez) + radius + half) / spacing),
    }
    const r = intersect(box, rect)
    if (!r) continue
    for (let j = r.z0; j <= r.z1; j++) {
      const z = -half + j * spacing
      for (let i = r.x0; i <= r.x1; i++) {
        const x = -half + i * spacing
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / len2)) : 0
        const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t))
        const l = (j - rect.z0) * w + (i - rect.x0)
        if (d <= radius && d < dist[l]) {
          dist[l] = d
          seg[l] = k
          ts[l] = t
        }
      }
    }
  }
  for (let l = 0; l < dist.length; l++) {
    if (dist[l] === Infinity) continue
    visit(rect.x0 + (l % w), rect.z0 + Math.floor(l / w), dist[l], seg[l], ts[l])
  }
}

/** Paths first, then rivers, each in drawing order; zero-length splines carve nothing. */
function carvingOrder(profiles: SplineProfile[]): SplineProfile[] {
  const live = profiles.filter((p) => p.samples.xs.length > 1 && p.footprint)
  return [...live.filter((p) => p.spline.kind === 'path'), ...live.filter((p) => p.spline.kind === 'river')]
}

/**
 * Writes carved heights and surface weights for the height samples inside `rect` (and nowhere else). Samples
 * outside every footprint get the base height and no surface.
 */
export function carveRect(base: Heightmap, profiles: SplineProfile[], rect: Rect, outHeights: Float32Array, outSurface: SurfaceMap): void {
  const res = base.resolution
  for (let j = rect.z0; j <= rect.z1; j++) {
    const row = j * res
    outHeights.set(base.data.subarray(row + rect.x0, row + rect.x1 + 1), row + rect.x0)
    outSurface.kind.fill(0, row + rect.x0, row + rect.x1 + 1)
    outSurface.weight.fill(0, row + rect.x0, row + rect.x1 + 1)
  }
  const visitHeights = (p: SplineProfile, r: Rect, radius: number, visit: (idx: number, d: number, k: number, t: number) => void) =>
    nearestInRect(p, r, base.size, HEIGHT_SPACING, radius, (i, j, d, k, t) => visit(j * res + i, d, k, t))
  for (const p of carvingOrder(profiles)) {
    const r = intersect(p.footprint!, rect)
    if (!r) continue
    const s = p.spline
    const hw = s.width / 2
    const shoulder = FEATURES[s.kind].shoulder
    const lerp = (a: Float32Array, k: number, t: number) => a[k] + (a[k + 1] - a[k]) * t
    if (s.kind === 'path') {
      const kind = s.style === 'cobble' ? SURFACE.cobble : SURFACE.dirt
      const verge = hw + FEATURES.path.verge.width
      visitHeights(p, r, hw + shoulder, (idx, d, k, t) => {
        const w = d <= hw ? 1 : 1 - smoothstep(hw, hw + shoulder, d)
        const h = outHeights[idx]
        if (w > 0) outHeights[idx] = h + (lerp(p.grade, k, t) - h) * w
        if (d <= hw) paint(outSurface, idx, kind)
        else if (d <= verge) paint(outSurface, idx, SURFACE.verge)
      })
    } else {
      const depth = riverDepth(s.width)
      visitHeights(p, r, hw + shoulder, (idx, d, k, t) => {
        const h = outHeights[idx]
        if (d <= hw) {
          const bed = lerp(p.water!, k, t) - depth * (1 - (d / hw) ** 2)
          outHeights[idx] = Math.min(h, bed)
          paint(outSurface, idx, SURFACE.bed)
        } else {
          const w = 1 - smoothstep(hw, hw + shoulder, d)
          outHeights[idx] = Math.min(h, h + (lerp(p.grade, k, t) - h) * w)
        }
      })
    }
  }
}

function paint(surface: SurfaceMap, idx: number, kind: number): void {
  surface.kind[idx] = kind
  surface.weight[idx] = 255
}

/**
 * Marks biome samples (1 m grid) inside `rect` that are the nearest sample to any point within a spline's
 * width plus its clear margin; clears the rest of `rect`.
 */
export function exclusionRect(profiles: SplineProfile[], biomeRes: number, size: SceneSize, rect: Rect, out: Uint8Array): void {
  for (let j = rect.z0; j <= rect.z1; j++) out.fill(0, j * biomeRes + rect.x0, j * biomeRes + rect.x1 + 1)
  for (const p of carvingOrder(profiles)) {
    // Scatter looks up the nearest sample, up to √½ m from the candidate; padding by that much keeps every candidate
    // within width/2 + margin of the centreline off the ground.
    const radius = p.spline.width / 2 + FEATURES[p.spline.kind].clearMargin + Math.SQRT1_2
    const box = indexRect(splineBounds(p.samples, radius), size, 1, biomeRes)
    const r = box && intersect(box, rect)
    if (r) nearestInRect(p, r, size, 1, radius, (i, j) => (out[j * biomeRes + i] = 1))
  }
}
