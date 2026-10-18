import { describe, expect, it } from 'vitest'
import { sculpt3d, is3dMode, RADIUS_3D_MAX, type Dab3 } from './brush3d'
import { BRUSH_DEFAULTS, RAISE_RATE, type BrushSettings } from './brush'
import { MAX_HEIGHT, MIN_HEIGHT } from './layers'
import { brickKey, MAX_BRICKS, unpackKey, VALUE_LIMIT, VolumeLayer, type Brick } from './volume'

const SIZE = 64
const brush = (radius: number, strength = 1): BrushSettings => ({ ...BRUSH_DEFAULTS, radius, strength, falloff: 0.5 })
const dab = (x: number, y: number, z: number, invert = false): Dab3 => ({ x, y, z, dt: 0.1, invert })

/** Combined density over flat ground at y = 0, the way Ground.density builds it from the bricks. */
const densityOf = (v: VolumeLayer) => (x: number, y: number, z: number) => {
  const o = { a: 0, k: 0 }
  v.sample(x, y, z, o)
  return Math.min(Math.max(-y, o.a), -o.k)
}

const run = (v: VolumeLayer, mode: 'add' | 'carve' | 'smooth3d', b: BrushSettings, d: Dab3, touched = new Set<number>()) =>
  sculpt3d(v, mode, b, d, densityOf(v), (k) => touched.add(k))

describe('sculpt3d', () => {
  it('recognises the 3D modes', () => {
    expect(['add', 'carve', 'smooth3d'].every((m) => is3dMode(m as never))).toBe(true)
    expect(is3dMode('raise')).toBe(false)
  })

  it('Add makes the centre solid and leaves distant bricks absent', () => {
    const v = new VolumeLayer(SIZE)
    expect(run(v, 'add', brush(2), dab(0, 5, 0))).not.toBe('limit')
    const o = { a: 0, k: 0 }
    v.sample(0, 5, 0, o)
    expect(o.a).toBeGreaterThan(0)
    expect(o.k).toBe(-2)
    for (const key of v.keys()) {
      const [bx, by, bz] = unpackKey(key)
      // Nearest point of the 4 m brick to the dab (voxel 0 of x is at -32).
      const near = (lo: number, c: number) => Math.max(lo, Math.min(lo + 3.5, c)) - c
      const dx = near(-32 + bx * 4, 0)
      const dy = near(by * 4, 5)
      const dz = near(-32 + bz * 4, 0)
      expect(Math.hypot(dx, dy, dz)).toBeLessThanOrEqual(2 + 1)
    }
  })

  it('Carve touches only K', () => {
    const v = new VolumeLayer(SIZE)
    run(v, 'carve', brush(2), dab(0, 5, 0))
    for (const key of v.keys()) {
      expect(v.get(key)!.a.every((x) => x === -64)).toBe(true)
      expect(v.get(key)!.k.some((x) => x !== -64)).toBe(true)
    }
  })

  it('Alt-Add equals Carve and Alt-Carve equals Add', () => {
    const a = new VolumeLayer(SIZE)
    const b = new VolumeLayer(SIZE)
    run(a, 'add', brush(3), dab(1, 4, 2, true))
    run(b, 'carve', brush(3), dab(1, 4, 2, false))
    expect([...a.keys()]).toEqual([...b.keys()])
    for (const k of a.keys()) {
      expect(a.get(k)!.a).toEqual(b.get(k)!.a)
      expect(a.get(k)!.k).toEqual(b.get(k)!.k)
    }
  })

  it('saturates repeated Add at the value limit', () => {
    const v = new VolumeLayer(SIZE)
    for (let n = 0; n < 40; n++) run(v, 'add', brush(2), dab(0, 5, 0))
    const o = { a: 0, k: 0 }
    v.sampleLattice(64, 64, 5, o)
    expect(o.a).toBe(VALUE_LIMIT)
  })

  it.each([0.1, 1 / 60])('moves the surface by at most the raise rate × dt per dab once there is one (dt %f)', (dt) => {
    const v = new VolumeLayer(SIZE)
    run(v, 'add', brush(4), dab(0, 5, 0))
    const before = new Map([...v.keys()].map((k) => [k, v.get(k)!.a.slice()]))
    run(v, 'add', brush(4), { ...dab(0, 5, 0), dt })
    let biggest = 0
    for (const k of v.keys()) for (let i = 0; i < 512; i++) biggest = Math.max(biggest, (v.get(k)!.a[i] - (before.get(k)?.[i] ?? -64)) / 32)
    expect(biggest).toBeLessThanOrEqual(RAISE_RATE * dt + 1 / 32)
    expect(biggest).toBeGreaterThan(0)
  })

  it('Smooth 3D lowers a one-voxel spike', () => {
    const v = new VolumeLayer(SIZE)
    const spike: Brick = { a: new Int8Array(512).fill(-64), k: new Int8Array(512).fill(-64) }
    spike.a[(2 * 8 + 0) * 8 + 0] = 32 // voxel (64, 10, 64) is local (0, 2, 0) of brick (8, 1, 8)
    v.put(brickKey(8, 1, 8), spike)
    const density = densityOf(v)
    const before = density(0, 5, 0)
    expect(sculpt3d(v, 'smooth3d', brush(2), dab(0, 5, 0), density, () => {})).not.toBe('limit')
    expect(density(0, 5, 0)).toBeLessThan(before)
  })

  it('creates nothing outside the scene square', () => {
    const v = new VolumeLayer(SIZE)
    run(v, 'add', brush(6), dab(SIZE / 2, 5, 0))
    expect(v.count).toBeGreaterThan(0)
    const res = SIZE * 2 + 1
    for (const key of v.keys()) {
      const [bx, , bz] = unpackKey(key)
      const b = v.get(key)!
      for (let i = 0; i < 512; i++) {
        const vi = bx * 8 + (i & 7)
        const vj = bz * 8 + ((i >> 3) & 7)
        if (vi >= res || vj >= res || vi < 0 || vj < 0) expect(b.a[i]).toBe(-64)
      }
    }
  })

  it('creates nothing above the height limit or below the floor', () => {
    for (const y of [MAX_HEIGHT, MIN_HEIGHT]) {
      const v = new VolumeLayer(SIZE)
      run(v, 'add', brush(6), dab(0, y, 0))
      expect(v.count).toBeGreaterThan(0)
      for (const key of v.keys()) {
        const [, by] = unpackKey(key)
        const b = v.get(key)!
        for (let i = 0; i < 512; i++) {
          const wy = (by * 8 + (i >> 6)) * 0.5
          if (wy > MAX_HEIGHT || wy < MIN_HEIGHT) expect(b.a[i]).toBe(-64)
        }
      }
    }
  })

  it('returns limit and changes nothing when the dab needs more bricks than are left', () => {
    const v = new VolumeLayer(SIZE)
    const one: Brick = { a: new Int8Array(512).fill(-64), k: new Int8Array(512).fill(-64) }
    one.a[0] = 0
    // Fill with bricks far from the dab (distinct keys; bounds are not checked by the layer).
    for (let n = 0; n < MAX_BRICKS - 1; n++) v.put(brickKey(-2000 + (n % 100), -100 + Math.floor(n / 100) , -2000), { a: one.a.slice(), k: one.k.slice() })
    expect(v.count).toBe(MAX_BRICKS - 1)
    const touched = new Set<number>()
    expect(run(v, 'add', brush(4), dab(0, 5, 0), touched)).toBe('limit')
    expect(v.count).toBe(MAX_BRICKS - 1)
    expect(touched.size).toBe(0)
  })

  it('reports each touched brick once per dab', () => {
    const v = new VolumeLayer(SIZE)
    const calls: number[] = []
    const touched = sculpt3d(v, 'add', brush(3), dab(0, 4, 0), densityOf(v), (k) => calls.push(k))
    expect(touched).not.toBe('limit')
    expect(new Set(calls).size).toBe(calls.length)
    expect(new Set(calls)).toEqual(new Set(touched as number[]))
  })

  it('clamps the radius to the 3D maximum', () => {
    const v = new VolumeLayer(256)
    run(v, 'add', brush(50), dab(0, 5, 0))
    const o = { a: 0, k: 0 }
    v.sample(RADIUS_3D_MAX + 2, 5, 0, o)
    expect(o.a).toBe(-2)
  })

  it('Smooth 3D leaves voxels far from the surface alone, so later Add still works', () => {
    const dome = (x: number, z: number) => 10 - 0.05 * (x * x + z * z)
    const v = new VolumeLayer(SIZE)
    const density = (x: number, y: number, z: number) => {
      const o = { a: 0, k: 0 }
      v.sample(x, y, z, o)
      // As Ground.density: exactly h - y where no brick has set anything.
      if (o.a === -2 && o.k === -2) return dome(x, z) - y
      return Math.min(Math.max(dome(x, z) - y, o.a), -o.k)
    }
    expect(sculpt3d(v, 'smooth3d', brush(6), dab(0, 10, 0), density, () => {})).not.toBe('limit')
    for (const key of v.keys()) for (const ch of ['a', 'k'] as const) expect(v.get(key)![ch].every((u) => u < 64)).toBe(true)
  })
})
