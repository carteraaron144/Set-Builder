import { buildChunkGeometry, CHUNK_VERTS, chunkCount, type ChunkGeometry } from '../terrain/chunks'
import { BIOME_SPACING, clipRect, HEIGHT_SPACING, heightAt, type Rect, type TerrainLayers } from '../terrain/layers'
import { DEFAULT_PALETTE, type TerrainPalette } from '../terrain/palette'
import { raycastTerrain, type Vec3 } from '../terrain/pick'
import { buildCaveChunk } from './caveChunk'
import { caveGlowChunk } from './caveGlow'
import { cavesReaching, profileCave, smoothMin, type CaveProfile } from './caves'
import { carveRect, exclusionRect, profileSpline, SURFACE, type SplineProfile, type SurfaceMap } from './carve'
import { FEATURES, type Cave, type Features, type Spline } from './features'
import { floodPond, type PondFill } from './ponds'

const overlaps = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1

const union = (a: Rect, b: Rect): Rect => ({
  x0: Math.min(a.x0, b.x0),
  z0: Math.min(a.z0, b.z0),
  x1: Math.max(a.x1, b.x1),
  z1: Math.max(a.z1, b.z1),
})

const sameSpline = (a: Spline | undefined, b: Spline) => a !== undefined && JSON.stringify(a) === JSON.stringify(b)
const sameCave = (a: Cave | undefined, b: Cave) => a !== undefined && JSON.stringify(a) === JSON.stringify(b)

function sameFill(a: PondFill, b: PondFill): boolean {
  if (a.level !== b.level || a.capped !== b.capped) return false
  if (!a.bounds || !b.bounds) return a.bounds === b.bounds
  const res = Math.sqrt(a.mask.length)
  const r = union(a.bounds, b.bounds)
  for (let j = r.z0; j <= r.z1; j++)
    for (let i = r.x0; i <= r.x1; i++) if (a.mask[j * res + i] !== b.mask[j * res + i]) return false
  return true
}

/** A path's corridor is air from its surface up to this height (metres). */
const PATH_CLEARANCE = 4

/**
 * The terrain as shown: the sculpted layers with paths and rivers carved in, surface colours, flooded ponds,
 * caves hollowed out, and where scatter is cleared. Derived from the layers and features, never saved.
 */
export class Ground {
  readonly layers: TerrainLayers
  readonly surface: SurfaceMap
  profiles: SplineProfile[] = []
  ponds: PondFill[] = []
  caves: CaveProfile[] = []
  /** Bumped whenever river or pond water may have changed. */
  waterVersion = 0
  private readonly base: TerrainLayers
  private features: Features = { splines: [], ponds: [], caves: [] }
  /** Scatter cleared by splines and by ponds, on the biome grid; combined into `exclusion`. */
  private readonly splineClear: Uint8Array
  private readonly pondClear: Uint8Array
  private readonly caveClear: Uint8Array
  private combined: Uint8Array | null = null
  /** Per chunk: 1 where its sample square meets a brick footprint. */
  private readonly volumeChunks: Uint8Array
  private volumeFootprints: Rect[] = []
  private readonly volumeAB = { a: 0, k: 0 }

  constructor(base: TerrainLayers, features: Features) {
    this.base = base
    const h = base.heights
    this.layers = { heights: { ...h, data: h.data.slice() }, biomes: base.biomes, volume: base.volume }
    const n = h.resolution * h.resolution
    this.surface = { kind: new Uint8Array(n), weight: new Uint8Array(n) }
    const b = base.biomes.resolution
    this.splineClear = new Uint8Array(b * b)
    this.pondClear = new Uint8Array(b * b)
    this.caveClear = new Uint8Array(b * b)
    const chunks = chunkCount(h.size)
    this.volumeChunks = new Uint8Array(chunks * chunks)
    this.refreshVolume()
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

    const caves = features.caves.map((c, i) => (sameCave(old.caves[i], c) ? this.caves[i] : profileCave(this.base.heights, c)))
    let cavesChanged = caves.length !== this.caves.length
    for (let i = 0; i < Math.max(caves.length, this.caves.length); i++) {
      if (caves[i] === this.caves[i]) continue
      cavesChanged = true
      for (const fp of [this.caves[i]?.footprint, caves[i]?.footprint]) if (fp) rects.push(fp)
    }
    this.caves = caves

    // Cave exclusion reads the carved heights, so it follows any change under a cave.
    const underCave = rects.some((r) => caves.some((c) => c.footprint && overlaps(c.footprint, r)))
    if (cavesChanged || underCave) this.clearAroundCaves()

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

    const any = features.splines.length > 0 || features.ponds.length > 0 || features.caves.length > 0
    if (!any) this.combined = null
    else {
      this.combined ??= new Uint8Array(this.splineClear.length)
      for (let i = 0; i < this.combined.length; i++) this.combined[i] = this.splineClear[i] | this.pondClear[i] | this.caveClear[i]
    }
    return rects
  }

  /** Signed distance to the nearest cave (negative inside one); Infinity well away from every cave. */
  caveDistance(x: number, y: number, z: number): number {
    let d = Infinity
    for (const c of this.caves) d = Math.min(d, c.sdf(x, y, z))
    return d
  }

  /**
   * Solid density at a world point: positive inside the ground, negative in air or a cave; the two blend where a cave breaks the surface.
   * Sculpted bricks add material (A) and remove it (K), and a path's corridor is air from its surface up to 4 m. `ignoreCaves` drops only the cave term.
   */
  density(x: number, y: number, z: number, ignoreCaves = false): number {
    const h = heightAt(this.layers.heights, x, z)
    const cave = ignoreCaves ? Infinity : this.caveDistance(x, y, z)
    const volume = this.layers.volume
    if (volume.count === 0) return smoothMin(h - y, cave, FEATURES.cave.groundBlend)
    const ab = this.volumeAB
    volume.sample(x, y, z, ab)
    let s = Math.min(Math.max(h - y, ab.a), -ab.k)
    const { resolution, size } = this.layers.heights
    const i = Math.min(resolution - 1, Math.max(0, Math.round((x + size / 2) / HEIGHT_SPACING)))
    const j = Math.min(resolution - 1, Math.max(0, Math.round((z + size / 2) / HEIGHT_SPACING)))
    if (this.surface.kind[j * resolution + i] !== SURFACE.none) s = Math.min(s, -Math.min(y - h, h + PATH_CLEARANCE - y))
    return smoothMin(s, cave, FEATURES.cave.groundBlend)
  }

  /** Where a ray first meets the ground as shown, caves included unless `ignoreCaves`, or null. */
  raycast(origin: Vec3, dir: Vec3, ignoreCaves = false): Vec3 | null {
    const useDensity = this.layers.volume.count > 0 || (this.caves.length > 0 && !ignoreCaves)
    const density = useDensity ? (x: number, y: number, z: number) => this.density(x, y, z, ignoreCaves) : undefined
    return raycastTerrain(this.layers.heights, origin, dir, 2000, density)
  }

  /** Whether chunk `chunk` is meshed from the density field: its sample square meets a cave or brick footprint. */
  isSdfChunk(chunk: number): boolean {
    return this.cavesOf(chunk).length > 0 || this.hasVolume(chunk)
  }

  /** Whether chunk `chunk`'s sample square meets a brick footprint. */
  hasVolume(chunk: number): boolean {
    return this.volumeChunks[chunk] === 1
  }

  /** Recomputes the brick footprints and per-chunk flags; returns the old and new footprints so the caller can dirty their chunks. */
  refreshVolume(): Rect[] {
    const old = this.volumeFootprints
    const fresh = this.layers.volume.footprints()
    this.volumeFootprints = fresh
    const n = chunkCount(this.layers.heights.size)
    const cells = CHUNK_VERTS - 1
    this.volumeChunks.fill(0)
    for (const f of fresh) {
      const cx0 = Math.max(0, Math.ceil(f.x0 / cells) - 1)
      const cx1 = Math.min(n - 1, Math.floor(f.x1 / cells))
      const cz0 = Math.max(0, Math.ceil(f.z0 / cells) - 1)
      const cz1 = Math.min(n - 1, Math.floor(f.z1 / cells))
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.volumeChunks[cz * n + cx] = 1
    }
    return [...old, ...fresh]
  }

  /** The chunk's mesh: the heightmap grid, or the density field's surface where caves reach it (unless `ignoreCaves`). */
  chunkGeometry(chunk: number, palette: TerrainPalette = DEFAULT_PALETTE, ignoreCaves = false): ChunkGeometry {
    const caves = ignoreCaves ? [] : this.cavesOf(chunk)
    if (caves.length === 0) return buildChunkGeometry(this.layers, chunk, palette, this.surface)
    return buildCaveChunk(this.layers, this.surface, caves, chunk, palette)
  }

  /** The caves alone, meshed inside chunk `chunk` (for a see-through glow); null if no cave reaches it. */
  caveGlowGeometry(chunk: number): { positions: Float32Array; indices: Uint32Array } | null {
    return caveGlowChunk(this.caves, chunk, this.layers.heights.size)
  }

  private cavesOf(chunk: number): CaveProfile[] {
    return cavesReaching(this.caves, chunk, this.base.heights.size)
  }

  /** Marks biome samples where a cave comes within the clear margin of the ground surface. */
  private clearAroundCaves(): void {
    const out = this.caveClear
    out.fill(0)
    const { size } = this.base.heights
    const bRes = this.base.biomes.resolution
    const half = size / 2
    const toBiome = HEIGHT_SPACING / BIOME_SPACING
    for (const c of this.caves) {
      const fp = c.footprint && clipRect({ x0: Math.floor(c.footprint.x0 * toBiome), z0: Math.floor(c.footprint.z0 * toBiome), x1: Math.ceil(c.footprint.x1 * toBiome), z1: Math.ceil(c.footprint.z1 * toBiome) }, bRes)
      if (!fp) continue
      for (let bj = fp.z0; bj <= fp.z1; bj++)
        for (let bi = fp.x0; bi <= fp.x1; bi++) {
          const x = -half + bi * BIOME_SPACING
          const z = -half + bj * BIOME_SPACING
          if (c.sdf(x, heightAt(this.layers.heights, x, z), z) < FEATURES.cave.clearMargin) out[bj * bRes + bi] = 1
        }
    }
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
