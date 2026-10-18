import { HEIGHT_SPACING, type Heightmap, type Rect } from '../terrain/layers'
import { FEATURES, type Pond } from './features'

/** A pond's flooded height samples and the level it actually fills to. */
export interface PondFill {
  /** Per height sample: 1 where flooded. */
  mask: Uint8Array
  /** The effective level: the pond's level, or its spill height less the spill gap when that is lower. */
  level: number
  /** True when the level was lowered so the water never reaches the scene edge. */
  capped: boolean
  /** Sample-index bounds of the flooded samples; null when nothing is flooded. */
  bounds: Rect | null
}

/** A binary min-heap of sample indices keyed by height; ties pop the lower index first. */
class SampleHeap {
  private items: number[] = []
  private readonly heights: Float32Array
  constructor(heights: Float32Array) {
    this.heights = heights
  }

  get size(): number {
    return this.items.length
  }

  private less(a: number, b: number): boolean {
    const ha = this.heights[a]
    const hb = this.heights[b]
    return ha < hb || (ha === hb && a < b)
  }

  push(i: number): void {
    const a = this.items
    a.push(i)
    let k = a.length - 1
    while (k > 0) {
      const parent = (k - 1) >> 1
      if (!this.less(a[k], a[parent])) break
      ;[a[k], a[parent]] = [a[parent], a[k]]
      k = parent
    }
  }

  pop(): number {
    const a = this.items
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < a.length && this.less(a[l], a[m])) m = l
        if (r < a.length && this.less(a[r], a[m])) m = r
        if (m === k) break
        ;[a[k], a[m]] = [a[m], a[k]]
        k = m
      }
    }
    return top
  }
}

/** The index of the height sample nearest a point, clamped into the grid. */
export const sampleIndex = (h: Heightmap, p: { x: number; z: number }) => {
  const res = h.resolution
  const half = h.size / 2
  const clamp = (v: number) => Math.min(res - 1, Math.max(0, Math.round((v + half) / HEIGHT_SPACING)))
  return clamp(p.z) * res + clamp(p.x)
}

/**
 * The lowest water level at which a fill from `seed` would touch the scene edge, found by priority flood; or
 * Infinity once it is clear the fill stays inside below `limit`.
 */
function spillHeight(h: Heightmap, seed: number, limit: number): number {
  const res = h.resolution
  const visited = new Uint8Array(res * res)
  const heap = new SampleHeap(h.data)
  heap.push(seed)
  visited[seed] = 1
  let water = -Infinity
  while (heap.size > 0) {
    const i = heap.pop()
    water = Math.max(water, h.data[i])
    if (water >= limit) return Infinity
    const x = i % res
    const z = (i - x) / res
    if (x === 0 || z === 0 || x === res - 1 || z === res - 1) return water
    for (const n of [i - 1, i + 1, i - res, i + res]) {
      if (visited[n]) continue
      visited[n] = 1
      heap.push(n)
    }
  }
  return Infinity
}

/**
 * Floods from the pond's seed: every height sample 4-connected to the seed and strictly below the effective
 * level. A fill that would reach the scene edge is capped at its spill height less the spill gap. Samples where
 * `solidAt` says rock stands at the water level (sculpted material over the ground) act as walls.
 */
export function floodPond(h: Heightmap, pond: Pond, solidAt?: (i: number, j: number, y: number) => boolean): PondFill {
  const res = h.resolution
  const mask = new Uint8Array(res * res)
  const seed = sampleIndex(h, pond.seed)
  const spill = spillHeight(h, seed, pond.level)
  const capped = spill < pond.level
  const level = capped ? spill - FEATURES.pond.spillGap : pond.level
  const blocked = (n: number) => solidAt !== undefined && solidAt(n % res, Math.floor(n / res), level)
  if (!(h.data[seed] < level) || blocked(seed)) return { mask, level, capped, bounds: null }
  const bounds: Rect = { x0: res, z0: res, x1: -1, z1: -1 }
  const stack = [seed]
  mask[seed] = 1
  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % res
    const z = (i - x) / res
    bounds.x0 = Math.min(bounds.x0, x)
    bounds.x1 = Math.max(bounds.x1, x)
    bounds.z0 = Math.min(bounds.z0, z)
    bounds.z1 = Math.max(bounds.z1, z)
    const visit = (n: number) => {
      if (!mask[n] && h.data[n] < level && !blocked(n)) {
        mask[n] = 1
        stack.push(n)
      }
    }
    // A capped fill never reaches the edge, so neighbours stay in range; the guards cover an uncapped one.
    if (x > 0) visit(i - 1)
    if (x < res - 1) visit(i + 1)
    if (z > 0) visit(i - res)
    if (z < res - 1) visit(i + res)
  }
  return { mask, level, capped, bounds }
}
