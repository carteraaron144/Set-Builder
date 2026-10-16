import { describe, expect, it } from 'vitest'
import { createFlatLayers, type TerrainLayers } from '../terrain/layers'
import { emptyFeatures, type Features, type Pond, type Spline } from './features'
import { Ground } from './ground'

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
