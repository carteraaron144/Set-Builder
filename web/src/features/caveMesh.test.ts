import { describe, expect, it } from 'vitest'
import { TerrainEditor } from '../terrain/terrainEditor'
import { createFlatLayers } from '../terrain/layers'
import { DEFAULT_PALETTE } from '../terrain/palette'
import { emptyFeatures, type Features } from './features'
import { caveMeshRequest, meshChunks } from './caveMesh'
import { brickKey } from '../terrain/volume'

const features: Features = {
  ...emptyFeatures(),
  caves: [{ id: 'c', radius: 3, points: [-20, -6, 8, 22].map((x, i) => ({ x, y: -2 - i, z: i, chamber: i === 1 ? 5 : 0 })) }],
}

function ground() {
  const ed = new TerrainEditor(createFlatLayers(64), 7, features, () => {})
  // Sculpt so the carved heights differ from a fresh flat layer.
  ed.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 10, strength: 1, falloff: 0.5 }, { x: 0, z: 0 })
  ed.dab({ x: 0, z: 0 }, 0.1, false)
  ed.endStroke()
  return ed.ground
}

describe('meshChunks', () => {
  it('matches the ground’s own mesh for chunks caves reach and chunks they do not', () => {
    const g = ground()
    const chunks = [0, 1, 2, 3]
    const res = meshChunks(caveMeshRequest(1, g, chunks))
    expect(res.id).toBe(1)
    expect(res.results.map((r) => r.chunk)).toEqual(chunks)
    expect(res.results.some((r) => r.sdf)).toBe(true)
    for (const r of res.results) {
      const want = g.chunkGeometry(r.chunk, DEFAULT_PALETTE)
      expect(r.sdf).toBe(g.isSdfChunk(r.chunk))
      expect(Array.from(r.geometry.positions)).toEqual(Array.from(want.positions))
      expect(Array.from(r.geometry.colors)).toEqual(Array.from(want.colors))
      expect(Array.from(r.geometry.indices)).toEqual(Array.from(want.indices))
    }
  })

  it('meshes chunks that bricks reach exactly as the ground does, from copies of the bricks', () => {
    const layers = createFlatLayers(64)
    const ed = new TerrainEditor(layers, 7, emptyFeatures(), () => {})
    const brick = { a: new Int8Array(512).fill(32), k: new Int8Array(512).fill(-64) }
    layers.volume.put(brickKey(14, 1, 14), brick)
    layers.volume.put(brickKey(13, 1, 14), { a: brick.a.slice(), k: brick.k.slice() })
    const g = ed.ground
    g.refreshVolume()
    const req = caveMeshRequest(1, g, [0, 1, 2, 3])
    expect(req.bricks).toHaveLength(2)
    expect(req.bricks.every((b) => b.a !== brick.a)).toBe(true)
    const res = meshChunks(req)
    expect(res.results.find((r) => r.chunk === 3)!.sdf).toBe(true)
    for (const r of res.results) {
      const want = g.chunkGeometry(r.chunk, DEFAULT_PALETTE)
      expect(r.sdf).toBe(g.isSdfChunk(r.chunk))
      expect(Array.from(r.geometry.positions)).toEqual(Array.from(want.positions))
      expect(Array.from(r.geometry.colors)).toEqual(Array.from(want.colors))
    }
  })

  it('does not alias the live ground, so the request can be posted while the ground keeps changing', () => {
    const g = ground()
    const req = caveMeshRequest(1, g, [0])
    expect(req.heights).not.toBe(g.layers.heights.data)
    expect(req.heights).toEqual(g.layers.heights.data)
  })
})

describe('meshChunks caching across requests', () => {
  it('stays equal to the ground’s mesh as heights and caves change between requests', () => {
    const ed = new TerrainEditor(createFlatLayers(64), 7, features, () => {})
    const g = ed.ground
    const check = () => {
      for (const r of meshChunks(caveMeshRequest(1, g, [0, 1, 2, 3])).results) {
        const want = g.chunkGeometry(r.chunk, DEFAULT_PALETTE)
        expect(Array.from(r.geometry.positions)).toEqual(Array.from(want.positions))
        expect(Array.from(r.geometry.colors)).toEqual(Array.from(want.colors))
      }
    }
    check()
    check()
    ed.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 8, strength: 1, falloff: 0.5 }, { x: -6, z: 0 })
    ed.dab({ x: -6, z: 0 }, 0.2, false)
    ed.endStroke()
    check()
    const moved = structuredClone(features)
    moved.caves[0].points[1].y += 3
    ed.commitFeatures(moved)
    check()
  })
})
