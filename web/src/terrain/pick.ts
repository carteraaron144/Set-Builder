import { HEIGHT_SPACING, heightAt, type Heightmap } from './layers'

export interface Vec3 {
  x: number
  y: number
  z: number
}

const MARCH_STEP = HEIGHT_SPACING / 2 // horizontal metres: half a sample, so thin spikes aren't stepped over
const BISECTIONS = 8

/** Where a ray first meets the terrain surface inside the scene square, or null. `dir` needn't be normalised. */
export function raycastTerrain(h: Heightmap, origin: Vec3, dir: Vec3, maxDistance = 2000): Vec3 | null {
  const len = Math.hypot(dir.x, dir.y, dir.z)
  if (len === 0) return null
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len }
  const half = h.size / 2

  // Clip the ray to the scene square (slab method on x and z).
  let tMin = 0
  let tMax = maxDistance
  for (const axis of ['x', 'z'] as const) {
    if (Math.abs(d[axis]) < 1e-12) {
      if (origin[axis] < -half || origin[axis] > half) return null
      continue
    }
    const t1 = (-half - origin[axis]) / d[axis]
    const t2 = (half - origin[axis]) / d[axis]
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
  }
  if (tMin > tMax) return null

  const point = (t: number): Vec3 => ({ x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t })
  const above = (t: number) => {
    const p = point(t)
    return p.y - heightAt(h, p.x, p.z)
  }

  if (above(tMin) <= 0) return point(tMin)
  const horizontal = Math.hypot(d.x, d.z)
  if (horizontal < 1e-9) {
    // Straight up or down: the hit is the ground under the origin.
    if (d.y >= 0) return null
    const p = point(tMin)
    return { x: p.x, y: heightAt(h, p.x, p.z), z: p.z }
  }
  const step = MARCH_STEP / horizontal
  let prev = tMin
  for (let t = tMin + step; prev < tMax; t += step) {
    const tt = Math.min(t, tMax)
    if (above(tt) <= 0) {
      let lo = prev
      let hi = tt
      for (let i = 0; i < BISECTIONS; i++) {
        const mid = (lo + hi) / 2
        if (above(mid) > 0) lo = mid
        else hi = mid
      }
      return point(hi)
    }
    prev = tt
  }
  return null
}
