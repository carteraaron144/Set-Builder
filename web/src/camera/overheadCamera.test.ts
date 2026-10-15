import { describe, expect, it } from 'vitest'
import {
  cameraLimits,
  cameraPoseOverTerrain,
  cameraPosition,
  defaultCameraState,
  orbit,
  pan,
  tilt,
  zoom,
  type CameraState,
} from './overheadCamera'

const deg = (d: number) => (d * Math.PI) / 180
const l = cameraLimits(128)

function state(overrides: Partial<CameraState> = {}): CameraState {
  return { target: { x: 0, z: 0 }, yaw: 0, pitch: deg(50), distance: 100, ...overrides }
}

describe('cameraLimits / defaultCameraState', () => {
  it('derives limits from the scene size', () => {
    expect(l.half).toBe(64)
    expect(l.minDistance).toBe(5)
    expect(l.maxDistance).toBe(256)
    expect(l.minPitch).toBeCloseTo(deg(15))
    expect(l.maxPitch).toBeCloseTo(deg(85))
  })

  it('starts centred, at 45° yaw, 50° pitch and 0.9 × size away', () => {
    const s = defaultCameraState(128)
    expect(s.target).toEqual({ x: 0, z: 0 })
    expect(s.yaw).toBeCloseTo(deg(45))
    expect(s.pitch).toBeCloseTo(deg(50))
    expect(s.distance).toBeCloseTo(115.2)
  })
})

describe('pan', () => {
  it('moves along the camera forward ground direction', () => {
    const s = state({ yaw: 0 })
    const moved = pan(s, 0, 10, l)
    // The camera sits on the +z side of the target at yaw 0, so forward is -z.
    const pos = cameraPosition(s)
    const fwd = { x: s.target.x - pos.x, z: s.target.z - pos.z }
    const len = Math.hypot(fwd.x, fwd.z)
    expect(moved.target.x).toBeCloseTo((fwd.x / len) * 10)
    expect(moved.target.z).toBeCloseTo((fwd.z / len) * 10)
  })

  it('moves along the perpendicular axis at 90° yaw', () => {
    const at0 = pan(state({ yaw: 0 }), 0, 10, l).target
    const at90 = pan(state({ yaw: deg(90) }), 0, 10, l).target
    expect(at0.x * at90.x + at0.z * at90.z).toBeCloseTo(0)
    expect(Math.hypot(at90.x, at90.z)).toBeCloseTo(10)
  })

  it('moves right along screen-right (+x at yaw 0)', () => {
    const right = pan(state({ yaw: 0 }), 10, 0, l).target
    expect(right.x).toBeCloseTo(10)
    expect(right.z).toBeCloseTo(0)
  })

  it('clamps the target to the scene bounds', () => {
    const moved = pan(state({ yaw: 0 }), 1000, 1000, l)
    expect(Math.abs(moved.target.x)).toBeCloseTo(64)
    expect(Math.abs(moved.target.z)).toBeCloseTo(64)
  })
})

describe('orbit / tilt', () => {
  it('wraps yaw to [0, 2π)', () => {
    expect(orbit(state({ yaw: 0 }), 2 * Math.PI + 0.1).yaw).toBeCloseTo(0.1)
    expect(orbit(state({ yaw: 0 }), -0.1).yaw).toBeCloseTo(2 * Math.PI - 0.1)
  })

  it('clamps pitch to [15°, 85°]', () => {
    expect(tilt(state(), deg(90), l).pitch).toBeCloseTo(deg(85))
    expect(tilt(state(), -deg(90), l).pitch).toBeCloseTo(deg(15))
    expect(tilt(state(), deg(10), l).pitch).toBeCloseTo(deg(60))
  })
})

describe('zoom', () => {
  it('scales the distance', () => {
    expect(zoom(state({ distance: 100 }), 0.5, l).distance).toBeCloseTo(50)
  })

  it('clamps the distance to [5, 2 × size]', () => {
    expect(zoom(state({ distance: 10 }), 0.01, l).distance).toBeCloseTo(5)
    expect(zoom(state({ distance: 200 }), 10, l).distance).toBeCloseTo(256)
  })

  it('moves the target toward the cursor ground point', () => {
    const z = zoom(state({ distance: 100 }), 0.5, l, { x: 10, z: 0 })
    expect(z.target.x).toBeCloseTo(5)
    expect(z.target.z).toBeCloseTo(0)
  })

  it('does not move at the minimum distance', () => {
    const s = state({ distance: 5 })
    const z = zoom(s, 0.5, l, { x: 10, z: 0 })
    expect(z.distance).toBeCloseTo(5)
    expect(z.target).toEqual({ x: 0, z: 0 })
  })
})

describe('cameraPosition', () => {
  it('is almost straight above the target when pitch is near 90°', () => {
    const p = cameraPosition(state({ target: { x: 3, z: -4 }, pitch: Math.PI / 2 - 1e-6, distance: 50 }))
    expect(p.x).toBeCloseTo(3)
    expect(p.z).toBeCloseTo(-4)
    expect(p.y).toBeCloseTo(50)
  })
})

describe('cameraPoseOverTerrain', () => {
  it('matches cameraPosition over flat ground', () => {
    const s = state({ target: { x: 4, z: -6 }, yaw: deg(30) })
    const pose = cameraPoseOverTerrain(s, () => 0)
    const p = cameraPosition(s)
    expect(pose.position.x).toBeCloseTo(p.x)
    expect(pose.position.y).toBeCloseTo(p.y)
    expect(pose.position.z).toBeCloseTo(p.z)
    expect(pose.lookAt).toEqual({ x: 4, y: 0, z: -6 })
  })

  it('lifts camera and target by the ground height under the target', () => {
    const s = state()
    const pose = cameraPoseOverTerrain(s, () => 20)
    expect(pose.position.y).toBeCloseTo(cameraPosition(s).y + 20)
    expect(pose.lookAt.y).toBe(20)
  })

  it('keeps the camera at least 2 m above the ground under it', () => {
    const s = state({ yaw: 0, pitch: deg(15), distance: 20 })
    const camZ = cameraPosition(s).z
    const wallUnderCamera = (_x: number, z: number) => (Math.abs(z - camZ) < 1 ? 60 : 0)
    const pose = cameraPoseOverTerrain(s, wallUnderCamera)
    expect(pose.position.y).toBeGreaterThanOrEqual(62)
    expect(pose.lookAt.y).toBe(0)
  })
})
