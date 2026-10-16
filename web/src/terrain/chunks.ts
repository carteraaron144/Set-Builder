import type { SurfaceMap } from '../features/carve'
import type { SceneSize } from '../scene/scene'
import { HEIGHT_SPACING, type Rect, type TerrainLayers } from './layers'
import type { TerrainPalette } from './palette'

export const CHUNK_SIZE = 32 // metres
export const CHUNK_VERTS = CHUNK_SIZE / HEIGHT_SPACING + 1 // 65 per side
const CELLS = CHUNK_VERTS - 1

export function chunkCount(size: SceneSize): number {
  return size / CHUNK_SIZE
}

/** Chunks whose vertices (or slopes, which read ±1 sample) depend on samples in the rect. Sorted by index. */
export function chunksForHeightRect(r: Rect, size: SceneSize): number[] {
  const n = chunkCount(size)
  const x0 = r.x0 - 1
  const z0 = r.z0 - 1
  const x1 = r.x1 + 1
  const z1 = r.z1 + 1
  const out: number[] = []
  for (let cz = 0; cz < n; cz++) {
    if (z0 > cz * CELLS + CELLS || z1 < cz * CELLS) continue
    for (let cx = 0; cx < n; cx++) {
      if (x0 > cx * CELLS + CELLS || x1 < cx * CELLS) continue
      out.push(cz * n + cx)
    }
  }
  return out
}

/** Biome samples are 1 m apart and blend over ±1 m, i.e. ±2 height samples. */
export function chunksForBiomeRect(r: Rect, size: SceneSize): number[] {
  return chunksForHeightRect({ x0: r.x0 * 2 - 2, z0: r.z0 * 2 - 2, x1: r.x1 * 2 + 2, z1: r.z1 * 2 + 2 }, size)
}

export interface ChunkGeometry {
  positions: Float32Array
  colors: Float32Array
  indices: Uint16Array
}

function buildIndices(): Uint16Array {
  const indices = new Uint16Array(CELLS * CELLS * 6)
  let k = 0
  for (let j = 0; j < CELLS; j++)
    for (let i = 0; i < CELLS; i++) {
      const a = j * CHUNK_VERTS + i
      const b = a + CHUNK_VERTS
      const c = a + 1
      const d = b + 1
      // Counter-clockwise seen from above (+y).
      indices.set([a, b, c, c, b, d], k)
      k += 6
    }
  return indices
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function buildChunkGeometry(l: TerrainLayers, chunk: number, p: TerrainPalette, surface?: SurfaceMap): ChunkGeometry {
  const g = {
    positions: new Float32Array(CHUNK_VERTS * CHUNK_VERTS * 3),
    colors: new Float32Array(CHUNK_VERTS * CHUNK_VERTS * 3),
    indices: buildIndices(),
  }
  updateChunkGeometry(l, chunk, p, g, surface)
  return g
}

/**
 * Rewrites positions and colours for a chunk in place (the index buffer never changes). With a surface map, each
 * vertex colour is blended towards its surface colour by weight/255.
 */
export function updateChunkGeometry(l: TerrainLayers, chunk: number, p: TerrainPalette, g: ChunkGeometry, surface?: SurfaceMap): void {
  const { heights, biomes } = l
  const res = heights.resolution
  const h = heights.data
  const n = chunkCount(heights.size)
  const cx = chunk % n
  const cz = Math.floor(chunk / n)
  const half = heights.size / 2
  const b = biomes.data
  const bRes = biomes.resolution
  const pb = p.biomes
  for (let vj = 0; vj < CHUNK_VERTS; vj++) {
    const j = cz * CELLS + vj
    const z = -half + j * HEIGHT_SPACING
    // Height sample j sits on biome row j/2: either on a row or halfway between two (no allocation per vertex).
    const bj0 = Math.min(bRes - 1, j >> 1)
    const bj1 = Math.min(bRes - 1, bj0 + 1)
    const fz = (j & 1) * 0.5
    for (let vi = 0; vi < CHUNK_VERTS; vi++) {
      const i = cx * CELLS + vi
      const x = -half + i * HEIGHT_SPACING
      const k = (vj * CHUNK_VERTS + vi) * 3
      const y = h[j * res + i]
      g.positions[k] = x
      g.positions[k + 1] = y
      g.positions[k + 2] = z

      // Slope from central differences (one-sided at the scene edge).
      const il = Math.max(0, i - 1)
      const ir = Math.min(res - 1, i + 1)
      const jd = Math.max(0, j - 1)
      const ju = Math.min(res - 1, j + 1)
      const dx = (h[j * res + ir] - h[j * res + il]) / ((ir - il) * HEIGHT_SPACING)
      const dz = (h[ju * res + i] - h[jd * res + i]) / ((ju - jd) * HEIGHT_SPACING)
      const slope = Math.atan(Math.hypot(dx, dz))
      const earth = smoothstep(p.earth.start, p.earth.full, slope)
      const rock = smoothstep(p.rock.start, p.rock.full, slope)

      const bi0 = Math.min(bRes - 1, i >> 1)
      const bi1 = Math.min(bRes - 1, bi0 + 1)
      const fx = (i & 1) * 0.5
      const o00 = (bj0 * bRes + bi0) * 4
      const o10 = (bj0 * bRes + bi1) * 4
      const o01 = (bj1 * bRes + bi0) * 4
      const o11 = (bj1 * bRes + bi1) * 4
      const c00 = (1 - fx) * (1 - fz)
      const c10 = fx * (1 - fz)
      const c01 = (1 - fx) * fz
      const c11 = fx * fz
      const w0 = (b[o00] * c00 + b[o10] * c10 + b[o01] * c01 + b[o11] * c11) / 255
      const w1 = (b[o00 + 1] * c00 + b[o10 + 1] * c10 + b[o01 + 1] * c01 + b[o11 + 1] * c11) / 255
      const w2 = (b[o00 + 2] * c00 + b[o10 + 2] * c10 + b[o01 + 2] * c01 + b[o11 + 2] * c11) / 255
      const w3 = (b[o00 + 3] * c00 + b[o10 + 3] * c10 + b[o01 + 3] * c01 + b[o11 + 3] * c11) / 255
      const sw = surface ? surface.weight[j * res + i] / 255 : 0
      const sc = sw > 0 ? p.surface[surface!.kind[j * res + i] - 1] : null
      for (let c = 0; c < 3; c++) {
        const biome = w0 * pb[0][c] + w1 * pb[1][c] + w2 * pb[2][c] + w3 * pb[3][c]
        const ground = biome + (p.earth.color[c] - biome) * earth
        const terrain = ground + (p.rock.color[c] - ground) * rock
        g.colors[k + c] = sc ? terrain + (sc[c] - terrain) * sw : terrain
      }
    }
  }
}
