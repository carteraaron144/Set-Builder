import { clipRect, type Rect, type TerrainLayers } from '../terrain/layers'
import { carveRect, exclusionRect, profileSpline, type SplineProfile, type SurfaceMap } from './carve'
import type { Features, Spline } from './features'
import { floodPond, type PondFill } from './ponds'

const overlaps = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1

const union = (a: Rect, b: Rect): Rect => ({
  x0: Math.min(a.x0, b.x0),
  z0: Math.min(a.z0, b.z0),
  x1: Math.max(a.x1, b.x1),
  z1: Math.max(a.z1, b.z1),
})

const sameSpline = (a: Spline | undefined, b: Spline) => a !== undefined && JSON.stringify(a) === JSON.stringify(b)

function sameFill(a: PondFill, b: PondFill): boolean {
  if (a.level !== b.level || a.capped !== b.capped) return false
  if (!a.bounds || !b.bounds) return a.bounds === b.bounds
  const res = Math.sqrt(a.mask.length)
  const r = union(a.bounds, b.bounds)
  for (let j = r.z0; j <= r.z1; j++)
    for (let i = r.x0; i <= r.x1; i++) if (a.mask[j * res + i] !== b.mask[j * res + i]) return false
  return true
}

/**
 * The terrain as shown: the sculpted layers with paths and rivers carved in, surface colours, flooded ponds,
 * and where scatter is cleared. Derived from the layers and features, never saved.
 */
export class Ground {
  readonly layers: TerrainLayers
  readonly surface: SurfaceMap
  profiles: SplineProfile[] = []
  ponds: PondFill[] = []
  /** Bumped whenever river or pond water may have changed. */
  waterVersion = 0
  private readonly base: TerrainLayers
  private features: Features = { splines: [], ponds: [] }
  /** Scatter cleared by splines and by ponds, on the biome grid; combined into `exclusion`. */
  private readonly splineClear: Uint8Array
  private readonly pondClear: Uint8Array
  private combined: Uint8Array | null = null

  constructor(base: TerrainLayers, features: Features) {
    this.base = base
    const h = base.heights
    this.layers = { heights: { ...h, data: h.data.slice() }, biomes: base.biomes }
    const n = h.resolution * h.resolution
    this.surface = { kind: new Uint8Array(n), weight: new Uint8Array(n) }
    const b = base.biomes.resolution
    this.splineClear = new Uint8Array(b * b)
    this.pondClear = new Uint8Array(b * b)
    this.rebuild(features, null)
  }

  /** Scatter exclusion per biome sample (1 = cleared); null when there are no features. */
  get exclusion(): Uint8Array | null {
    return this.combined
  }

  /**
   * Re-derives the ground for new features and/or base heights changed inside `heightRect`. Returns the
   * height-sample rects whose carved heights, surface or exclusion may have changed.
   */
  rebuild(features: Features, heightRect: Rect | null): Rect[] {
    const res = this.base.heights.resolution
    const old = this.features
    const rects: Rect[] = heightRect ? [heightRect] : []
    let waterChanged = false
    const profiles = features.splines.map((s, i) => {
      const prev = this.profiles[i]
      const unchanged = sameSpline(old.splines[i], s)
      if (unchanged && !(heightRect && prev.footprint && overlaps(prev.footprint, heightRect))) return prev
      const p = profileSpline(this.base.heights, s)
      if (p.footprint) rects.push(p.footprint)
      if (s.kind === 'river' && (!unchanged || p.footprint)) waterChanged = true
      return p
    })
    // Splines that changed or went away also clear their old footprint.
    this.profiles.forEach((p, i) => {
      if (sameSpline(features.splines[i], p.spline)) return
      if (p.footprint) rects.push(p.footprint)
      if (p.spline.kind === 'river') waterChanged = true
    })
    this.profiles = profiles
    this.features = features

    for (const r of rects) carveRect(this.base.heights, profiles, r, this.layers.heights.data, this.surface)
    const bRes = this.base.biomes.resolution
    for (const r of rects) {
      const br = clipRect({ x0: Math.floor(r.x0 / 2), z0: Math.floor(r.z0 / 2), x1: Math.ceil(r.x1 / 2), z1: Math.ceil(r.z1 / 2) }, bRes)
      if (br) exclusionRect(profiles, bRes, this.base.heights.size, br, this.splineClear)
    }

    const ponds = features.ponds.map((p) => floodPond(this.layers.heights, p))
    let pondsChanged = ponds.length !== this.ponds.length
    for (let i = 0; i < Math.max(ponds.length, this.ponds.length); i++) {
      const a = this.ponds[i]
      const b = ponds[i]
      if (a && b && sameFill(a, b)) continue
      pondsChanged = true
      // Pond exclusion reaches 1 m (2 samples) past the flooded samples.
      for (const bounds of [a?.bounds, b?.bounds]) {
        const r = bounds && clipRect({ x0: bounds.x0 - 3, z0: bounds.z0 - 3, x1: bounds.x1 + 3, z1: bounds.z1 + 3 }, res)
        if (r) rects.push(r)
      }
    }
    this.ponds = ponds
    if (pondsChanged) this.clearAroundPonds()
    if (waterChanged || pondsChanged) this.waterVersion++

    const any = features.splines.length > 0 || features.ponds.length > 0
    if (!any) this.combined = null
    else {
      this.combined ??= new Uint8Array(this.splineClear.length)
      for (let i = 0; i < this.combined.length; i++) this.combined[i] = this.splineClear[i] | this.pondClear[i]
    }
    return rects
  }

  /** Marks biome samples within 1 m of a flooded height sample. */
  private clearAroundPonds(): void {
    const res = this.base.heights.resolution
    const bRes = this.base.biomes.resolution
    const out = this.pondClear
    out.fill(0)
    for (const p of this.ponds) {
      if (!p.bounds) continue
      for (let j = p.bounds.z0; j <= p.bounds.z1; j++)
        for (let i = p.bounds.x0; i <= p.bounds.x1; i++) {
          if (!p.mask[j * res + i]) continue
          // Height sample (i, j) is at biome coordinates (i/2, j/2); mark biome samples within 1 m.
          for (let bj = Math.ceil(j / 2 - 1); bj <= Math.floor(j / 2 + 1); bj++)
            for (let bi = Math.ceil(i / 2 - 1); bi <= Math.floor(i / 2 + 1); bi++) {
              if (bi < 0 || bj < 0 || bi >= bRes || bj >= bRes) continue
              if ((bi - i / 2) ** 2 + (bj - j / 2) ** 2 <= 1) out[bj * bRes + bi] = 1
            }
        }
    }
  }
}
