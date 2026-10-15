import { describe, expect, it } from 'vitest'
import { sculpt } from './brush'
import {
  buildChunkGeometry,
  CHUNK_VERTS,
  chunkCount,
  chunksForBiomeRect,
  chunksForHeightRect,
  updateChunkGeometry,
} from './chunks'
import { biomeWeightsAt, createFlatLayers, quantizeWeights, type TerrainLayers } from './layers'
import { DEFAULT_PALETTE, type RGB } from './palette'

const vertex = (positions: Float32Array, vi: number, vj: number) => {
  const k = (vj * CHUNK_VERTS + vi) * 3
  return [positions[k], positions[k + 1], positions[k + 2]]
}
const colour = (colors: Float32Array, vi: number, vj: number) => {
  const k = (vj * CHUNK_VERTS + vi) * 3
  return [colors[k], colors[k + 1], colors[k + 2]]
}
const expectRGB = (actual: number[], expected: RGB) => expected.forEach((c, i) => expect(actual[i]).toBeCloseTo(c, 6))

function roughen(l: TerrainLayers) {
  for (let n = 0; n < 40; n++) {
    sculpt(l.heights, n % 2 ? 'raise' : 'noise', { radius: 6, strength: 1, falloff: 0.5 },
      { x: (n * 37) % 256 - 128, z: (n * 53) % 256 - 128, dt: 0.5, invert: n % 3 === 0 }, { flattenTo: 0, seed: 3 })
  }
}

describe('chunk layout', () => {
  it('counts 32 m chunks per axis', () => {
    expect(chunkCount(256)).toBe(8)
    expect(chunkCount(64)).toBe(2)
  })

  it('maps height rects to chunks, including both sides of a shared edge', () => {
    expect(chunksForHeightRect({ x0: 60, z0: 60, x1: 64, z1: 64 }, 64)).toEqual([0, 1, 2, 3])
    expect(chunksForHeightRect({ x0: 10, z0: 10, x1: 20, z1: 20 }, 64)).toEqual([0])
    expect(chunksForHeightRect({ x0: 0, z0: 0, x1: 128, z1: 128 }, 64)).toEqual([0, 1, 2, 3])
    expect(chunksForHeightRect({ x0: 70, z0: 10, x1: 80, z1: 20 }, 64)).toEqual([1])
  })

  it('maps biome rects to chunks', () => {
    expect(chunksForBiomeRect({ x0: 5, z0: 5, x1: 10, z1: 10 }, 64)).toEqual([0])
    expect(chunksForBiomeRect({ x0: 31, z0: 5, x1: 33, z1: 6 }, 64)).toEqual([0, 1])
  })
})

describe('chunk geometry', () => {
  it('builds a 65 × 65 grid at 0.5 m spacing', () => {
    const g = buildChunkGeometry(createFlatLayers(256), 0, DEFAULT_PALETTE)
    expect(g.positions).toHaveLength(4225 * 3)
    expect(g.colors).toHaveLength(4225 * 3)
    expect(g.indices).toHaveLength(24576)
    expect(vertex(g.positions, 0, 0)).toEqual([-128, 0, -128])
    expect(vertex(g.positions, 64, 64)).toEqual([-96, 0, -96])
  })

  it('takes y from the heightmap and matches neighbours along shared edges', () => {
    const l = createFlatLayers(256)
    roughen(l)
    const c0 = buildChunkGeometry(l, 0, DEFAULT_PALETTE)
    const right = buildChunkGeometry(l, 1, DEFAULT_PALETTE)
    const below = buildChunkGeometry(l, 8, DEFAULT_PALETTE)
    for (let v = 0; v < CHUNK_VERTS; v++) {
      expect(vertex(c0.positions, 64, v)).toEqual(vertex(right.positions, 0, v))
      expect(vertex(c0.positions, v, 64)).toEqual(vertex(below.positions, v, 0))
      expect(vertex(c0.positions, v, 7)[1]).toBe(l.heights.data[7 * 513 + v])
    }
  })

  it('colours flat meadow with the meadow colour', () => {
    const g = buildChunkGeometry(createFlatLayers(64), 3, DEFAULT_PALETTE)
    expectRGB(colour(g.colors, 0, 0), DEFAULT_PALETTE.biomes[0])
    expectRGB(colour(g.colors, 33, 50), DEFAULT_PALETTE.biomes[0])
  })

  it('blends biome colours by weight', () => {
    const l = createFlatLayers(64)
    // Biome sample (4, 6) is world (-28, -26): height vertex (8, 12) of chunk 0.
    l.biomes.data.set([128, 127, 0, 0], (6 * 65 + 4) * 4)
    const g = buildChunkGeometry(l, 0, DEFAULT_PALETTE)
    const [m, f] = DEFAULT_PALETTE.biomes
    expectRGB(colour(g.colors, 8, 12), [0, 1, 2].map((c) => (128 * m[c] + 127 * f[c]) / 255) as RGB)
  })

  it('colours steep faces as rock and gentle ones as biome', () => {
    const ramp = (deg: number) => {
      const l = createFlatLayers(64)
      const t = Math.tan((deg * Math.PI) / 180)
      for (let j = 0; j < 129; j++) for (let i = 0; i < 129; i++) l.heights.data[j * 129 + i] = (i - 64) * 0.5 * t
      return buildChunkGeometry(l, 0, DEFAULT_PALETTE)
    }
    expectRGB(colour(ramp(60).colors, 32, 32), DEFAULT_PALETTE.rock)
    expectRGB(colour(ramp(20).colors, 32, 32), DEFAULT_PALETTE.biomes[0])
  })

  it('updates in place to match a fresh build', () => {
    const l = createFlatLayers(128)
    const g = buildChunkGeometry(l, 5, DEFAULT_PALETTE)
    const { positions, colors, indices } = g
    roughen(l)
    l.biomes.data.fill(0).forEach((_, i, a) => {
      if (i % 4 === 2) a[i] = 255
    })
    updateChunkGeometry(l, 5, DEFAULT_PALETTE, g)
    const fresh = buildChunkGeometry(l, 5, DEFAULT_PALETTE)
    expect(g.positions).toBe(positions)
    expect(g.colors).toBe(colors)
    expect(g.indices).toBe(indices)
    expect([...g.positions]).toEqual([...fresh.positions])
    expect([...g.colors]).toEqual([...fresh.colors])
  })

  it('blends biomes bilinearly at every vertex, including the ones between biome samples', () => {
    const l = createFlatLayers(64)
    let seed = 5
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let o = 0; o < l.biomes.data.length; o += 4) {
      const w = [rand(), rand(), rand(), rand()]
      const sum = w.reduce((a, c) => a + c, 0)
      quantizeWeights(w.map((v) => v / sum), l.biomes.data, o)
    }
    for (const chunk of [0, 3]) {
      const g = buildChunkGeometry(l, chunk, DEFAULT_PALETTE)
      for (let k = 0; k < CHUNK_VERTS * CHUNK_VERTS; k++) {
        const w = biomeWeightsAt(l.biomes, g.positions[k * 3], g.positions[k * 3 + 2])
        const expected = [0, 1, 2].map((c) => w.reduce((a, wi, b) => a + wi * DEFAULT_PALETTE.biomes[b][c], 0))
        for (let c = 0; c < 3; c++) expect(g.colors[k * 3 + c]).toBeCloseTo(expected[c], 5)
      }
    }
  })
})
