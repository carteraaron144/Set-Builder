import { describe, expect, it } from 'vitest'
import { arrowHit, axisParam, gizmoLength } from './axisGizmo'

const down = { x: 0, y: -1, z: 0 }
const ray = (x: number, y: number, z: number, dir = down) => ({ origin: { x, y, z }, dir })

describe('axisParam', () => {
  it('finds where a ray comes closest to an axis line, in metres along it', () => {
    // A ray straight down at x = 3 crosses the x axis through the origin at 3 m.
    expect(axisParam(ray(3, 10, 0), { x: 0, y: 0, z: 0 }, 'x')).toBeCloseTo(3)
    expect(axisParam(ray(3, 10, 0), { x: 1, y: 0, z: 0 }, 'x')).toBeCloseTo(2)
  })

  it('works for the vertical axis from a sideways ray', () => {
    expect(axisParam(ray(10, 4, 0, { x: -1, y: 0, z: 0 }), { x: 0, y: 1, z: 0 }, 'y')).toBeCloseTo(3)
  })

  it('does not care how long the ray direction is', () => {
    expect(axisParam(ray(3, 10, 0, { x: 0, y: -7, z: 0 }), { x: 0, y: 0, z: 0 }, 'x')).toBeCloseTo(3)
  })

  it('is null when the ray runs along the axis', () => {
    expect(axisParam(ray(0, 0, 0, { x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: 0 }, 'x')).toBeNull()
  })
})

describe('arrowHit', () => {
  const o = { x: 0, y: 0, z: 0 }
  it('hits the arrow the ray passes through', () => {
    expect(arrowHit(ray(3, 10, 0), o, 4, ['x', 'y', 'z'])).toBe('x')
    expect(arrowHit(ray(0, 10, 3), o, 4, ['x', 'y', 'z'])).toBe('z')
    expect(arrowHit(ray(10, 3, 0, { x: -1, y: 0, z: 0 }), o, 4, ['x', 'y', 'z'])).toBe('y')
  })

  it('misses past the tip, off to the side, and for axes not offered', () => {
    expect(arrowHit(ray(6, 10, 0), o, 4, ['x', 'y', 'z'])).toBeNull()
    expect(arrowHit(ray(3, 10, 2), o, 4, ['x', 'y', 'z'])).toBeNull()
    expect(arrowHit(ray(10, 3, 0, { x: -1, y: 0, z: 0 }), o, 4, ['x', 'z'])).toBeNull()
  })
})

describe('gizmoLength', () => {
  it('grows with distance so the arrows keep their size on screen, within limits', () => {
    expect(gizmoLength(100)).toBeGreaterThan(gizmoLength(20))
    expect(gizmoLength(0.1)).toBeGreaterThan(0)
    expect(gizmoLength(1e6)).toBeLessThanOrEqual(60)
  })
})

describe('arrowHit near the point', () => {
  it('leaves the point itself to its handle', () => {
    expect(arrowHit(ray(0.2, 10, 0), { x: 0, y: 0, z: 0 }, 4, ['x', 'y', 'z'])).toBeNull()
  })
})
