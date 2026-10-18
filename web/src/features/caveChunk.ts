import { CHUNK_VERTS, chunkCount, terrainColorAt, terrainColorWithSlope, type ChunkGeometry } from '../terrain/chunks'
import { HEIGHT_SPACING, type TerrainLayers } from '../terrain/layers'
import { hexToLinear, type TerrainPalette } from '../terrain/palette'
import { meshSdfChunk } from '../terrain/sdfChunk'
import { VALUE_LIMIT } from '../terrain/volume'
import { SURFACE, type SurfaceMap } from './carve'
import { smoothMin, type CaveProfile } from './caves'
import { FEATURES } from './features'

const ROCK = hexToLinear(FEATURES.cave.rockColor)
const FLOOR = hexToLinear(FEATURES.cave.floorColor)
const { groundBlend } = FEATURES.cave
/** A path's corridor is air from its surface up to this height (metres). */
const PATH_CLEARANCE = 4

/**
 * Cave distances on one chunk's lattice, filled in as they are asked for. Cave distance doesn't depend on the
 * heights, so it survives terrain strokes; callers drop it when the caves change. Distances outside the caves'
 * vertical range are not stored.
 */
export class CaveDistanceCache {
  private readonly data: Float64Array
  private readonly ci: number
  private readonly cj: number
  private readonly yMin: number
  private readonly levels: number

  constructor(ci: number, cj: number, yMin: number, levels: number) {
    this.ci = ci
    this.cj = cj
    this.yMin = yMin
    this.levels = levels
    this.data = new Float64Array(CHUNK_VERTS * CHUNK_VERTS * levels).fill(NaN)
  }

  /** The distance at lattice point (i, j) and height y (a multiple of the sample spacing), computed once. */
  at(i: number, j: number, y: number, compute: (i: number, j: number, y: number) => number): number {
    const k = Math.round((y - this.yMin) / HEIGHT_SPACING)
    if (k < 0 || k >= this.levels) return compute(i, j, y)
    const at = (k * CHUNK_VERTS + (j - this.cj)) * CHUNK_VERTS + (i - this.ci)
    const known = this.data[at]
    if (known === known) return known
    return (this.data[at] = compute(i, j, y))
  }
}

/** Where a chunk's cache lives between builds; empty until the first build fills it in. */
export interface CaveDistanceHolder {
  cache: CaveDistanceCache | null
}

/**
 * Meshes a chunk that caves or sculpted bricks reach from the density
 * smooth-min(min(max(ground − y, A), −K, −path clearance), cave distance), which rounds the rim where a cave
 * breaks the surface. Ground vertices take the heightmap colours of their lattice edge; cave vertices are rock,
 * or moss where they face up; vertices over a brick are shaded from their true normal (earth under an overhang).
 */
export function buildSdfChunk(layers: TerrainLayers, surface: SurfaceMap, caves: CaveProfile[], chunk: number, p: TerrainPalette, holder?: CaveDistanceHolder): ChunkGeometry {
  const { size, resolution: res, data: h } = layers.heights
  const half = size / 2
  const n = chunkCount(size)
  const cells = CHUNK_VERTS - 1
  const ci = (chunk % n) * cells
  const cj = Math.floor(chunk / n) * cells

  // From under the lowest cave floor (and ground) to over the highest ground: solid at the bottom, air on top.
  let lo = Infinity
  let hi = -Infinity
  for (let j = cj; j <= cj + cells; j++)
    for (let i = ci; i <= ci + cells; i++) {
      lo = Math.min(lo, h[j * res + i])
      hi = Math.max(hi, h[j * res + i])
    }
  for (const c of caves) lo = Math.min(lo, c.bounds.y0)

  // Sculpted bricks widen the range up and down, and the band per column below.
  const volume = layers.volume
  const useVolume = volume.count > 0
  const ab = { a: 0, k: 0 }
  const onPath = (i: number, j: number) => surface.kind[Math.min(res - 1, Math.max(0, j)) * res + Math.min(res - 1, Math.max(0, i))] !== SURFACE.none
  if (useVolume) {
    for (let j = cj - 1; j <= cj + cells + 1; j++)
      for (let i = ci - 1; i <= ci + cells + 1; i++) {
        const r = volume.columnRange(i, j)
        if (r) {
          lo = Math.min(lo, r[0] - 2)
          hi = Math.max(hi, r[1] + 2)
        }
        if (onPath(i, j)) hi = Math.max(hi, h[Math.min(res - 1, Math.max(0, j)) * res + Math.min(res - 1, Math.max(0, i))] + PATH_CLEARANCE)
      }
  }

  const caveAt = (x: number, y: number, z: number) => {
    let d = Infinity
    for (const c of caves) d = Math.min(d, c.sdf(x, y, z))
    return d
  }
  const wx = (i: number) => -half + i * HEIGHT_SPACING
  // Air lies above the ground and, away from caves, solid a metre below it; under a cave, solid starts below its
  // lowest point by more than the blends can lift the field.
  const caveDepth = groundBlend + FEATURES.cave.blend
  const clampIndex = (v: number) => Math.min(res - 1, Math.max(0, v))
  const band = (i: number, j: number): readonly [number, number] => {
    const ground = h[clampIndex(j) * res + clampIndex(i)]
    let floor = ground - 1
    let top = ground
    for (const c of caves) {
      const fp = c.footprint
      if (fp && i >= fp.x0 && i <= fp.x1 && j >= fp.z0 && j <= fp.z1) floor = Math.min(floor, c.bounds.y0 - caveDepth)
    }
    if (useVolume) {
      const r = volume.columnRange(i, j)
      if (r) {
        floor = Math.min(floor, r[0] - 2)
        top = Math.max(top, r[1] + 2)
      }
      if (onPath(i, j)) top = Math.max(top, ground + PATH_CLEARANCE)
    }
    return [floor, top]
  }
  const caveAtLattice = (i: number, j: number, y: number) => caveAt(wx(i), y, wx(j))
  let distances = holder?.cache ?? null
  if (holder && !distances && caves.length > 0) {
    let y0 = Infinity
    let y1 = -Infinity
    for (const c of caves) {
      y0 = Math.min(y0, c.bounds.y0)
      y1 = Math.max(y1, c.bounds.y1)
    }
    const yMin = Math.floor((y0 - 1) / HEIGHT_SPACING) * HEIGHT_SPACING
    distances = holder.cache = new CaveDistanceCache(ci, cj, yMin, Math.ceil((y1 + 1 - yMin) / HEIGHT_SPACING) + 1)
  }
  const caveDistance = distances ? (i: number, j: number, y: number) => distances.at(i, j, y, caveAtLattice) : caveAtLattice
  const density = (i: number, j: number, y: number) => {
    const ground = h[j * res + i]
    if (!useVolume) return smoothMin(ground - y, caveDistance(i, j, y), groundBlend)
    volume.sampleLattice(i, j, y, ab)
    // Away from every brick the field is exactly the heightmap's (a path's clearance only matters where A reaches over it).
    if (ab.a === -VALUE_LIMIT && ab.k === -VALUE_LIMIT) return smoothMin(ground - y, caveDistance(i, j, y), groundBlend)
    let s = Math.min(Math.max(ground - y, ab.a), -ab.k)
    if (surface.kind[j * res + i] !== SURFACE.none) s = Math.min(s, -Math.min(y - ground, ground + PATH_CLEARANCE - y))
    return smoothMin(s, caveDistance(i, j, y), groundBlend)
  }
  const mesh = meshSdfChunk(size, chunk, density, lo - 1, hi + 1, band)
  const { positions, indices, edgeA, edgeB, t } = mesh
  const count = t.length

  // Area-weighted vertex normals' y, to tell cave floors from walls.
  const up = new Float32Array(count)
  const len = new Float32Array(count)
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f] * 3
    const b = indices[f + 1] * 3
    const c = indices[f + 2] * 3
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const area = Math.hypot(nx, ny, nz)
    for (const v of [indices[f], indices[f + 1], indices[f + 2]]) {
      up[v] += ny
      len[v] += area
    }
  }

  // Terrain colour per lattice sample, computed once.
  const sampleColor = new Map<number, number>()
  const cache: number[] = []
  const tmp = new Float32Array(3)
  const colorOf = (s: number) => {
    let at = sampleColor.get(s)
    if (at === undefined) {
      terrainColorAt(layers, s % res, Math.floor(s / res), p, surface, tmp, 0)
      at = cache.length
      cache.push(tmp[0], tmp[1], tmp[2])
      sampleColor.set(s, at)
    }
    return at
  }

  const colors = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) {
    const k = v * 3
    const a = edgeA[v]
    const b = edgeB[v]
    const ground = h[a] + (h[b] - h[a]) * t[v] - positions[k + 1]
    if (caveAt(positions[k], positions[k + 1], positions[k + 2]) < ground) {
      const c = len[v] > 0 && up[v] / len[v] > FEATURES.cave.floorUp ? FLOOR : ROCK
      colors.set(c, k)
      continue
    }
    if (useVolume) {
      // Over a brick the heightmap slope no longer describes the surface: shade from the true normal.
      const near = t[v] < 0.5 ? a : b
      const ni = near % res
      const nj = Math.floor(near / res)
      if (volume.columnRange(ni, nj)) {
        const ny = len[v] > 0 ? up[v] / len[v] : 1
        if (ny < 0) colors.set(p.earth.color, k)
        else terrainColorWithSlope(layers, ni, nj, p, surface, Math.acos(Math.min(1, ny)), colors, k)
        continue
      }
    }
    const ca = colorOf(a)
    const cb = colorOf(b)
    for (let c = 0; c < 3; c++) colors[k + c] = cache[ca + c] + (cache[cb + c] - cache[ca + c]) * t[v]
  }
  return { positions, colors, indices }
}
