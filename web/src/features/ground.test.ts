import { describe, expect, it } from 'vitest'
import { createFlatLayers, heightAt, type TerrainLayers } from '../terrain/layers'
import { emptyFeatures, type Features, type Pond, type Spline } from './features'
import { Ground } from './ground'
import { brickKey, type Brick } from '../terrain/volume'
import { smoothMin } from './caves'
import { FEATURES } from './features'
import { SURFACE } from './carve'

const SIZE = 64
const RES = SIZE * 2 + 1
const B_RES = SIZE + 1

function sloped(): TerrainLayers {
  const l = createFlatLayers(SIZE)
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) l.heights.data[j * RES + i] = 0.2 * i * 0.5 + 0.3 * Math.sin(i * 0.4) * Math.cos(j * 0.3)
  return l
}

/** A bowl 2 m deep at (-16, -16), on otherwise flat ground at 2 m. */
function bowl(): TerrainLayers {
  const l = createFlatLayers(SIZE)
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) {
      const r = Math.hypot(-SIZE / 2 + i * 0.5 + 16, -SIZE / 2 + j * 0.5 + 16)
      l.heights.data[j * RES + i] = r < 8 ? 2 * (r / 8) ** 2 : 2
    }
  return l
}

const path = (dz = 0, id = 'a'): Spline => ({
  id,
  kind: 'path',
  style: 'dirt',
  width: 3,
  points: [
    { x: -20, z: dz },
    { x: 0, z: dz + 4 },
    { x: 20, z: dz },
  ],
})

const pond = (level = 1.5): Pond => ({ id: 'p', seed: { x: -16, z: -16 }, level })
const with_ = (splines: Spline[], ponds: Pond[] = []): Features => ({ splines, ponds, caves: [] })

describe('Ground', () => {
  it('equals the base, with no exclusion, when there are no features', () => {
    const base = sloped()
    const g = new Ground(base, emptyFeatures())
    expect(g.layers.heights.data).toEqual(base.heights.data)
    expect(g.layers.heights.data).not.toBe(base.heights.data)
    expect(g.layers.biomes).toBe(base.biomes)
    expect(g.exclusion).toBeNull()
    expect(g.ponds).toEqual([])
  })

  it('restores the same bytes when a path moves away and back, and the base when deleted', () => {
    const base = sloped()
    const g = new Ground(base, with_([path()]))
    const first = g.layers.heights.data.slice()
    const firstSurface = g.surface.weight.slice()
    expect(first).not.toEqual(base.heights.data)
    g.rebuild(with_([path(10)]), null)
    expect(g.layers.heights.data).not.toEqual(first)
    g.rebuild(with_([path()]), null)
    expect(g.layers.heights.data).toEqual(first)
    expect(g.surface.weight).toEqual(firstSurface)
    g.rebuild(emptyFeatures(), null)
    expect(g.layers.heights.data).toEqual(base.heights.data)
    expect(g.surface.weight.every((w) => w === 0)).toBe(true)
    expect(g.exclusion).toBeNull()
  })

  it('matches a fresh build after edits', () => {
    const base = sloped()
    const g = new Ground(base, with_([path()]))
    g.rebuild(with_([path(), path(-12, 'b')]), null)
    g.rebuild(with_([path(-12, 'b')]), null)
    const fresh = new Ground(base, with_([path(-12, 'b')]))
    expect(g.layers.heights.data).toEqual(fresh.layers.heights.data)
    expect(g.exclusion).toEqual(fresh.exclusion)
  })

  it('returns the old and new footprints of a moved spline', () => {
    const base = sloped()
    const g = new Ground(base, with_([path()]))
    const before = g.profiles[0].footprint!
    const rects = g.rebuild(with_([path(10)]), null)
    const after = g.profiles[0].footprint!
    expect(rects).toContainEqual(before)
    expect(rects).toContainEqual(after)
  })

  it('returns only the given rect when nothing reaches it', () => {
    const g = new Ground(sloped(), with_([path()]))
    const far = { x0: 2, z0: 2, x1: 6, z1: 6 }
    expect(g.rebuild(with_([path()]), far)).toEqual([far])
  })

  it('floods ponds on the carved ground and clears scatter within 1 m of them', () => {
    const g = new Ground(bowl(), with_([], [pond()]))
    expect(g.ponds).toHaveLength(1)
    expect(g.ponds[0].level).toBe(1.5)
    const ex = g.exclusion!
    const at = (x: number, z: number) => ex[(z + SIZE / 2) * B_RES + (x + SIZE / 2)]
    expect(at(-16, -16)).toBe(1)
    // The pond floods r < 8·sqrt(0.75) ≈ 6.93 m.
    expect(at(-16 + 7, -16)).toBe(1)
    expect(at(-16 + 9, -16)).toBe(0)
  })

  it('reports pond changes as rects', () => {
    const g = new Ground(bowl(), with_([], [pond()]))
    const rects = g.rebuild(with_([], [pond(1.8)]), null)
    expect(rects.length).toBeGreaterThan(0)
    expect(g.ponds[0].level).toBe(1.8)
    expect(g.rebuild(with_([], [pond(1.8)]), null)).toEqual([])
  })
})

/** A brick with every voxel's A (or K) set to `v` Int8 units. */
function filledBrick(channel: 'a' | 'k', v: number): Brick {
  const b: Brick = { a: new Int8Array(512).fill(-64), k: new Int8Array(512).fill(-64) }
  b[channel].fill(v)
  return b
}

describe('Ground volume density', () => {
  it('equals the heightmap and cave field exactly with no bricks', () => {
    const g = new Ground(sloped(), emptyFeatures())
    let seed = 12345
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    for (let n = 0; n < 50; n++) {
      const x = (rnd() - 0.5) * 60
      const y = (rnd() - 0.5) * 20
      const z = (rnd() - 0.5) * 60
      const expected = smoothMin(g.layers.heights.data.length ? heightAtRef(g, x, z) - y : 0, g.caveDistance(x, y, z), FEATURES.cave.groundBlend)
      expect(g.density(x, y, z)).toBe(expected)
    }
  })

  it('shares the volume layer with the base layers', () => {
    const base = createFlatLayers(SIZE)
    expect(new Ground(base, emptyFeatures()).layers.volume).toBe(base.volume)
  })

  it('makes a point above flat ground solid where Add reaches', () => {
    const base = createFlatLayers(SIZE)
    const b = filledBrick('a', 32)
    base.volume.put(brickKey(8, 0, 8), b)
    const g = new Ground(base, emptyFeatures())
    expect(g.density(0.5, 2, 0.5)).toBeGreaterThan(0)
  })

  it('makes a point below ground air where Carve reaches', () => {
    const base = createFlatLayers(SIZE)
    base.volume.put(brickKey(8, -1, 8), filledBrick('k', 32))
    const g = new Ground(base, emptyFeatures())
    expect(g.density(0.5, -1.5, 0.5)).toBeLessThan(0)
  })

  it('clears a corridor above a path inside an Add brick, but not above it', () => {
    const base = createFlatLayers(SIZE)
    const g0 = new Ground(base, with_([path()]))
    let idx = -1
    for (let n = 0; n < g0.surface.kind.length && idx < 0; n++) if (g0.surface.kind[n] !== SURFACE.none && g0.surface.weight[n] === 255) idx = n
    expect(idx).toBeGreaterThanOrEqual(0)
    const x = -SIZE / 2 + (idx % RES) * 0.5
    const z = -SIZE / 2 + Math.floor(idx / RES) * 0.5
    const bx = Math.floor((idx % RES) / 8)
    const bz = Math.floor(Math.floor(idx / RES) / 8)
    for (let by = -1; by <= 1; by++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) base.volume.put(brickKey(bx + dx, by, bz + dz), filledBrick('a', 32))
    const g = new Ground(base, with_([path()]))
    const h = g.layers.heights.data[idx]
    expect(g.density(x, h + 2, z)).toBeLessThanOrEqual(0)
    expect(g.density(x, h + 5, z)).toBeGreaterThan(0)
  })

  it('raycasts straight down onto an Add blob, not the ground', () => {
    const base = createFlatLayers(SIZE)
    for (let by = 0; by <= 1; by++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) base.volume.put(brickKey(8 + dx, by, 8 + dz), filledBrick('a', 32))
    const g = new Ground(base, emptyFeatures())
    const hit = g.raycast({ x: 0.5, y: 20, z: 0.5 }, { x: 0, y: -1, z: 0 })!
    expect(hit.y).toBeGreaterThan(7)
  })

  it('treats chunks meeting a brick footprint as SDF chunks', () => {
    const base = createFlatLayers(128)
    base.volume.put(brickKey(9, 0, 0), filledBrick('a', 0))
    const g = new Ground(base, emptyFeatures())
    // Footprint spans samples 68..83 in x; chunk 0 ends at 64 (2 m clear), chunk 1 begins at 64.
    expect(g.isSdfChunk(0)).toBe(false)
    expect(g.isSdfChunk(1)).toBe(true)
    expect(g.isSdfChunk(2)).toBe(false)
    expect(g.hasVolume(1)).toBe(true)
  })

  it('refreshVolume returns the old and new footprints after bricks change', () => {
    const base = createFlatLayers(128)
    const g = new Ground(base, emptyFeatures())
    expect(g.refreshVolume()).toEqual([])
    base.volume.put(brickKey(9, 0, 0), filledBrick('a', 0))
    expect(g.refreshVolume()).toEqual([{ x0: 68, z0: -4, x1: 83, z1: 11 }])
    base.volume.put(brickKey(9, 0, 0), null)
    expect(g.refreshVolume()).toEqual([{ x0: 68, z0: -4, x1: 83, z1: 11 }])
    expect(g.isSdfChunk(1)).toBe(false)
  })
})

function heightAtRef(g: Ground, x: number, z: number): number {
  return heightAt(g.layers.heights, x, z)
}
