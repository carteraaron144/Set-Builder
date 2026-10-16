import { CHUNK_VERTS, chunkCount, terrainColorAt, type ChunkGeometry } from '../terrain/chunks'
import { HEIGHT_SPACING, type TerrainLayers } from '../terrain/layers'
import { hexToLinear, type TerrainPalette } from '../terrain/palette'
import { meshSdfChunk } from '../terrain/sdfChunk'
import type { SurfaceMap } from './carve'
import { smoothMin, type CaveProfile } from './caves'
import { FEATURES } from './features'

const ROCK = hexToLinear(FEATURES.cave.rockColor)
const FLOOR = hexToLinear(FEATURES.cave.floorColor)
const { groundBlend } = FEATURES.cave

/**
 * Meshes a chunk that caves reach from the density smooth-min(ground − y, cave distance), which rounds the rim
 * where a cave breaks the surface. Ground vertices take the
 * heightmap colours of their lattice edge; cave vertices are rock, or moss where they face up.
 */
export function buildCaveChunk(layers: TerrainLayers, surface: SurfaceMap, caves: CaveProfile[], chunk: number, p: TerrainPalette): ChunkGeometry {
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
    for (const c of caves) {
      const fp = c.footprint
      if (fp && i >= fp.x0 && i <= fp.x1 && j >= fp.z0 && j <= fp.z1) floor = Math.min(floor, c.bounds.y0 - caveDepth)
    }
    return [floor, ground]
  }
  const mesh = meshSdfChunk(size, chunk, (i, j, y) => smoothMin(h[j * res + i] - y, caveAt(wx(i), y, wx(j)), groundBlend), lo - 1, hi + 1, band)
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
    const ca = colorOf(a)
    const cb = colorOf(b)
    for (let c = 0; c < 3; c++) colors[k + c] = cache[ca + c] + (cache[cb + c] - cache[ca + c]) * t[v]
  }
  return { positions, colors, indices }
}
