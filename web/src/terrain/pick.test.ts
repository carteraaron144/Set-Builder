import { describe, expect, it } from 'vitest'
import type { Cave } from '../features/features'
import { Ground } from '../features/ground'
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

describe('raycastTerrain with a density field', () => {
  // A hill rising east from x = -56 to a 12 m plateau, with a level tunnel at y = 3 from x = -53 to -39.
  const SIZE = 128
  const RES = SIZE * 2 + 1
  const hill = createFlatLayers(SIZE)
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) hill.heights.data[j * RES + i] = Math.min(12, Math.max(0, (-SIZE / 2 + i * 0.5 + 56) * 0.8))
  const cave: Cave = {
    id: 'c',
    radius: 2,
    points: [
      { x: -53, y: 3, z: -48, chamber: 0 },
      { x: -39, y: 3, z: -48, chamber: 0 },
    ],
  }
  const ground = new Ground(hill, { splines: [], ponds: [], caves: [cave] })
  const density = (x: number, y: number, z: number) => ground.density(x, y, z)

  it('flies into a cave mouth and stops at the tunnel end', () => {
    const origin = { x: -70, y: 3, z: -48 }
    const dir = { x: 1, y: 0, z: 0 }
    expect(raycastTerrain(ground.layers.heights, origin, dir)!.x).toBeCloseTo(-52.25, 1)
    const hit = raycastTerrain(ground.layers.heights, origin, dir, 2000, density)!
    expect(hit.x).toBeGreaterThan(-38)
    expect(hit.x).toBeLessThan(-36)
    expect(Math.abs(density(hit.x, hit.y, hit.z))).toBeLessThan(0.05)
  })

  it('matches the heightmap away from caves', () => {
    const origin = { x: 20, y: 40, z: 20 }
    const dir = { x: -0.3, y: -1, z: 0.2 }
    const plain = raycastTerrain(ground.layers.heights, origin, dir)!
    const dense = raycastTerrain(ground.layers.heights, origin, dir, 2000, density)!
    expect(dense.x).toBeCloseTo(plain.x, 3)
    expect(dense.y).toBeCloseTo(plain.y, 3)
    expect(dense.z).toBeCloseTo(plain.z, 3)
  })
})
