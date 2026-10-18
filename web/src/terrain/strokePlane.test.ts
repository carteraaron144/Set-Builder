import { describe, expect, it } from 'vitest'
import { cameraPlane, intersectPlane } from './strokePlane'

describe('stroke plane', () => {
  it('faces the camera through the first hit', () => {
    const plane = cameraPlane({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -2 })
    expect(plane.point).toEqual({ x: 1, y: 2, z: 3 })
    expect(plane.normal.x).toBeCloseTo(0)
    expect(plane.normal.z).toBeCloseTo(-1)
  })

  it('meets a ray at the expected point', () => {
    const plane = cameraPlane({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 })
    const hit = intersectPlane({ x: 3, y: 7, z: 10 }, { x: 0, y: 0, z: -1 }, plane)!
    expect(hit.x).toBeCloseTo(3)
    expect(hit.y).toBeCloseTo(7)
    expect(hit.z).toBeCloseTo(0)
  })

  it('misses a parallel ray and a plane behind the ray', () => {
    const plane = cameraPlane({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 })
    expect(intersectPlane({ x: 0, y: 0, z: 10 }, { x: 1, y: 0, z: 0 }, plane)).toBeNull()
    expect(intersectPlane({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: -1 }, plane)).toBeNull()
  })
})
