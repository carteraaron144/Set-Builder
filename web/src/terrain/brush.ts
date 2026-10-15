import {
  BIOME_IDS,
  BIOME_SPACING,
  clipRect,
  HEIGHT_SPACING,
  MAX_HEIGHT,
  MIN_HEIGHT,
  quantizeWeights,
  type BiomeId,
  type BiomeMap,
  type Heightmap,
  type Rect,
} from './layers'
import { valueNoise2 } from './noise'

export type TerrainMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise'

/** radius in metres; strength and falloff 0..1. */
export interface BrushSettings {
  radius: number
  strength: number
  falloff: number
}

export const BRUSH_DEFAULTS: BrushSettings = { radius: 8, strength: 0.5, falloff: 0.5 }
export const BRUSH_RADIUS_MIN = 1
export const BRUSH_RADIUS_MAX = 50

// Rates at strength 1 (tune after playtesting).
const RAISE_RATE = 8 // m/s
const NOISE_RATE = 4 // m/s
const BLEND_RATE = 4 // 1/s for smooth, flatten and paint

/** One application of the brush, centred at world (x, z). */
export interface Dab {
  x: number
  z: number
  dt: number
  invert: boolean
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 1 inside radius·(1 - falloff), easing to 0 at the radius. */
export function brushWeight(distance: number, b: BrushSettings): number {
  if (distance >= b.radius) return 0
  const inner = b.radius * (1 - b.falloff)
  if (distance <= inner) return 1
  return smoothstep(b.radius, inner, distance)
}

/** Sample rect covered by a dab, clipped to the grid; null when it misses the grid. */
function dabRect(size: number, resolution: number, spacing: number, dab: Dab, radius: number): Rect | null {
  const half = size / 2
  return clipRect(
    {
      x0: Math.ceil((dab.x - radius + half) / spacing),
      z0: Math.ceil((dab.z - radius + half) / spacing),
      x1: Math.floor((dab.x + radius + half) / spacing),
      z1: Math.floor((dab.z + radius + half) / spacing),
    },
    resolution,
  )
}

/** Applies one terrain dab in place and returns the rect it covered. */
export function sculpt(
  h: Heightmap,
  mode: TerrainMode,
  b: BrushSettings,
  dab: Dab,
  ctx: { flattenTo: number; seed: number },
): Rect | null {
  const rect = dabRect(h.size, h.resolution, HEIGHT_SPACING, dab, b.radius)
  if (!rect) return null
  const { resolution: res, data } = h
  const half = h.size / 2
  const sign = dab.invert ? -1 : 1

  // Smoothing reads a copy so the result doesn't depend on iteration order.
  let source: Float32Array | null = null
  if (mode === 'smooth') source = data.slice()

  for (let j = rect.z0; j <= rect.z1; j++) {
    const z = -half + j * HEIGHT_SPACING
    for (let i = rect.x0; i <= rect.x1; i++) {
      const x = -half + i * HEIGHT_SPACING
      const w = brushWeight(Math.hypot(x - dab.x, z - dab.z), b)
      if (w === 0) continue
      const idx = j * res + i
      let v = data[idx]
      const k = Math.min(1, BLEND_RATE * b.strength * w * dab.dt)
      switch (mode) {
        case 'raise':
          v += sign * RAISE_RATE * b.strength * w * dab.dt
          break
        case 'lower':
          v -= sign * RAISE_RATE * b.strength * w * dab.dt
          break
        case 'flatten':
          v += (ctx.flattenTo - v) * k
          break
        case 'smooth': {
          let sum = 0
          let n = 0
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di
              const jj = j + dj
              if (ii < 0 || jj < 0 || ii >= res || jj >= res) continue
              sum += source![jj * res + ii]
              n++
            }
          v += (sum / n - v) * k
          break
        }
        case 'noise':
          v += sign * NOISE_RATE * b.strength * w * dab.dt * valueNoise2(ctx.seed, x, z)
          break
      }
      data[idx] = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, v))
    }
  }
  return rect
}

/** Paints (or with invert, erases toward meadow) one biome dab in place. */
export function paint(m: BiomeMap, biome: BiomeId, b: BrushSettings, dab: Dab): Rect | null {
  const channel = BIOME_IDS.indexOf(biome)
  if (dab.invert && channel === 0) return null
  const rect = dabRect(m.size, m.resolution, BIOME_SPACING, dab, b.radius)
  if (!rect) return null
  const half = m.size / 2
  const old = [0, 0, 0, 0]
  const target = [0, 0, 0, 0]
  for (let j = rect.z0; j <= rect.z1; j++) {
    const z = -half + j * BIOME_SPACING
    for (let i = rect.x0; i <= rect.x1; i++) {
      const x = -half + i * BIOME_SPACING
      const w = brushWeight(Math.hypot(x - dab.x, z - dab.z), b)
      if (w === 0) continue
      const k = Math.min(1, BLEND_RATE * b.strength * w * dab.dt)
      const offset = (j * m.resolution + i) * 4
      for (let c = 0; c < 4; c++) old[c] = m.data[offset + c] / 255
      if (dab.invert) {
        for (let c = 0; c < 4; c++) target[c] = old[c]
        target[0] += target[channel]
        target[channel] = 0
      } else {
        for (let c = 0; c < 4; c++) target[c] = c === channel ? 1 : 0
      }
      quantizeWeights(
        old.map((o, c) => o + (target[c] - o) * k),
        m.data,
        offset,
      )
    }
  }
  return rect
}
