import { describe, expect, it } from 'vitest'
import { createFlatLayers, type TerrainLayers } from '../terrain/layers'
import { brickKey, type Brick } from '../terrain/volume'
import { TerrainEditor } from '../terrain/terrainEditor'
import { DEFAULT_PALETTE } from '../terrain/palette'
import { buildSdfChunk, type CaveDistanceHolder } from './caveChunk'
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

describe('buildSdfChunk with a cave distance cache', () => {
  it('builds exactly the mesh it builds without one, cold and warm', () => {
    const { g, chunk } = setup()
    const caves = cavesReaching(g.caves, chunk, 64)
    const plain = buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE)
    const holder: CaveDistanceHolder = { cache: null }
    for (let run = 0; run < 2; run++) {
      const m = buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
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
    buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
    const cold = calls
    calls = 0
    buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
    expect(cold).toBeGreaterThan(1000)
    expect(calls).toBeLessThan(cold / 2)
  })

  it('follows the heights when they change under a warm cache', () => {
    const { ed, g, chunk } = setup()
    const caves = cavesReaching(g.caves, chunk, 64)
    const holder: CaveDistanceHolder = { cache: null }
    buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
    ed.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 8, strength: 1, falloff: 0.5 }, { x: -6, z: 0 })
    ed.dab({ x: -6, z: 0 }, 0.2, false)
    ed.endStroke()
    const warm = buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE, holder)
    const fresh = buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE)
    expect(same(warm.positions, fresh.positions)).toBe(true)
    expect(same(warm.colors, fresh.colors)).toBe(true)
  })
})

const SIZE = 64
const RES = SIZE * 2 + 1
const HALF = SIZE / 2

function filled(channel: 'a' | 'k', v: number): Brick {
  const b: Brick = { a: new Int8Array(512).fill(-64), k: new Int8Array(512).fill(-64) }
  b[channel].fill(v)
  return b
}

const noSurface = () => ({ kind: new Uint8Array(RES * RES), weight: new Uint8Array(RES * RES) })

interface Tri {
  ny: number
  verts: [number, number, number]
}

function triangles(m: { positions: Float32Array; indices: ArrayLike<number> }): Tri[] {
  const out: Tri[] = []
  const p = m.positions
  for (let f = 0; f < m.indices.length; f += 3) {
    const [a, b, c] = [m.indices[f], m.indices[f + 1], m.indices[f + 2]]
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    out.push({ ny: len > 0 ? ny / len : 0, verts: [a, b, c] })
  }
  return out
}

describe('buildSdfChunk with sculpted bricks', () => {
  /** A slab of Add one brick thick, floating 4 m over flat ground, in chunk 0. */
  function slab() {
    const layers = createFlatLayers(SIZE)
    for (let bx = 4; bx <= 6; bx++) for (let bz = 4; bz <= 6; bz++) layers.volume.put(brickKey(bx, 1, bz), filled('a', 32))
    return { layers, mesh: buildSdfChunk(layers, noSurface(), [], 0, DEFAULT_PALETTE) }
  }

  it('meshes an underside under a ledge, in the earth colour', () => {
    const { mesh } = slab()
    const tris = triangles(mesh)
    const down = tris.filter((t) => t.ny < -0.5)
    expect(down.length).toBeGreaterThan(20)
    // Vertices every one of whose triangles faces down.
    const facing = new Map<number, boolean>()
    for (const t of tris) for (const v of t.verts) facing.set(v, (facing.get(v) ?? true) && t.ny < -0.5)
    const earth = DEFAULT_PALETTE.earth.color
    let checked = 0
    for (const [v, allDown] of facing) {
      if (!allDown) continue
      checked++
      for (let c = 0; c < 3; c++) expect(mesh.colors[v * 3 + c]).toBeCloseTo(earth[c], 5)
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('colours a steep wall as rock from its true normal', () => {
    const { mesh } = slab()
    const p = mesh.positions
    const sum = new Float64Array(p.length / 3)
    const area = new Float64Array(p.length / 3)
    for (let f = 0; f < mesh.indices.length; f += 3) {
      const [a, b, c] = [mesh.indices[f], mesh.indices[f + 1], mesh.indices[f + 2]]
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
      const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
      const ny = uz * vx - ux * vz
      const len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx)
      for (const v of [a, b, c]) {
        sum[v] += ny
        area[v] += len
      }
    }
    const rock = DEFAULT_PALETTE.rock.color
    let checked = 0
    for (let v = 0; v < sum.length; v++) {
      const ny = area[v] > 0 ? sum[v] / area[v] : 1
      if (ny < 0.001 || ny > 0.3) continue // a wall steeper than 70 degrees but not an underside
      checked++
      for (let c = 0; c < 3; c++) expect(mesh.colors[v * 3 + c]).toBeCloseTo(rock[c], 5)
    }
    expect(checked).toBeGreaterThan(5)
  })

  it('keeps the ground away from bricks exactly as it was', () => {
    const { g, chunk } = setup()
    const caves = cavesReaching(g.caves, chunk, 64)
    const before = buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE)
    // A brick in the opposite chunk column and row, well clear of this chunk's footprint (chunks are 64 samples).
    const bx = chunk % 2 === 0 ? 12 : 2
    const bz = chunk < 2 ? 12 : 2
    g.layers.volume.put(brickKey(bx, 0, bz), filled('a', 32))
    const after = buildSdfChunk(g.layers, g.surface, caves, chunk, DEFAULT_PALETTE)
    expect(same(before.positions, after.positions)).toBe(true)
    expect(same(before.colors, after.colors)).toBe(true)
    expect(same(before.indices, after.indices)).toBe(true)
  })

  it('puts every vertex on a face shared with a heightmap chunk on that chunk\'s edge line', () => {
    const layers = createFlatLayers(SIZE)
    const h = (i: number, j: number) => 1.13 + Math.sin(i * 0.37) * 1.7 + Math.cos(j * 0.23) * 1.3
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) layers.heights.data[j * RES + i] = h(i, j)
    layers.volume.put(brickKey(6, 0, 6), filled('a', 32))
    const mesh = buildSdfChunk(layers, noSurface(), [], 0, DEFAULT_PALETTE)
    let checked = 0
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const x = mesh.positions[v], y = mesh.positions[v + 1], z = mesh.positions[v + 2]
      if (x !== 0 && z !== 0) continue
      checked++
      if (x === 0) {
        const gj = (z + HALF) / 0.5
        const j0 = Math.floor(gj)
        expect(Math.abs(h(64, j0) + (h(64, j0 + 1) - h(64, j0)) * (gj - j0) - y)).toBeLessThan(1e-4)
      } else {
        const gi = (x + HALF) / 0.5
        const i0 = Math.floor(gi)
        expect(Math.abs(h(i0, 64) + (h(i0 + 1, 64) - h(i0, 64)) * (gi - i0) - y)).toBeLessThan(1e-4)
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('stays closed when carved clean through the bottom of the world', () => {
    const layers: TerrainLayers = createFlatLayers(SIZE)
    layers.heights.data.fill(-31)
    for (let bx = 4; bx <= 6; bx++) for (let bz = 4; bz <= 6; bz++) layers.volume.put(brickKey(bx, -8, bz), filled('k', 32))
    const mesh = buildSdfChunk(layers, noSurface(), [], 0, DEFAULT_PALETTE)
    expect(mesh.indices.length).toBeGreaterThan(0)
    const uses = new Map<string, number>()
    for (let f = 0; f < mesh.indices.length; f += 3)
      for (let e = 0; e < 3; e++) {
        const a = mesh.indices[f + e]
        const b = mesh.indices[f + ((e + 1) % 3)]
        const k = a < b ? `${a},${b}` : `${b},${a}`
        uses.set(k, (uses.get(k) ?? 0) + 1)
      }
    const onBoundary = (v: number) => {
      const x = mesh.positions[v * 3], z = mesh.positions[v * 3 + 2]
      return [x === -HALF || x === 0 ? 'x' : '', z === -HALF || z === 0 ? 'z' : ''].join('')
    }
    for (const [k, n] of uses) {
      if (n === 2) continue
      const [a, b] = k.split(',').map(Number)
      const shared = [...onBoundary(a)].some((c) => onBoundary(b).includes(c))
      expect(n === 1 && shared, `edge ${k} used ${n} times`).toBe(true)
    }
  })

  it('meshes a 200-brick chunk quickly', () => {
    const layers = createFlatLayers(256)
    let n = 0
    for (let bx = 4; bx < 18 && n < 200; bx++) for (let bz = 4; bz < 18 && n < 200; bz++, n++) layers.volume.put(brickKey(bx, 1, bz), filled('a', 32))
    const surface = { kind: new Uint8Array(513 * 513), weight: new Uint8Array(513 * 513) }
    buildSdfChunk(layers, surface, [], 0, DEFAULT_PALETTE)
    const t0 = performance.now()
    buildSdfChunk(layers, surface, [], 0, DEFAULT_PALETTE)
    const ms = performance.now() - t0
    console.log(`buildSdfChunk, 200 bricks, 256 m scene: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(100)
  })
})
