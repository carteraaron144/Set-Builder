import { describe, expect, it } from 'vitest'
import { createFlatLayers } from '../terrain/layers'
import { TerrainEditor } from '../terrain/terrainEditor'
import { draftCaveGlow, draftGlowPoints, GlowThrottle } from './caveGlow'
import { emptyFeatures, FEATURES, type CavePoint } from './features'

const pt = (x: number, y: number, z: number): CavePoint => ({ x, y, z, chamber: 0 })
const heights = () => createFlatLayers(64).heights

describe('draftCaveGlow', () => {
  it('has nothing for an empty draft', () => {
    expect(draftCaveGlow(heights(), [])).toEqual([])
  })

  it('shows a single dropped point as a blob around it', () => {
    const glow = draftCaveGlow(heights(), [pt(0, -4, 0)])
    expect(glow.length).toBeGreaterThan(0)
    const r = FEATURES.cave.radius.default
    for (const g of glow) {
      expect(g.indices.length).toBeGreaterThan(0)
      for (let v = 0; v < g.positions.length; v += 3) {
        expect(Math.hypot(g.positions[v], g.positions[v + 1] + 4, g.positions[v + 2])).toBeLessThan(r + 1.5)
      }
    }
  })

  it('covers every chunk a tunnel across a chunk border reaches, one mesh per chunk', () => {
    const glow = draftCaveGlow(heights(), [pt(-10, -4, 0), pt(10, -4, 0)]) // chunks meet at x = 0 in a 64 m scene
    expect(glow.map((g) => g.chunk).sort()).toEqual([0, 1, 2, 3].filter((c) => glow.some((g) => g.chunk === c)).sort())
    expect(new Set(glow.map((g) => g.chunk)).size).toBe(glow.length)
    expect(glow.length).toBeGreaterThanOrEqual(2)
  })

  it('matches the glow of the same cave once it is committed', () => {
    const points = [pt(-10, -4, 0), pt(10, -6, 3)]
    const ed = new TerrainEditor(createFlatLayers(64), 1, { ...emptyFeatures(), caves: [{ id: 'c', radius: FEATURES.cave.radius.default, points }] }, () => {})
    for (const g of draftCaveGlow(ed.layers.heights, points)) {
      const want = ed.ground.caveGlowGeometry(g.chunk)!
      expect(Array.from(g.positions)).toEqual(Array.from(want.positions))
      expect(Array.from(g.indices)).toEqual(Array.from(want.indices))
    }
  })
})

describe('draftGlowPoints', () => {
  it('is the draft alone with no pointer, and nothing with no draft', () => {
    const d = [pt(0, -4, 0)]
    expect(draftGlowPoints(d, null)).toEqual(d)
    expect(draftGlowPoints([], { x: 5, z: 5 })).toEqual([])
  })

  it('adds the point under the pointer at the last point’s depth, with no chamber', () => {
    const d = [pt(0, -4, 0), { ...pt(3, -6, 0), chamber: 5 }]
    expect(draftGlowPoints(d, { x: 9, z: 2 })).toEqual([...d, { x: 9, y: -6, z: 2, chamber: 0 }])
  })
})

describe('GlowThrottle', () => {
  it('builds the first key at once and nothing for an unchanged key', () => {
    const t = new GlowThrottle(30)
    expect(t.due('a', 0)).toBe(true)
    expect(t.due('a', 100)).toBe(false)
  })

  it('holds a change back until the interval has passed, then builds the latest key', () => {
    const t = new GlowThrottle(30)
    t.due('a', 1000)
    expect(t.due('b', 1010)).toBe(false)
    expect(t.due('c', 1029)).toBe(false)
    expect(t.due('c', 1030)).toBe(true)
    expect(t.due('c', 1100)).toBe(false)
  })
})
