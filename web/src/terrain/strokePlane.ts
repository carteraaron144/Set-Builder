import type { Vec3 } from './pick'

/** A plane through `point` with unit `normal`. */
export interface Plane {
  point: Vec3
  normal: Vec3
}

/** The plane through the first hit of a 3D stroke, square to the view, so later dabs don't climb their own material. */
export function cameraPlane(hit: Vec3, cameraDir: Vec3): Plane {
  const len = Math.hypot(cameraDir.x, cameraDir.y, cameraDir.z) || 1
  return { point: { ...hit }, normal: { x: cameraDir.x / len, y: cameraDir.y / len, z: cameraDir.z / len } }
}

/** Where a ray meets the plane in front of it, or null when parallel or behind. */
export function intersectPlane(origin: Vec3, dir: Vec3, plane: Plane): Vec3 | null {
  const { point: p, normal: n } = plane
  const denom = dir.x * n.x + dir.y * n.y + dir.z * n.z
  if (Math.abs(denom) < 1e-9) return null
  const t = ((p.x - origin.x) * n.x + (p.y - origin.y) * n.y + (p.z - origin.z) * n.z) / denom
  if (t < 0) return null
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t }
}
