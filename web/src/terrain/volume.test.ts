import { describe, expect, it } from 'vitest'
import { BRICK, VolumeLayer, brickKey, unpackKey, type Brick } from './volume'
import { cloneLayers, createFlatLayers } from './layers'

function emptyBrick(): Brick {
  return { a: new Int8Array(512).fill(-64), k: new Int8Array(512).fill(-64) }
}

describe('brick keys', () => {
  it('round-trips signed Int16 coordinates', () => {
    for (const c of [[-4, -4, -4], [0, 0, 0], [63, 15, 63], [-32768, 32767, -1]] as const) {
      expect(unpackKey(brickKey(...c))).toEqual([...c])
    }
  })
})

describe('VolumeLayer', () => {
  it('reads (-2, -2) everywhere when empty', () => {
    const v = new VolumeLayer(64)
    const out = { a: 0, k: 0 }
    v.sample(3.3, -7, -12.1, out)
    expect(out).toEqual({ a: -2, k: -2 })
  })

  it('stores a voxel and samples it trilinearly', () => {
    const v = new VolumeLayer(64)
    const b = emptyBrick()
    b.a[0] = 32
    v.put(brickKey(0, 0, 0), b)
    const out = { a: 0, k: 0 }
    v.sampleLattice(0, 0, 0, out)
    expect(out.a).toBe(1)
    // voxel (0,0,0): world x = z = -32, y = 0. Halfway to the next voxel in x.
    v.sample(-32 + 0.25, 0, -32, out)
    expect(out.a).toBeCloseTo(-0.5, 6)
  })

  it('reads across brick boundaries and negative bricks', () => {
    const v = new VolumeLayer(64)
    const b = emptyBrick()
    b.a[7] = 32 // lx = 7 of brick (-1,0,0): vi = -1
    v.put(brickKey(-1, 0, 0), b)
    const out = { a: 0, k: 0 }
    v.sampleLattice(-1, 0, 0, out)
    expect(out.a).toBe(1)
    // between vi = -1 (1 m) and vi = 0 (missing, -2): halfway
    v.sample(-32 - 0.25, 0, -32, out)
    expect(out.a).toBeCloseTo(-0.5, 6)
  })

  it('drops all-default bricks', () => {
    const v = new VolumeLayer(64)
    v.put(brickKey(0, 0, 0), emptyBrick())
    expect(v.count).toBe(0)
    const b = emptyBrick()
    b.k[5] = 0
    v.put(brickKey(0, 0, 0), b)
    expect(v.count).toBe(1)
    v.put(brickKey(0, 0, 0), null)
    expect(v.count).toBe(0)
  })

  it('copy returns an independent brick, or null when absent', () => {
    const v = new VolumeLayer(64)
    const key = brickKey(0, 0, 0)
    expect(v.copy(key)).toBeNull()
    const b = emptyBrick()
    b.a[0] = 10
    v.put(key, b)
    const c = v.copy(key)!
    c.a[0] = 99
    expect(v.get(key)!.a[0]).toBe(10)
  })

  it('footprints extend 4 samples past the brick', () => {
    const v = new VolumeLayer(64)
    const b = emptyBrick()
    b.a[0] = 0
    v.put(brickKey(1, 0, 2), b)
    expect(v.footprints()).toEqual([{ x0: 4, z0: 12, x1: 19, z1: 27 }])
  })

  it('reports the y range of bricks over a sample column', () => {
    const v = new VolumeLayer(64)
    const b = emptyBrick()
    b.a[0] = 0
    v.put(brickKey(0, -2, 0), b)
    v.put(brickKey(0, 3, 0), b)
    expect(v.columnRange(5, 7)).toEqual([-8, 3 * 4 + 3.5])
    expect(v.columnRange(9, 7)).toBeNull()
    v.put(brickKey(0, 3, 0), null)
    expect(v.columnRange(5, 7)).toEqual([-8, -8 + 3.5])
  })

  it('clones deeply', () => {
    const v = new VolumeLayer(64)
    const b = emptyBrick()
    b.a[0] = 10
    v.put(brickKey(0, 0, 0), b)
    const c = v.clone()
    c.get(brickKey(0, 0, 0))!.a[0] = 1
    expect(v.get(brickKey(0, 0, 0))!.a[0]).toBe(10)
    expect(BRICK).toBe(8)
  })
})

describe('layers volume', () => {
  it('createFlatLayers has an empty volume and cloneLayers deep-copies it', () => {
    const l = createFlatLayers(64)
    expect(l.volume.count).toBe(0)
    const b = emptyBrick()
    b.a[0] = 3
    l.volume.put(brickKey(0, 0, 0), b)
    const c = cloneLayers(l)
    expect(c.volume).not.toBe(l.volume)
    expect(c.volume.get(brickKey(0, 0, 0))!.a[0]).toBe(3)
    c.volume.get(brickKey(0, 0, 0))!.a[0] = 4
    expect(l.volume.get(brickKey(0, 0, 0))!.a[0]).toBe(3)
  })
})
