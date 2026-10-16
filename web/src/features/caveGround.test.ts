import { describe, expect, it } from 'vitest'
import { buildChunkGeometry, chunkCount } from '../terrain/chunks'
import { createFlatLayers, HEIGHT_SPACING, type TerrainLayers } from '../terrain/layers'
import { DEFAULT_PALETTE, hexToLinear } from '../terrain/palette'
import { TerrainEditor } from '../terrain/terrainEditor'
import { FEATURES, type Cave, type Features } from './features'
import { Ground } from './ground'

const SIZE = 128
const RES = SIZE * 2 + 1
const half = SIZE / 2
const wx = (i: number) => -half + i * HEIGHT_SPACING

/** A hill rising 0.8 m per metre east from x = -56 to a 12 m plateau, inside chunk 0 (x, z in [-64, -32]). */
function hill(): TerrainLayers {
  const l = createFlatLayers(SIZE)
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) l.heights.data[j * RES + i] = Math.min(12, Math.max(0, (wx(i) + 56) * 0.8))
  return l
}

/** A level tunnel driven east into the hill at y = 3, its mouth on the slope near x = -52. */
const tunnel: Cave = {
  id: 'c',
  radius: 2,
  points: [
    { x: -53, y: 3, z: -48, chamber: 0 },
    { x: -46, y: 3, z: -48, chamber: 0 },
    { x: -39, y: 3, z: -48, chamber: 0 },
  ],
}

const withCave = (caves: Cave[] = [tunnel]): Features => ({ splines: [], ponds: [], caves })

const near = (a: ArrayLike<number>, b: ArrayLike<number>, k: number, l: number) =>
  Math.abs(a[k] - b[l]) + Math.abs(a[k + 1] - b[l + 1]) + Math.abs(a[k + 2] - b[l + 2])

describe('Ground with caves', () => {
  it('meshes every chunk from the heightmap when there are no caves', () => {
    const l = hill()
    const g = new Ground(l, withCave([]))
    for (let c = 0; c < chunkCount(SIZE) ** 2; c++) {
      expect(g.isSdfChunk(c)).toBe(false)
      expect(g.chunkGeometry(c)).toEqual(buildChunkGeometry(g.layers, c, DEFAULT_PALETTE, g.surface))
    }
  })

  it('makes SDF chunks of exactly the chunks the footprint meets', () => {
    const g = new Ground(hill(), withCave())
    const sdf = Array.from({ length: chunkCount(SIZE) ** 2 }, (_, c) => c).filter((c) => g.isSdfChunk(c))
    expect(sdf).toEqual([0])
  })

  it('hollows a tunnel with rock walls and a moss floor', () => {
    const g = new Ground(hill(), withCave())
    const m = g.chunkGeometry(0)
    const rock = hexToLinear(FEATURES.cave.rockColor)
    const moss = hexToLinear(FEATURES.cave.floorColor)
    let walls = 0
    let floors = 0
    for (let k = 0; k < m.positions.length; k += 3) {
      const [x, y, z] = [m.positions[k], m.positions[k + 1], m.positions[k + 2]]
      if (x < -47 || x > -42 || Math.abs(z + 48) > 2.5 || y > 5.5) continue
      // Deep inside the hill: every vertex here is the cave's.
      const c = [m.colors[k], m.colors[k + 1], m.colors[k + 2]]
      if (near(c, rock, 0, 0) < 1e-5) walls++
      else if (near(c, moss, 0, 0) < 1e-5) {
        floors++
        expect(y).toBeLessThan(3 - FEATURES.cave.floorRatio * 2 + 0.3)
      } else throw new Error(`unexpected colour at ${x}, ${y}, ${z}`)
    }
    expect(walls).toBeGreaterThan(20)
    expect(floors).toBeGreaterThan(20)
  })

  it('colours terrain lattice vertices of an SDF chunk as the heightmap chunk would', () => {
    const g = new Ground(hill(), withCave())
    const m = g.chunkGeometry(0)
    const ref = buildChunkGeometry(g.layers, 0, DEFAULT_PALETTE, g.surface)
    let checked = 0
    for (let k = 0; k < m.positions.length; k += 3) {
      const gi = (m.positions[k] + half) / HEIGHT_SPACING
      const gj = (m.positions[k + 2] + half) / HEIGHT_SPACING
      if (!Number.isInteger(gi) || !Number.isInteger(gj) || Math.abs(m.positions[k + 2] + 48) < 6) continue
      const r = (gj * 65 + gi) * 3
      expect(near(m.positions, ref.positions, k, r)).toBeLessThan(1e-6)
      expect(near(m.colors, ref.colors, k, r)).toBeLessThan(1e-6)
      checked++
    }
    expect(checked).toBeGreaterThan(2500)
  })

  it('clears scatter at the mouth but not on the hill above the tunnel', () => {
    const g = new Ground(hill(), withCave())
    const ex = g.exclusion!
    const at = (x: number, z: number) => ex[(z + half) * (SIZE + 1) + (x + half)]
    expect(at(-52, -48)).toBe(1)
    expect(at(-44, -48)).toBe(0)
    expect(at(-30, 0)).toBe(0)
  })

  it('gives density from both the ground and the cave', () => {
    const g = new Ground(hill(), withCave())
    expect(g.density(-44, 3, -48)).toBeLessThan(0) // in the tunnel
    expect(g.density(-44, 7, -48)).toBeGreaterThan(0) // in the hill above it
    expect(g.density(-60, 1, 0)).toBeLessThan(0) // in the air over flat ground west of the hill
    expect(g.density(-60, -1, 0)).toBeGreaterThan(0)
  })
})

describe('TerrainEditor with caves', () => {
  it('dirties the cave chunk on commit and restores the heightmap chunk on undo', () => {
    const t = new TerrainEditor(hill(), 1, withCave([]), () => {})
    t.takeDirtyChunks('mesh')
    const flat = t.ground.chunkGeometry(0)
    t.commitFeatures(withCave())
    expect(t.takeDirtyChunks('mesh')).toContain(0)
    expect(t.ground.isSdfChunk(0)).toBe(true)
    t.undo()
    expect(t.takeDirtyChunks('mesh')).toContain(0)
    expect(t.ground.isSdfChunk(0)).toBe(false)
    expect(t.ground.chunkGeometry(0)).toEqual(flat)
    t.redo()
    expect(t.ground.isSdfChunk(0)).toBe(true)
  })

  it('re-meshes an SDF chunk when the hill under it is sculpted', () => {
    const t = new TerrainEditor(hill(), 1, withCave(), () => {})
    t.takeDirtyChunks('mesh')
    t.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 3, strength: 1, falloff: 0.5 }, null)
    t.dab({ x: -44, z: -48 }, 0.2, false)
    t.endStroke()
    expect(t.takeDirtyChunks('mesh')).toContain(0)
  })
})
