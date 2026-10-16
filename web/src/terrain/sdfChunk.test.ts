import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE } from './chunks'
import { HEIGHT_SPACING } from './layers'
import { meshSdfChunk, type SdfMesh } from './sdfChunk'

const SIZE = 64
const RES = SIZE * 2 + 1
const half = SIZE / 2
const wx = (i: number) => -half + i * HEIGHT_SPACING

/** Bumpy heights that never sit on the 0.5 m y grid. */
const h = (i: number, j: number) => 1.13 + Math.sin(i * 0.37) * 1.7 + Math.cos(j * 0.23) * 1.3 + ((i * 7 + j * 3) % 5) * 0.011

const terrainOnly = (i: number, j: number, y: number) => h(i, j) - y

/** The terrain with a ball of air at (0, 1, -16): straddles chunks 0 and 1 (x = 0 is their shared face). */
const ball = (x: number, y: number, z: number) => Math.hypot(x, y - 1, z + 16) - 4
const withHole = (i: number, j: number, y: number) => Math.min(h(i, j) - y, ball(wx(i), y, wx(j)))

const Y0 = -6
const Y1 = 6

function vertices(m: SdfMesh) {
  const out: [number, number, number][] = []
  for (let v = 0; v < m.positions.length; v += 3) out.push([m.positions[v], m.positions[v + 1], m.positions[v + 2]])
  return out
}

/** How far y is from the heightmap's straight edge between two lattice samples, a fraction f along it. */
const onEdgeLine = (i0: number, j0: number, i1: number, j1: number, f: number, y: number) =>
  Math.abs(h(i0, j0) + (h(i1, j1) - h(i0, j0)) * f - y)

describe('meshSdfChunk', () => {
  it('puts every chunk-face vertex of a terrain-only field on the heightmap edge line', () => {
    const m = meshSdfChunk(SIZE, 0, terrainOnly, Y0, Y1)
    const x0 = -half
    const x1 = -half + CHUNK_SIZE
    let checked = 0
    for (const [x, y, z] of vertices(m)) {
      const onX = x === x0 || x === x1
      const onZ = z === x0 || z === x1
      if (!onX && !onZ) continue
      checked++
      if (onX) {
        const i = Math.round((x + half) / HEIGHT_SPACING)
        const gj = (z + half) / HEIGHT_SPACING
        const j0 = Math.min(Math.floor(gj), RES - 2)
        expect(onEdgeLine(i, j0, i, j0 + 1, gj - j0, y)).toBeLessThan(1e-5)
      } else {
        const j = Math.round((z + half) / HEIGHT_SPACING)
        const gi = (x + half) / HEIGHT_SPACING
        const i0 = Math.min(Math.floor(gi), RES - 2)
        expect(onEdgeLine(i0, j, i0 + 1, j, gi - i0, y)).toBeLessThan(1e-5)
      }
    }
    expect(checked).toBeGreaterThan(200)
  })

  it('puts vertices on vertical lattice edges exactly at the height', () => {
    const m = meshSdfChunk(SIZE, 0, terrainOnly, Y0, Y1)
    let checked = 0
    for (const [x, y, z] of vertices(m)) {
      const gi = (x + half) / HEIGHT_SPACING
      const gj = (z + half) / HEIGHT_SPACING
      if (!Number.isInteger(gi) || !Number.isInteger(gj)) continue
      checked++
      expect(y).toBe(Math.fround(h(gi, gj)))
    }
    expect(checked).toBe(65 * 65)
  })

  it('is closed inside the chunk', () => {
    const m = meshSdfChunk(SIZE, 0, withHole, Y0, Y1)
    const p = m.positions
    const edges = new Map<string, number>()
    const x0 = -half
    const x1 = -half + CHUNK_SIZE
    const onBoundary = (a: number) => p[a * 3] === x0 || p[a * 3] === x1 || p[a * 3 + 2] === x0 || p[a * 3 + 2] === x1
    for (let t = 0; t < m.indices.length; t += 3) {
      const tri = [m.indices[t], m.indices[t + 1], m.indices[t + 2]]
      for (let e = 0; e < 3; e++) {
        const a = tri[e]
        const b = tri[(e + 1) % 3]
        if (onBoundary(a) && onBoundary(b)) continue
        const key = a < b ? `${a},${b}` : `${b},${a}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    for (const count of edges.values()) expect(count).toBe(2)
  })

  it('winds triangles outward, towards air', () => {
    // A solid ball floating in air, inside chunk 0.
    const solid = (i: number, j: number, y: number) => 4 - Math.hypot(wx(i) + 16, y, wx(j) + 16)
    const m = meshSdfChunk(SIZE, 0, solid, Y0, Y1)
    const p = m.positions
    expect(m.indices.length).toBeGreaterThan(300)
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3]
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const out = [(p[a] + p[b] + p[c]) / 3 + 16, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3 + 16]
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(-1e-9) // slivers round either way
    }
  })

  it('gives two neighbouring chunks the same vertices on their shared face', () => {
    const face = (m: SdfMesh) =>
      vertices(m)
        .filter(([x]) => x === 0)
        .map((v) => v.join(','))
        .sort()
    const a = face(meshSdfChunk(SIZE, 0, withHole, Y0, Y1))
    const b = face(meshSdfChunk(SIZE, 1, withHole, -4, Y1 + 2))
    expect(a.length).toBeGreaterThan(100)
    expect(b).toEqual(a)
  })

  it('records the lattice edge and position along it for every vertex', () => {
    const m = meshSdfChunk(SIZE, 0, terrainOnly, Y0, Y1)
    for (let v = 0; v < m.t.length; v += 97) {
      const a = m.edgeA[v]
      const b = m.edgeB[v]
      const x = wx(a % RES) + (wx(b % RES) - wx(a % RES)) * m.t[v]
      const z = wx(Math.floor(a / RES)) + (wx(Math.floor(b / RES)) - wx(Math.floor(a / RES))) * m.t[v]
      expect(x).toBeCloseTo(m.positions[v * 3], 4)
      expect(z).toBeCloseTo(m.positions[v * 3 + 2], 4)
    }
  })
})
