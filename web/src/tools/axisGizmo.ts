export type Axis = 'x' | 'y' | 'z'

interface Vec {
  x: number
  y: number
  z: number
}

/** A pick ray in world space; `dir` need not be normalised. */
interface RayLike {
  origin: Vec
  dir: Vec
}

export const AXIS_DIR: Record<Axis, Vec> = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } }

/** Arrow length for a gizmo `distance` metres from the camera: a fixed share of the view, within limits. */
export const gizmoLength = (distance: number) => Math.min(60, Math.max(1.5, distance * 0.15))

/** Arrows begin this share of their length out from the point, so the point's own handle stays grabbable. */
export const ARROW_START = 0.25

/** The arrow's grab width, as a share of its length. */
const GRAB = 0.1

/** Metres along `axis` from `origin` to where the axis line comes closest to the ray; null if they are parallel. */
export function axisParam(ray: RayLike, origin: Vec, axis: Axis): number | null {
  const u = AXIS_DIR[axis]
  const v = ray.dir
  const len = Math.hypot(v.x, v.y, v.z)
  if (len === 0) return null
  const vx = v.x / len
  const vy = v.y / len
  const vz = v.z / len
  const w = { x: origin.x - ray.origin.x, y: origin.y - ray.origin.y, z: origin.z - ray.origin.z }
  const b = u.x * vx + u.y * vy + u.z * vz
  const d = u.x * w.x + u.y * w.y + u.z * w.z
  const e = vx * w.x + vy * w.y + vz * w.z
  const denom = 1 - b * b
  if (denom < 1e-6) return null
  return (b * e - d) / denom
}

/** The arrow (of `axes`, each `length` long from `origin`) the ray passes through, nearest to the ray's line first. */
export function arrowHit(ray: RayLike, origin: Vec, length: number, axes: readonly Axis[]): Axis | null {
  const dirLen = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z)
  if (dirLen === 0) return null
  let best: Axis | null = null
  let bestDistance = length * GRAB
  for (const axis of axes) {
    const s = axisParam(ray, origin, axis)
    if (s === null || s < length * ARROW_START || s > length) continue
    const u = AXIS_DIR[axis]
    const p = { x: origin.x + u.x * s, y: origin.y + u.y * s, z: origin.z + u.z * s }
    const dx = p.x - ray.origin.x
    const dy = p.y - ray.origin.y
    const dz = p.z - ray.origin.z
    const t = Math.max(0, (dx * ray.dir.x + dy * ray.dir.y + dz * ray.dir.z) / dirLen)
    const d = Math.hypot(dx - (ray.dir.x / dirLen) * t, dy - (ray.dir.y / dirLen) * t, dz - (ray.dir.z / dirLen) * t)
    if (d <= bestDistance) {
      best = axis
      bestDistance = d
    }
  }
  return best
}
