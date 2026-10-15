import type { SceneSize } from '../scene/scene'

/** A point on the ground plane (y = 0), in metres. */
export interface GroundPoint {
  x: number
  z: number
}

/**
 * Orbit camera around a ground target. Angles in radians, distance in metres.
 * At yaw 0 the camera sits on the +z side of the target looking toward -z; yaw increases counter-clockwise seen from above.
 */
export interface CameraState {
  target: GroundPoint
  yaw: number
  pitch: number
  distance: number
}

export interface CameraLimits {
  half: number
  minDistance: number
  maxDistance: number
  minPitch: number
  maxPitch: number
}

const DEG = Math.PI / 180
const TAU = 2 * Math.PI

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function cameraLimits(sceneSize: SceneSize): CameraLimits {
  return { half: sceneSize / 2, minDistance: 5, maxDistance: 2 * sceneSize, minPitch: 15 * DEG, maxPitch: 85 * DEG }
}

export function defaultCameraState(sceneSize: SceneSize): CameraState {
  return { target: { x: 0, z: 0 }, yaw: 45 * DEG, pitch: 50 * DEG, distance: 0.9 * sceneSize }
}

function clampTarget(p: GroundPoint, l: CameraLimits): GroundPoint {
  return { x: clamp(p.x, -l.half, l.half), z: clamp(p.z, -l.half, l.half) }
}

/** Moves the target `right`/`forward` metres along the camera's ground-projected axes. */
export function pan(s: CameraState, right: number, forward: number, l: CameraLimits): CameraState {
  const fx = -Math.sin(s.yaw)
  const fz = -Math.cos(s.yaw)
  // Screen-right is forward rotated 90° clockwise seen from above.
  const rx = -fz
  const rz = fx
  return {
    ...s,
    target: clampTarget({ x: s.target.x + rx * right + fx * forward, z: s.target.z + rz * right + fz * forward }, l),
  }
}

export function orbit(s: CameraState, dYaw: number): CameraState {
  return { ...s, yaw: (((s.yaw + dYaw) % TAU) + TAU) % TAU }
}

export function tilt(s: CameraState, dPitch: number, l: CameraLimits): CameraState {
  return { ...s, pitch: clamp(s.pitch + dPitch, l.minPitch, l.maxPitch) }
}

/**
 * Multiplies the distance by `factor` (clamped). With `toward`, the target moves toward that ground point by
 * (1 - effective factor) of the gap, so the point under the cursor stays under it.
 */
export function zoom(s: CameraState, factor: number, l: CameraLimits, toward?: GroundPoint): CameraState {
  const distance = clamp(s.distance * factor, l.minDistance, l.maxDistance)
  if (!toward) return { ...s, distance }
  const t = 1 - distance / s.distance
  return {
    ...s,
    distance,
    target: clampTarget({ x: s.target.x + (toward.x - s.target.x) * t, z: s.target.z + (toward.z - s.target.z) * t }, l),
  }
}

export function cameraPosition(s: CameraState): { x: number; y: number; z: number } {
  const horizontal = s.distance * Math.cos(s.pitch)
  return {
    x: s.target.x + horizontal * Math.sin(s.yaw),
    y: s.distance * Math.sin(s.pitch),
    z: s.target.z + horizontal * Math.cos(s.yaw),
  }
}
