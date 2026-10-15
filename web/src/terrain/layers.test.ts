import { describe, expect, it } from 'vitest'
import {
  biomeWeightsAt,
  clipRect,
  cloneLayers,
  createFlatLayers,
  cropRect,
  heightAt,
  pasteRect,
} from './layers'

describe('createFlatLayers', () => {
  it('sizes a 256 m scene: 0.5 m heights and 1 m all-meadow biomes', () => {
    const l = createFlatLayers(256)
    expect(l.heights.resolution).toBe(513)
    expect(l.heights.data).toHaveLength(263169)
    expect(l.heights.data.every((h) => h === 0)).toBe(true)
    expect(l.biomes.resolution).toBe(257)
    expect(l.biomes.data).toHaveLength(257 * 257 * 4)
    for (let i = 0; i < l.biomes.data.length; i += 4) {
      expect([...l.biomes.data.subarray(i, i + 4)]).toEqual([255, 0, 0, 0])
    }
  })

  it('sizes a 64 m scene', () => {
    const l = createFlatLayers(64)
    expect(l.heights.resolution).toBe(129)
    expect(l.biomes.resolution).toBe(65)
  })
})

describe('sampling', () => {
  it('reads heights bilinearly in world coordinates, clamped to the edges', () => {
    const { heights } = createFlatLayers(64)
    heights.data[20 * 129 + 10] = 6
    expect(heightAt(heights, -32 + 5, -32 + 10)).toBeCloseTo(6)
    expect(heightAt(heights, -32 + 5.25, -32 + 10)).toBeCloseTo(3)
    heights.data[0] = 4
    expect(heightAt(heights, -1000, -1000)).toBeCloseTo(4)
  })

  it('reads biome weights as fractions', () => {
    const { biomes } = createFlatLayers(64)
    expect(biomeWeightsAt(biomes, 3, -7)).toEqual([1, 0, 0, 0])
  })
})

describe('rects', () => {
  it('clips to the grid', () => {
    expect(clipRect({ x0: -5, z0: -5, x1: 3, z1: 600 }, 513)).toEqual({ x0: 0, z0: 0, x1: 3, z1: 512 })
    expect(clipRect({ x0: 600, z0: 0, x1: 700, z1: 5 }, 513)).toBeNull()
    expect(clipRect({ x0: -10, z0: -10, x1: -1, z1: -1 }, 513)).toBeNull()
  })

  it('crops and pastes one-channel data', () => {
    const res = 5
    const data = Float32Array.from({ length: res * res }, (_, i) => i)
    const rect = { x0: 1, z0: 2, x1: 3, z1: 3 }
    const crop = cropRect(data, res, 1, rect)
    expect([...crop]).toEqual([11, 12, 13, 16, 17, 18])
    const target = new Float32Array(res * res)
    pasteRect(target, res, 1, rect, crop)
    expect(target[2 * res + 1]).toBe(11)
    expect(target[3 * res + 3]).toBe(18)
    expect(target[0]).toBe(0)
    expect(target[4 * res + 4]).toBe(0)
  })

  it('crops and pastes four-channel data', () => {
    const res = 4
    const data = Uint8Array.from({ length: res * res * 4 }, (_, i) => i % 251)
    const rect = { x0: 2, z0: 1, x1: 3, z1: 1 }
    const crop = cropRect(data, res, 4, rect)
    expect(crop).toHaveLength(8)
    const target = new Uint8Array(res * res * 4)
    pasteRect(target, res, 4, rect, crop)
    expect([...target.subarray((1 * res + 2) * 4, (1 * res + 4) * 4)]).toEqual([...data.subarray((1 * res + 2) * 4, (1 * res + 4) * 4)])
    expect(target[0]).toBe(0)
  })

  it('clones layers deeply', () => {
    const a = createFlatLayers(64)
    const b = cloneLayers(a)
    b.heights.data[0] = 9
    b.biomes.data[0] = 1
    expect(a.heights.data[0]).toBe(0)
    expect(a.biomes.data[0]).toBe(255)
  })
})
