import { describe, expect, it } from 'vitest'
import { createFlatLayers } from './layers'
import { raycastTerrain } from './pick'

const norm = (x: number, y: number, z: number) => {
  const l = Math.hypot(x, y, z)
  return { x: x / l, y: y / l, z: z / l }
}

describe('raycastTerrain', () => {
  it('hits flat ground straight down', () => {
    const { heights } = createFlatLayers(64)
    const hit = raycastTerrain(heights, { x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 })
    expect(hit?.x).toBeCloseTo(0)
    expect(hit?.y).toBeCloseTo(0)
    expect(hit?.z).toBeCloseTo(0)
  })

  it('hits a raised plateau at its height from an angle', () => {
    const { heights } = createFlatLayers(64)
    for (let j = 44; j <= 84; j++) for (let i = 44; i <= 84; i++) heights.data[j * 129 + i] = 10
    const hit = raycastTerrain(heights, { x: -40, y: 50, z: 0 }, norm(40, -40, 0))
    expect(hit?.y).toBeCloseTo(10, 1)
    expect(Math.abs(hit!.y - 10)).toBeLessThan(0.05)
    expect(hit?.x).toBeCloseTo(0, 0)
  })

  it('misses when the ray points up or passes outside the scene', () => {
    const { heights } = createFlatLayers(64)
    expect(raycastTerrain(heights, { x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull()
    expect(raycastTerrain(heights, { x: 500, y: 100, z: 0 }, { x: 0, y: -1, z: 0 })).toBeNull()
    expect(raycastTerrain(heights, { x: -100, y: 10, z: 0 }, norm(1, -0.01, 0))).toBeNull()
  })

  it('does not step over a single-sample spike', () => {
    const { heights } = createFlatLayers(64)
    heights.data[64 * 129 + 64] = 60
    const hit = raycastTerrain(heights, { x: -30.1, y: 30.3, z: 0 }, norm(1, -0.01, 0))
    expect(hit).not.toBeNull()
    expect(Math.abs(hit!.x)).toBeLessThan(0.25)
    expect(hit!.y).toBeGreaterThan(29)
  })
})
