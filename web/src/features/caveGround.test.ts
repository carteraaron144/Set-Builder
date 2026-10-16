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

  it('rounds the rim where a chamber breaks the surface, with no folded triangles', () => {
    // A 9 m chamber under the slope, at 8 m there: its roof (12 m) opens the slope.
    const points = tunnel.points.map((p, k) => (k === 1 ? { ...p, chamber: 9 } : p))
    const g = new Ground(hill(), withCave([{ ...tunnel, points }]))
    const m = g.chunkGeometry(0)
    const p = m.positions
    const ix = m.indices
    const normals: number[][] = []
    const faces = new Map<string, number[]>()
    for (let f = 0; f < ix.length; f += 3) {
      const [a, b, c] = [ix[f] * 3, ix[f + 1] * 3, ix[f + 2] * 3]
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      normals.push(n.map((x) => x / (Math.hypot(n[0], n[1], n[2]) || 1)))
      for (let e = 0; e < 3; e++) {
        const [x, y] = [ix[f + e], ix[f + ((e + 1) % 3)]]
        const key = x < y ? `${x},${y}` : `${y},${x}`
        faces.set(key, [...(faces.get(key) ?? []), f / 3])
      }
    }
    let rim = 0
    let folds = 0
    for (const [key, fs] of faces) {
      if (fs.length !== 2) continue
      const v = Number(key.split(',')[0]) * 3
      const [x, y, z] = [p[v], p[v + 1], p[v + 2]]
      if (Math.abs(Math.min(12, Math.max(0, (x + 56) * 0.8)) - y) > 0.6 || Math.abs(g.caveDistance(x, y, z)) > 0.6) continue
      rim++
      const [n1, n2] = [normals[fs[0]], normals[fs[1]]]
      if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < 0) folds++
    }
    expect(rim).toBeGreaterThan(100)
    expect(folds).toBe(0)
  })

  it("keeps an SDF chunk's faces on the heightmap edge lines, so it meets its heightmap neighbours", () => {
    // A tunnel ending just over the margin plus its radius from chunk 0's east face at x = -32, its roof 1 m under the plateau.
    const near: Cave = { ...tunnel, points: tunnel.points.map((p) => ({ ...p, x: p.x + 1.5, y: 9 })) }
    const g = new Ground(hill(), withCave([near]))
    expect(g.isSdfChunk(1)).toBe(false)
    const m = g.chunkGeometry(0)
    const h = g.layers.heights.data
    let checked = 0
    for (let k = 0; k < m.positions.length; k += 3) {
      if (m.positions[k] !== -32) continue
      const gj = (m.positions[k + 2] + half) / HEIGHT_SPACING
      const j0 = Math.min(Math.floor(gj), RES - 2)
      const i = 64
      const line = h[j0 * RES + i] + (h[(j0 + 1) * RES + i] - h[j0 * RES + i]) * (gj - j0)
      expect(Math.abs(m.positions[k + 1] - line)).toBeLessThan(1e-4)
      checked++
    }
    expect(checked).toBeGreaterThan(60)
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
