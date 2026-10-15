import { describe, expect, it } from 'vitest'
import { BRUSH_DEFAULTS, BRUSH_RADIUS_MAX, BRUSH_RADIUS_MIN, brushWeight, paint, sculpt, type BrushSettings } from './brush'
import { BIOME_IDS, createFlatLayers, type Heightmap } from './layers'

const ctx = { flattenTo: 0, seed: 7 }
const hard = (radius: number, strength = 1): BrushSettings => ({ radius, strength, falloff: 0 })
const centre = (h: Heightmap) => h.data[((h.resolution - 1) / 2) * h.resolution + (h.resolution - 1) / 2]
const at = (h: Heightmap, i: number, j: number) => h.data[j * h.resolution + i]

/** Numeric equality (so 0 and -0 match), reporting the first mismatch. */
function expectSameValues(actual: ArrayLike<number>, expected: ArrayLike<number>) {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) expect([i, actual[i]]).toEqual([i, expected[i]])
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('brush settings', () => {
  it('has the planned defaults and radius range', () => {
    expect(BRUSH_DEFAULTS).toEqual({ radius: 8, strength: 0.5, falloff: 0.5 })
    expect([BRUSH_RADIUS_MIN, BRUSH_RADIUS_MAX]).toEqual([1, 50])
  })

  it('weights by distance with a smoothstep falloff', () => {
    const b = { radius: 10, strength: 1, falloff: 0.5 }
    expect(brushWeight(0, b)).toBe(1)
    expect(brushWeight(5, b)).toBe(1)
    expect(brushWeight(7.5, b)).toBeCloseTo(0.5)
    expect(brushWeight(10, b)).toBe(0)
    expect(brushWeight(12, b)).toBe(0)
    expect(brushWeight(9.99, { ...b, falloff: 0 })).toBe(1)
    expect(brushWeight(10, { ...b, falloff: 0 })).toBe(0)
    expect(brushWeight(5, { ...b, falloff: 1 })).toBeCloseTo(0.5)
  })
})

describe('sculpt', () => {
  it('raises 8 m/s at strength 1 within the radius', () => {
    const { heights } = createFlatLayers(64)
    const rect = sculpt(heights, 'raise', hard(4), { x: 0, z: 0, dt: 0.5, invert: false }, ctx)
    expect(centre(heights)).toBeCloseTo(4)
    expect(at(heights, 64 + 10, 64)).toBe(0)
    expect(rect).toEqual({ x0: 56, z0: 56, x1: 72, z1: 72 })
  })

  it('lowers, and invert swaps raise and lower', () => {
    const a = createFlatLayers(64).heights
    sculpt(a, 'raise', hard(4), { x: 0, z: 0, dt: 0.5, invert: true }, ctx)
    expect(centre(a)).toBeCloseTo(-4)
    const b = createFlatLayers(64).heights
    sculpt(b, 'lower', hard(4), { x: 0, z: 0, dt: 0.5, invert: false }, ctx)
    expect(centre(b)).toBeCloseTo(-4)
    const c = createFlatLayers(64).heights
    sculpt(c, 'lower', hard(4), { x: 0, z: 0, dt: 0.5, invert: true }, ctx)
    expect(centre(c)).toBeCloseTo(4)
  })

  it('clamps heights to -32..64 m', () => {
    const up = createFlatLayers(64).heights
    sculpt(up, 'raise', hard(4), { x: 0, z: 0, dt: 100, invert: false }, ctx)
    expect(centre(up)).toBe(64)
    const down = createFlatLayers(64).heights
    sculpt(down, 'lower', hard(4), { x: 0, z: 0, dt: 100, invert: false }, ctx)
    expect(centre(down)).toBe(-32)
  })

  it('flattens to the target height', () => {
    const { heights } = createFlatLayers(64)
    for (let j = 0; j < heights.resolution; j++)
      for (let i = 0; i < heights.resolution; i++) heights.data[j * heights.resolution + i] = i * 0.1
    sculpt(heights, 'flatten', hard(6), { x: 0, z: 0, dt: 10, invert: false }, { flattenTo: 10, seed: 1 })
    for (let j = 52; j <= 76; j++)
      for (let i = 52; i <= 76; i++) {
        if (Math.hypot(i - 64, j - 64) * 0.5 < 6) expect(at(heights, i, j)).toBeCloseTo(10)
      }
  })

  it('smooths a spike and leaves flat ground flat; invert does not change smoothing', () => {
    const spiky = (invert: boolean) => {
      const { heights } = createFlatLayers(64)
      heights.data[64 * 129 + 64] = 10
      sculpt(heights, 'smooth', hard(3), { x: 0, z: 0, dt: 1, invert }, ctx)
      return heights
    }
    const h = spiky(false)
    expect(centre(h)).toBeLessThan(10)
    expect(at(h, 65, 64)).toBeGreaterThan(0)
    expectSameValues(spiky(true).data, h.data)
    const flat = createFlatLayers(64).heights
    sculpt(flat, 'smooth', hard(3), { x: 0, z: 0, dt: 1, invert: false }, ctx)
    expect(flat.data.every((v) => v === 0)).toBe(true)
  })

  it('adds deterministic seeded noise; invert negates it', () => {
    const run = (invert: boolean, seed = 7) => {
      const { heights } = createFlatLayers(64)
      sculpt(heights, 'noise', hard(10), { x: 3, z: -2, dt: 0.5, invert }, { flattenTo: 0, seed })
      return heights.data
    }
    const a = run(false)
    expectSameValues(run(false), a)
    expect(a.some((v) => v !== 0)).toBe(true)
    expectSameValues(run(true), a.map((v) => -v))
    expect(run(false, 8).some((v, i) => v !== a[i])).toBe(true)
  })

  it('clips dabs at the scene edge', () => {
    const { heights } = createFlatLayers(64)
    const rect = sculpt(heights, 'raise', hard(8), { x: -32, z: -32, dt: 0.5, invert: false }, ctx)
    expect(rect).toMatchObject({ x0: 0, z0: 0 })
    expect(heights.data[0]).toBeCloseTo(4)
  })

  it('handles a brush bigger than the scene', () => {
    const { heights } = createFlatLayers(64)
    const rect = sculpt(heights, 'raise', hard(50), { x: 0, z: 0, dt: 0.1, invert: false }, ctx)
    expect(rect).toEqual({ x0: 0, z0: 0, x1: 128, z1: 128 })
    expect(heights.data.every((v) => v > 0)).toBe(true)
  })

  it('ignores dabs off the scene', () => {
    const { heights } = createFlatLayers(64)
    expect(sculpt(heights, 'raise', hard(8), { x: 100, z: 0, dt: 0.5, invert: false }, ctx)).toBeNull()
    expect(heights.data.every((v) => v === 0)).toBe(true)
  })
})

describe('paint', () => {
  const sample = (data: Uint8Array, res: number, i: number, j: number) => [...data.subarray((j * res + i) * 4, (j * res + i) * 4 + 4)]

  it('paints a biome at full strength', () => {
    const { biomes } = createFlatLayers(64)
    const rect = paint(biomes, 'forest', hard(4), { x: 0, z: 0, dt: 1, invert: false })
    expect(sample(biomes.data, 65, 32, 32)).toEqual([0, 255, 0, 0])
    expect(rect).toEqual({ x0: 28, z0: 28, x1: 36, z1: 36 })
  })

  it('keeps every sample summing to 255', () => {
    const { biomes } = createFlatLayers(64)
    const rand = mulberry32(99)
    for (let n = 0; n < 200; n++) {
      paint(
        biomes,
        BIOME_IDS[Math.floor(rand() * 4)],
        { radius: 1 + rand() * 20, strength: rand(), falloff: rand() },
        { x: rand() * 80 - 40, z: rand() * 80 - 40, dt: rand() * 0.1, invert: rand() < 0.3 },
      )
    }
    for (let i = 0; i < biomes.data.length; i += 4) {
      expect(biomes.data[i] + biomes.data[i + 1] + biomes.data[i + 2] + biomes.data[i + 3]).toBe(255)
    }
  })

  it('erases a biome back to meadow; erasing meadow does nothing', () => {
    const { biomes } = createFlatLayers(64)
    paint(biomes, 'forest', hard(4), { x: 0, z: 0, dt: 1, invert: false })
    paint(biomes, 'forest', hard(4), { x: 0, z: 0, dt: 1, invert: true })
    expect(sample(biomes.data, 65, 32, 32)).toEqual([255, 0, 0, 0])
    const before = biomes.data.slice()
    expect(paint(biomes, 'meadow', hard(4), { x: 0, z: 0, dt: 1, invert: true })).toBeNull()
    expectSameValues(biomes.data, before)
  })
})
