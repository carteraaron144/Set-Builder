import { describe, expect, it } from 'vitest'
import { createFlatLayers, type Heightmap } from '../terrain/layers'
import type { Pond } from './features'
import { floodPond, type PondFill } from './ponds'

const SIZE = 64
const RES = SIZE * 2 + 1

function terrain(f: (x: number, z: number) => number): Heightmap {
  const h = createFlatLayers(SIZE).heights
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) h.data[j * RES + i] = f(-SIZE / 2 + i * 0.5, -SIZE / 2 + j * 0.5)
  return h
}

/** Rises to a 3 m rim at r = 20, then falls away towards the scene edge. */
const bowlHeight = (x: number, z: number) => {
  const r = Math.hypot(x, z)
  return r <= 20 ? 3 * (r / 20) ** 2 : 3 - (r - 20) * 0.2
}

const pond = (level: number, seed = { x: 0, z: 0 }): Pond => ({ id: 'p', seed, level })

function eachSample(fill: PondFill, visit: (x: number, z: number, flooded: boolean, i: number) => void) {
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) visit(-SIZE / 2 + i * 0.5, -SIZE / 2 + j * 0.5, fill.mask[j * RES + i] === 1, j * RES + i)
}

const onEdge = (i: number) => {
  const x = i % RES
  const z = Math.floor(i / RES)
  return x === 0 || z === 0 || x === RES - 1 || z === RES - 1
}

describe('floodPond', () => {
  it('floods exactly the bowl samples below its level', () => {
    const h = terrain(bowlHeight)
    const fill = floodPond(h, pond(2))
    expect(fill.capped).toBe(false)
    expect(fill.level).toBe(2)
    eachSample(fill, (x, z, flooded, i) => expect(flooded).toBe(Math.hypot(x, z) < 20 && h.data[i] < 2))
  })

  it('gives bounds that hold every flooded sample', () => {
    const fill = floodPond(terrain(bowlHeight), pond(2))
    const b = fill.bounds!
    eachSample(fill, (_x, _z, flooded, i) => {
      if (!flooded) return
      const x = i % RES
      const z = Math.floor(i / RES)
      expect(x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1).toBe(true)
    })
    expect(b.x0).toBeGreaterThan(0)
    expect(b.x1).toBeLessThan(RES - 1)
  })

  it('caps a level above the rim at the spill height less 0.05 m', () => {
    const fill = floodPond(terrain(bowlHeight), pond(5))
    expect(fill.capped).toBe(true)
    expect(fill.level).toBeGreaterThan(2.85)
    expect(fill.level).toBeLessThanOrEqual(3 - 0.05)
    eachSample(fill, (x, z, flooded) => {
      if (Math.hypot(x, z) > 20) expect(flooded).toBe(false)
    })
  })

  it('caps a bowl open to the edge at its lowest saddle', () => {
    // A channel clamped to 1.5 m cuts through the rim towards +x and reaches the edge.
    const h = terrain((x, z) => (x > 0 && Math.abs(z) < 2 && Math.hypot(x, z) >= 10 ? Math.min(bowlHeight(x, z), 1.5) : bowlHeight(x, z)))
    const fill = floodPond(h, pond(2))
    expect(fill.capped).toBe(true)
    expect(fill.level).toBeCloseTo(1.45, 5)
    eachSample(fill, (_x, _z, flooded, i) => {
      if (onEdge(i)) expect(flooded).toBe(false)
    })
  })

  it('never floods a flat scene to the edge', () => {
    const fill = floodPond(terrain(() => 0), pond(1, { x: 5, z: -3 }))
    expect(fill.capped).toBe(true)
    expect(fill.mask.every((m) => m === 0)).toBe(true)
    expect(fill.bounds).toBeNull()
  })

  it('is empty when the seed is at or above its level', () => {
    const h = terrain(bowlHeight)
    for (const level of [2, 3]) {
      const fill = floodPond(h, pond(level, { x: 20, z: 0 }))
      expect(fill.mask.every((m) => m === 0)).toBe(true)
      expect(fill.bounds).toBeNull()
    }
  })

  it('stays in its own basin behind a 4 m ridge', () => {
    const h = terrain((x, z) => (Math.abs(x) <= 1 ? 4 : 0.02 * ((Math.abs(x) - 14) ** 2 + z * z)))
    const fill = floodPond(h, pond(3, { x: -14, z: 0 }))
    expect(fill.capped).toBe(false)
    let left = 0
    eachSample(fill, (x, _z, flooded) => {
      if (flooded && x < 0) left++
      if (x > 0) expect(flooded).toBe(false)
    })
    expect(left).toBeGreaterThan(100)
  })

  it('handles a seed on the scene edge', () => {
    const fill = floodPond(terrain(bowlHeight), pond(10, { x: 32, z: 32 }))
    expect(fill.capped).toBe(true)
    expect(fill.bounds).toBeNull()
  })

  it('treats solid samples at the water level as walls, so a ring holds water in', () => {
    const h = terrain(bowlHeight)
    const ring = (i: number, j: number) => {
      const r = Math.hypot(-SIZE / 2 + i * 0.5, -SIZE / 2 + j * 0.5)
      return r >= 8 && r <= 9.5
    }
    const open_ = floodPond(h, pond(2))
    const held = floodPond(h, pond(2), (i, j) => ring(i, j))
    let outside = 0
    let wall = 0
    eachSample(held, (x, z, flooded, idx) => {
      const r = Math.hypot(x, z)
      if (flooded && r > 9.5) outside++
      if (flooded && ring(idx % RES, Math.floor(idx / RES))) wall++
    })
    expect(outside).toBe(0)
    expect(wall).toBe(0)
    expect(held.mask.reduce((a, b) => a + b, 0)).toBeGreaterThan(100)
    expect(open_.mask.reduce((a, b) => a + b, 0)).toBeGreaterThan(held.mask.reduce((a, b) => a + b, 0) * 2)
  })

  it('floods like before when nothing is solid', () => {
    const h = terrain(bowlHeight)
    expect(floodPond(h, pond(2), () => false)).toEqual(floodPond(h, pond(2)))
  })
})
