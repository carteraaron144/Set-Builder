import { describe, expect, it } from 'vitest'
import { createFlatLayers, type TerrainLayers } from '../terrain/layers'
import type { Features, Pond, Spline } from './features'
import { Ground } from './ground'
import { buildWater, WATER_MATERIAL, type WaterGeometry } from './water'

const SIZE = 64
const RES = SIZE * 2 + 1

/** Slopes down towards +x, with a 2 m deep bowl at (-16, -16). */
function terrain(): TerrainLayers {
  const l = createFlatLayers(SIZE)
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) {
      const x = -SIZE / 2 + i * 0.5
      const z = -SIZE / 2 + j * 0.5
      const r = Math.hypot(x + 16, z + 16)
      l.heights.data[j * RES + i] = r < 8 ? 2 * (r / 8) ** 2 : 2 - 0.05 * Math.max(0, x)
    }
  return l
}

const river = (id: string, z: number, width = 3): Spline => ({
  id,
  kind: 'river',
  style: 'dirt',
  width,
  points: [
    { x: -6, z },
    { x: 8, z: z + 5 },
    { x: 24, z },
  ],
})
const pond = (level = 1.5, seed = { x: -16, z: -16 }): Pond => ({ id: 'p', seed, level })
const build = (f: Features) => {
  const g = new Ground(terrain(), f)
  return { g, water: buildWater(g) }
}

const vertex = (w: WaterGeometry, v: number) => [w.positions[v * 3], w.positions[v * 3 + 1], w.positions[v * 3 + 2]]

describe('buildWater', () => {
  it('builds a pond at its effective level, covering every flooded sample', () => {
    const { g, water } = build({ splines: [], ponds: [pond()], caves: [] })
    expect(water.map((w) => w.name)).toEqual(['Pond 1'])
    const w = water[0]
    for (let v = 0; v < w.positions.length / 3; v++) expect(vertex(w, v)[1]).toBe(g.ponds[0].level)
    const covered = new Set<string>()
    for (const v of w.indices) covered.add(`${vertex(w, v)[0]},${vertex(w, v)[2]}`)
    const mask = g.ponds[0].mask
    let flooded = 0
    for (let j = 0; j < RES; j++)
      for (let i = 0; i < RES; i++) {
        if (!mask[j * RES + i]) continue
        flooded++
        expect(covered.has(`${-SIZE / 2 + i * 0.5},${-SIZE / 2 + j * 0.5}`)).toBe(true)
      }
    expect(flooded).toBeGreaterThan(100)
  })

  it('builds a river ribbon of two vertices per sample, width apart around the centreline', () => {
    const { g, water } = build({ splines: [river('r', 0)], ponds: [], caves: [] })
    const w = water[0]
    const { xs, zs } = g.profiles[0].samples
    expect(w.positions.length / 3).toBe(2 * xs.length)
    for (let k = 0; k < xs.length; k++) {
      const a = vertex(w, 2 * k)
      const b = vertex(w, 2 * k + 1)
      expect((a[0] + b[0]) / 2).toBeCloseTo(xs[k], 4)
      expect((a[2] + b[2]) / 2).toBeCloseTo(zs[k], 4)
      expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeCloseTo(3, 4)
      expect(a[1]).toBe(b[1])
      expect(a[1]).toBeCloseTo(g.profiles[0].water![k], 6)
    }
  })

  it('keeps river water non-increasing along the flow', () => {
    const { water } = build({ splines: [river('r', 0)], ponds: [], caves: [] })
    const w = water[0]
    const ys = Array.from({ length: w.positions.length / 6 }, (_, k) => vertex(w, 2 * k)[1])
    const flow = ys[ys.length - 1] <= ys[0] ? ys : ys.slice().reverse()
    for (let k = 1; k < flow.length; k++) expect(flow[k]).toBeLessThanOrEqual(flow[k - 1])
    expect(flow[0]).toBeGreaterThan(flow[flow.length - 1])
  })

  it('names rivers then ponds in feature order and skips empty ponds', () => {
    const path: Spline = { ...river('p', 10), kind: 'path' }
    const { water } = build({ splines: [river('a', 0), path, river('b', -8)], ponds: [pond(1.5, { x: 20, z: 20 })], caves: [] })
    expect(water.map((w) => w.name)).toEqual(['River 1', 'River 2'])
  })

  it('gives finite positions and upward-facing triangles', () => {
    const dup: Spline = { ...river('d', 4), points: [{ x: 0, z: 4 }, { x: 0, z: 4 }, { x: 10, z: 8 }, { x: 10, z: 8 }] }
    const { water } = build({ splines: [river('a', 0, 12), dup], ponds: [pond()], caves: [] })
    expect(water.length).toBe(3)
    for (const w of water) {
      expect(w.positions.every(Number.isFinite)).toBe(true)
      for (let t = 0; t < w.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((o) => vertex(w, w.indices[t + o]))
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
        expect(ny).toBeGreaterThan(0)
      }
    }
  })

  it('takes its material from the feature data', () => {
    expect(WATER_MATERIAL).toEqual({ name: 'water', color: '#3f7f9a', opacity: 0.75 })
  })
})
