import { brushWeight, RAISE_RATE, type BrushSettings, type TerrainMode } from './brush'
import { HEIGHT_SPACING, MAX_HEIGHT, MIN_HEIGHT } from './layers'
import { brickKey, BRICK, MAX_BRICKS, VALUE_LIMIT, VOXEL_STEP, type Brick, type VolumeLayer } from './volume'

export const RADIUS_3D_MAX = 12
export const is3dMode = (m: TerrainMode): m is 'add' | 'carve' | 'smooth3d' => m === 'add' || m === 'carve' || m === 'smooth3d'

/** One application of a 3D brush, centred at a world point. */
export interface Dab3 {
  x: number
  y: number
  z: number
  dt: number
  invert: boolean
}

const DEFAULT_UNITS = -VALUE_LIMIT / VOXEL_STEP
const LIMIT_UNITS = VALUE_LIMIT / VOXEL_STEP
const units = (metres: number) => Math.max(-LIMIT_UNITS, Math.min(LIMIT_UNITS, Math.round(metres / VOXEL_STEP)))

interface Change {
  key: number
  index: number
  channel: 'a' | 'k'
  value: number
}

/**
 * Applies one 3D dab and returns the keys of the bricks it changed, or 'limit' (changing nothing) when it would
 * need more bricks than a scene may hold.
 *
 * Add raises A and Carve raises K so the combined density there moves by at most the raise rate·strength·dt
 * per dab: up for Add (capped at a sphere's signed distance, radius·falloff weight − distance), down for Carve
 * (only in solid, floored at the negated sphere). Smooth 3D moves the combined density by at most the same
 * amount toward its 3×3×3 box blur, raising A where the blur is higher and K where it is lower.
 */
export function sculpt3d(
  v: VolumeLayer,
  mode: 'add' | 'carve' | 'smooth3d',
  b: BrushSettings,
  dab: Dab3,
  density: (x: number, y: number, z: number) => number,
  onFirstTouch: (key: number) => void,
): number[] | 'limit' {
  const radius = Math.min(b.radius, RADIUS_3D_MAX)
  const brush = { ...b, radius }
  const target: 'a' | 'k' | null = mode === 'smooth3d' ? null : (mode === 'add') !== dab.invert ? 'a' : 'k'
  const res = v.size * 2 + 1
  const half = v.size / 2
  const kMin = Math.ceil(MIN_HEIGHT / HEIGHT_SPACING)
  const kMax = Math.floor(MAX_HEIGHT / HEIGHT_SPACING)
  const range = (c: number, offset: number, lo: number, hi: number) => [Math.max(lo, Math.ceil((c - radius + offset) / HEIGHT_SPACING)), Math.min(hi, Math.floor((c + radius + offset) / HEIGHT_SPACING))]
  const [i0, i1] = range(dab.x, half, 0, res - 1)
  const [j0, j1] = range(dab.z, half, 0, res - 1)
  const [k0, k1] = range(dab.y, 0, kMin, kMax)

  const changes: Change[] = []
  const planned = new Map<number, Brick>()
  const read = (vi: number, vk: number, vj: number, channel: 'a' | 'k') => {
    const brick = v.get(brickKey(vi >> 3, vk >> 3, vj >> 3))
    return brick ? brick[channel][((vk & 7) * BRICK + (vj & 7)) * BRICK + (vi & 7)] : DEFAULT_UNITS
  }
  const propose = (vi: number, vk: number, vj: number, channel: 'a' | 'k', value: number) => {
    if (value <= read(vi, vk, vj, channel)) return
    changes.push({ key: brickKey(vi >> 3, vk >> 3, vj >> 3), index: ((vk & 7) * BRICK + (vj & 7)) * BRICK + (vi & 7), channel, value })
  }

  for (let vk = k0; vk <= k1; vk++)
    for (let vj = j0; vj <= j1; vj++)
      for (let vi = i0; vi <= i1; vi++) {
        const x = -half + vi * HEIGHT_SPACING
        const y = vk * HEIGHT_SPACING
        const z = -half + vj * HEIGHT_SPACING
        const d = Math.hypot(x - dab.x, y - dab.y, z - dab.z)
        const w = brushWeight(d, brush)
        if (w === 0) continue
        const step = RAISE_RATE * b.strength * w * dab.dt
        if (target) {
          // Move the combined density by one step instead of jumping to the sphere, so the surface bubbles out gradually.
          const t = Math.min(VALUE_LIMIT, radius * w - d)
          const s0 = density(x, y, z)
          if (target === 'a') {
            const next = Math.min(t, s0 + step)
            if (next > s0) propose(vi, vk, vj, 'a', units(next))
          } else if (s0 > 0) {
            // Air needs no carving, and a positive K there would block later Add.
            const next = Math.max(s0 - step, -t)
            if (next < s0) propose(vi, vk, vj, 'k', units(-next))
          }
        } else {
          let blur = 0
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) blur += density(x + dx * HEIGHT_SPACING, y + dy * HEIGHT_SPACING, z + dz * HEIGHT_SPACING)
          blur /= 27
          const s0 = density(x, y, z)
          // Only near the surface: A and K beyond ±2 m would be invisible now and block later edits.
          if (blur > s0) {
            const next = Math.min(blur, s0 + step)
            if (Math.abs(s0) < VALUE_LIMIT && Math.abs(next) < VALUE_LIMIT) propose(vi, vk, vj, 'a', units(next))
          } else if (blur < s0) {
            const next = Math.max(blur, s0 - step)
            if (Math.abs(s0) < VALUE_LIMIT && Math.abs(next) < VALUE_LIMIT) propose(vi, vk, vj, 'k', units(-next))
          }
        }
      }

  const fresh = new Set<number>()
  for (const c of changes) if (!v.get(c.key)) fresh.add(c.key)
  if (v.count + fresh.size > MAX_BRICKS) return 'limit'

  const touched: number[] = []
  for (const c of changes) {
    let brick = planned.get(c.key)
    if (brick === undefined) {
      onFirstTouch(c.key)
      touched.push(c.key)
      brick = v.get(c.key) ?? { a: new Int8Array(BRICK ** 3).fill(DEFAULT_UNITS), k: new Int8Array(BRICK ** 3).fill(DEFAULT_UNITS) }
      planned.set(c.key, brick)
    }
    brick[c.channel][c.index] = Math.max(brick[c.channel][c.index], c.value)
  }
  for (const [key, brick] of planned) v.put(key, brick)
  return touched
}
