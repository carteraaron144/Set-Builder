import type { SceneSize } from '../scene/scene'

export const HEIGHT_SPACING = 0.5
export const BIOME_SPACING = 1
export const MIN_HEIGHT = -32
export const MAX_HEIGHT = 64

export type BiomeId = 'meadow' | 'forest' | 'rocky' | 'swamp'

/** Channel order in the biome map (RGBA). */
export const BIOME_IDS: readonly BiomeId[] = ['meadow', 'forest', 'rocky', 'swamp']

/**
 * Heights in metres at 0.5 m spacing, resolution = size*2+1.
 * Sample (i, j) is at world x = -size/2 + 0.5·i, z = -size/2 + 0.5·j; data[j*res + i].
 */
export interface Heightmap {
  size: SceneSize
  resolution: number
  data: Float32Array
}

/** Biome weights at 1 m spacing, resolution = size+1, 4 bytes per sample summing to 255. */
export interface BiomeMap {
  size: SceneSize
  resolution: number
  data: Uint8Array
}

export interface TerrainLayers {
  heights: Heightmap
  biomes: BiomeMap
}

/** Inclusive sample-index rectangle. */
export interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

export function createFlatLayers(size: SceneSize): TerrainLayers {
  const hRes = size * 2 + 1
  const bRes = size + 1
  const biomes = new Uint8Array(bRes * bRes * 4)
  for (let i = 0; i < biomes.length; i += 4) biomes[i] = 255
  return {
    heights: { size, resolution: hRes, data: new Float32Array(hRes * hRes) },
    biomes: { size, resolution: bRes, data: biomes },
  }
}

/** Continuous sample coordinates for a world position, clamped to the grid. */
function gridCoord(world: number, size: number, spacing: number, resolution: number): number {
  const g = (world + size / 2) / spacing
  return Math.min(resolution - 1, Math.max(0, g))
}

/** Bilinear interpolation over a channels-per-sample grid. */
function bilinear(data: ArrayLike<number>, res: number, channels: number, channel: number, gx: number, gz: number): number {
  const i0 = Math.min(res - 2, Math.floor(gx))
  const j0 = Math.min(res - 2, Math.floor(gz))
  const fx = gx - i0
  const fz = gz - j0
  const at = (i: number, j: number) => data[(j * res + i) * channels + channel]
  const top = at(i0, j0) * (1 - fx) + at(i0 + 1, j0) * fx
  const bottom = at(i0, j0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1) * fx
  return top * (1 - fz) + bottom * fz
}

export function heightAt(h: Heightmap, x: number, z: number): number {
  const gx = gridCoord(x, h.size, HEIGHT_SPACING, h.resolution)
  const gz = gridCoord(z, h.size, HEIGHT_SPACING, h.resolution)
  return bilinear(h.data, h.resolution, 1, 0, gx, gz)
}

export function biomeWeightsAt(b: BiomeMap, x: number, z: number): [number, number, number, number] {
  const gx = gridCoord(x, b.size, BIOME_SPACING, b.resolution)
  const gz = gridCoord(z, b.size, BIOME_SPACING, b.resolution)
  const w = (c: number) => bilinear(b.data, b.resolution, 4, c, gx, gz) / 255
  return [w(0), w(1), w(2), w(3)]
}

export function clipRect(r: Rect, resolution: number): Rect | null {
  const max = resolution - 1
  const clipped = {
    x0: Math.max(0, r.x0),
    z0: Math.max(0, r.z0),
    x1: Math.min(max, r.x1),
    z1: Math.min(max, r.z1),
  }
  return clipped.x0 > clipped.x1 || clipped.z0 > clipped.z1 ? null : clipped
}

export function cropRect<T extends Float32Array | Uint8Array>(data: T, resolution: number, channels: 1 | 4, r: Rect): T {
  const rowLen = (r.x1 - r.x0 + 1) * channels
  const out = new (data.constructor as { new (n: number): T })(rowLen * (r.z1 - r.z0 + 1))
  for (let j = r.z0; j <= r.z1; j++) {
    const start = (j * resolution + r.x0) * channels
    out.set(data.subarray(start, start + rowLen), (j - r.z0) * rowLen)
  }
  return out
}

export function pasteRect<T extends Float32Array | Uint8Array>(data: T, resolution: number, channels: 1 | 4, r: Rect, src: T): void {
  const rowLen = (r.x1 - r.x0 + 1) * channels
  for (let j = r.z0; j <= r.z1; j++) {
    const row = src.subarray((j - r.z0) * rowLen, (j - r.z0 + 1) * rowLen)
    data.set(row, (j * resolution + r.x0) * channels)
  }
}

export function cloneLayers(l: TerrainLayers): TerrainLayers {
  return {
    heights: { ...l.heights, data: l.heights.data.slice() },
    biomes: { ...l.biomes, data: l.biomes.data.slice() },
  }
}

/** Writes 4 weights that sum to 1 as bytes that sum to exactly 255 (largest remainder). */
export function quantizeWeights(weights: number[], out: Uint8Array, offset: number): void {
  const scaled = weights.map((w) => w * 255)
  const floors = scaled.map(Math.floor)
  let remainder = 255 - floors.reduce((a, c) => a + c, 0)
  const order = [0, 1, 2, 3].sort((a, c) => scaled[c] - floors[c] - (scaled[a] - floors[a]))
  for (const c of order) {
    if (remainder <= 0) break
    floors[c]++
    remainder--
  }
  for (let c = 0; c < 4; c++) out[offset + c] = floors[c]
}
