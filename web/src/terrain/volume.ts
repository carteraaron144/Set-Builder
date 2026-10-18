import type { SceneSize } from '../scene/scene'
import type { Rect } from './layers'

export const BRICK = 8
export const VOXEL_STEP = 1 / 32
export const VALUE_LIMIT = 2
export const MAX_BRICKS = 8000
const DEFAULT = -VALUE_LIMIT / VOXEL_STEP // -64
const VOXEL_SPACING = 0.5
const FOOTPRINT_MARGIN = 4
const BRICK_VOXELS = BRICK * BRICK * BRICK

/** Add and Carve values, one Int8 per voxel in 1/32 m; index = (ly·8 + lz)·8 + lx. */
export interface Brick {
  a: Int8Array
  k: Int8Array
}

const BIAS = 32768
const SPAN = 65536

export const brickKey = (bx: number, by: number, bz: number): number =>
  ((bx + BIAS) * SPAN + (by + BIAS)) * SPAN + (bz + BIAS)

export function unpackKey(key: number): [number, number, number] {
  const bz = key % SPAN
  const rest = (key - bz) / SPAN
  const by = rest % SPAN
  const bx = (rest - by) / SPAN
  return [bx - BIAS, by - BIAS, bz - BIAS]
}

const colKey = (bx: number, bz: number) => (bx + BIAS) * SPAN + (bz + BIAS)

function isDefault(b: Brick): boolean {
  for (let i = 0; i < BRICK_VOXELS; i++) if (b.a[i] !== DEFAULT || b.k[i] !== DEFAULT) return false
  return true
}

/** The height-sample footprint of one brick: its xz extent plus 4 samples each way. */
export function brickFootprint(key: number): Rect {
  const [bx, , bz] = unpackKey(key)
  return {
    x0: bx * BRICK - FOOTPRINT_MARGIN,
    z0: bz * BRICK - FOOTPRINT_MARGIN,
    x1: bx * BRICK + BRICK - 1 + FOOTPRINT_MARGIN,
    z1: bz * BRICK + BRICK - 1 + FOOTPRINT_MARGIN,
  }
}

export class VolumeLayer {
  private bricks = new Map<number, Brick>()
  /** Brick y-levels present per (bx, bz) column. */
  private columns = new Map<number, Set<number>>()

  readonly size: SceneSize

  constructor(size: SceneSize) {
    this.size = size
  }

  get count(): number {
    return this.bricks.size
  }

  keys(): IterableIterator<number> {
    return this.bricks.keys()
  }

  get(key: number): Brick | undefined {
    return this.bricks.get(key)
  }

  copy(key: number): Brick | null {
    const b = this.bricks.get(key)
    return b ? { a: b.a.slice(), k: b.k.slice() } : null
  }

  put(key: number, brick: Brick | null): void {
    const [bx, by, bz] = unpackKey(key)
    const ck = colKey(bx, bz)
    if (!brick || isDefault(brick)) {
      if (!this.bricks.delete(key)) return
      const col = this.columns.get(ck)!
      col.delete(by)
      if (col.size === 0) this.columns.delete(ck)
      return
    }
    this.bricks.set(key, brick)
    let col = this.columns.get(ck)
    if (!col) this.columns.set(ck, (col = new Set()))
    col.add(by)
  }

  /** Voxel value in Int8 units; missing bricks read as the default. */
  private voxel(vi: number, vk: number, vj: number, channel: 'a' | 'k'): number {
    const bx = vi >> 3
    const by = vk >> 3
    const bz = vj >> 3
    const b = this.bricks.get(brickKey(bx, by, bz))
    if (!b) return DEFAULT
    return b[channel][(((vk & 7) * BRICK + (vj & 7)) * BRICK) + (vi & 7)]
  }

  sample(x: number, y: number, z: number, out: { a: number; k: number }): void {
    const gx = (x + this.size / 2) / VOXEL_SPACING
    const gz = (z + this.size / 2) / VOXEL_SPACING
    const gy = y / VOXEL_SPACING
    const i0 = Math.floor(gx)
    const j0 = Math.floor(gz)
    const k0 = Math.floor(gy)
    const fx = gx - i0
    const fz = gz - j0
    const fy = gy - k0
    for (const channel of ['a', 'k'] as const) {
      let sum = 0
      let set = false
      for (let dk = 0; dk < 2; dk++) {
        for (let dj = 0; dj < 2; dj++) {
          for (let di = 0; di < 2; di++) {
            const w = (di ? fx : 1 - fx) * (dj ? fz : 1 - fz) * (dk ? fy : 1 - fy)
            if (w === 0) continue
            const u = this.voxel(i0 + di, k0 + dk, j0 + dj, channel)
            if (u !== DEFAULT) set = true
            sum += w * u
          }
        }
      }
      // Rounding must not leak into points no voxel has set: callers treat exactly -2 as "nothing here".
      out[channel] = set ? sum * VOXEL_STEP : -VALUE_LIMIT
    }
  }

  sampleLattice(i: number, j: number, y: number, out: { a: number; k: number }): void {
    const vk = Math.round(y / VOXEL_SPACING)
    out.a = this.voxel(i, vk, j, 'a') * VOXEL_STEP
    out.k = this.voxel(i, vk, j, 'k') * VOXEL_STEP
  }

  footprints(): Rect[] {
    return [...this.bricks.keys()].map(brickFootprint)
  }

  columnRange(i: number, j: number): readonly [number, number] | null {
    const col = this.columns.get(colKey(i >> 3, j >> 3))
    if (!col) return null
    let lo = Infinity
    let hi = -Infinity
    for (const by of col) {
      lo = Math.min(lo, by)
      hi = Math.max(hi, by)
    }
    return [lo * BRICK * VOXEL_SPACING, hi * BRICK * VOXEL_SPACING + (BRICK - 1) * VOXEL_SPACING]
  }

  clone(): VolumeLayer {
    const v = new VolumeLayer(this.size)
    for (const [key, b] of this.bricks) v.put(key, { a: b.a.slice(), k: b.k.slice() })
    return v
  }
}
