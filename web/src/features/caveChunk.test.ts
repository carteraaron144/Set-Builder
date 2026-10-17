import { describe, expect, it } from 'vitest'
import { createFlatLayers } from '../terrain/layers'
import { TerrainEditor } from '../terrain/terrainEditor'
import { DEFAULT_PALETTE } from '../terrain/palette'
import { buildCaveChunk, type CaveDistanceHolder } from './caveChunk'
import { cavesReaching } from './caves'
import { emptyFeatures, type Features } from './features'

const features: Features = {
  ...emptyFeatures(),
  caves: [{ id: 'c', radius: 3, points: [-20, -6, 8, 22].map((x, i) => ({ x, y: -2 - i, z: i, chamber: i === 1 ? 5 : 0 })) }],
}

function setup() {
  const ed = new TerrainEditor(createFlatLayers(64), 7, features, () => {})
  const g = ed.ground
  const chunk = [0, 1, 2, 3].find((c) => g.isSdfChunk(c))!
  return { ed, g, chunk }
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v, i) => v === b[i])

describe('buildCaveChunk with a cave distance cache', () => {
  it('builds exactly the mesh it builds without one, cold and warm', () => {
    const { g, chunk } = setup()
    const caves = cavesReaching(g.caves, chunk, 64)
    const plain = buildCaveChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE)
    const holder: CaveDistanceHolder = { cache: null }
    for (let run = 0; run < 2; run++) {
      const m = buildCaveChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
      expect(same(m.positions, plain.positions)).toBe(true)
      expect(same(m.colors, plain.colors)).toBe(true)
      expect(same(m.indices, plain.indices)).toBe(true)
    }
  })

  it('does not evaluate the caves again for a warm cache', () => {
    const { g, chunk } = setup()
    let calls = 0
    const caves = cavesReaching(g.caves, chunk, 64).map((p) => ({ ...p, sdf: (x: number, y: number, z: number) => (calls++, p.sdf(x, y, z)) }))
    const holder: CaveDistanceHolder = { cache: null }
    buildCaveChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
    const cold = calls
    calls = 0
    buildCaveChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
    expect(cold).toBeGreaterThan(1000)
    expect(calls).toBeLessThan(cold / 2)
  })

  it('follows the heights when they change under a warm cache', () => {
    const { ed, g, chunk } = setup()
    const caves = cavesReaching(g.caves, chunk, 64)
    const holder: CaveDistanceHolder = { cache: null }
    buildCaveChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
    ed.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 8, strength: 1, falloff: 0.5 }, { x: -6, z: 0 })
    ed.dab({ x: -6, z: 0 }, 0.2, false)
    ed.endStroke()
    const warm = buildCaveChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
    const fresh = buildCaveChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE)
    expect(same(warm.positions, fresh.positions)).toBe(true)
    expect(same(warm.colors, fresh.colors)).toBe(true)
  })
})
