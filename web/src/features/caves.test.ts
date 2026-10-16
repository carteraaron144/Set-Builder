import { describe, expect, it } from 'vitest'
import { createFlatLayers } from '../terrain/layers'
import { profileCave, sampleCave, smoothMin } from './caves'
import { FEATURES, type Cave } from './features'

const heights = createFlatLayers(64).heights
const { floorRatio, blend, margin } = FEATURES.cave

const tunnel = (overrides: Partial<Cave> = {}): Cave => ({
  id: 'c',
  radius: 2,
  points: [
    { x: -12, y: 1, z: -4, chamber: 0 },
    { x: 0, y: -1, z: 3, chamber: 0 },
    { x: 10, y: -3, z: 0, chamber: 0 },
  ],
  ...overrides,
})

describe('sampleCave', () => {
  it('passes through every control point, about every metre', () => {
    const c = tunnel()
    const sm = sampleCave(c.points)
    for (const p of c.points) {
      const hit = Array.from(sm.xs).some((x, i) => x === p.x && sm.ys[i] === p.y && sm.zs[i] === p.z)
      expect(hit).toBe(true)
    }
    for (let i = 1; i < sm.xs.length; i++) {
      const d = Math.hypot(sm.xs[i] - sm.xs[i - 1], sm.ys[i] - sm.ys[i - 1], sm.zs[i] - sm.zs[i - 1])
      expect(d).toBeLessThan(1.6)
    }
  })
})

describe('smoothMin', () => {
  it('equals min far apart and never dips more than k/4 below it', () => {
    expect(smoothMin(1, 5, 1)).toBe(1)
    for (const [a, b] of [[0, 0], [0.3, 0], [-1, -0.8]]) {
      const m = smoothMin(a, b, blend)
      expect(m).toBeLessThanOrEqual(Math.min(a, b))
      expect(m).toBeGreaterThanOrEqual(Math.min(a, b) - blend / 4 - 1e-12)
    }
  })
})

describe('profileCave', () => {
  it('is negative on the centreline, about zero at the radius and positive below the floor', () => {
    const p = profileCave(heights, tunnel())
    expect(p.sdf(0, -1, 3)).toBeCloseTo(-floorRatio * 2, 5) // the floor is the nearest wall
    expect(Math.abs(p.sdf(0, 1, 3))).toBeLessThan(0.15) // straight up from a control point, one radius away
    // A level tunnel has a level floor.
    const level = profileCave(heights, tunnel({ points: tunnel().points.map((q) => ({ ...q, y: -1 })) }))
    const floor = -1 - floorRatio * 2
    expect(level.sdf(0, floor + 0.1, 3)).toBeLessThan(0)
    expect(level.sdf(0, floor - 0.1, 3)).toBeGreaterThan(0)
  })

  it('hollows a chamber around a chamber point', () => {
    const plain = profileCave(heights, tunnel())
    const points = tunnel().points.map((q, i) => (i === 1 ? { ...q, chamber: 6 } : q))
    const chambered = profileCave(heights, tunnel({ points }))
    expect(plain.sdf(0, 2, 3)).toBeGreaterThan(0)
    expect(chambered.sdf(0, 2, 3)).toBeLessThan(-2)
    expect(chambered.sdf(0, -1 - floorRatio * 6 - 0.2, 3)).toBeGreaterThan(0) // the chamber has a flat floor too
  })

  it('has a footprint covering every sample within the margin of the cave', () => {
    const p = profileCave(heights, tunnel())
    const fp = p.footprint!
    const res = heights.resolution
    for (let j = 0; j < res; j += 2)
      for (let i = 0; i < res; i += 2) {
        if (i >= fp.x0 && i <= fp.x1 && j >= fp.z0 && j <= fp.z1) continue
        const x = -32 + i * 0.5
        const z = -32 + j * 0.5
        for (const y of [-6, -3, -1, 1, 3]) expect(p.sdf(x, y, z)).toBeGreaterThanOrEqual(margin)
      }
  })

  it('reports world bounds from the floor to the roof', () => {
    const p = profileCave(heights, tunnel())
    expect(p.bounds.y0).toBeCloseTo(-3 - floorRatio * 2, 5)
    expect(p.bounds.y1).toBeCloseTo(1 + 2, 1)
  })

  it('is deterministic', () => {
    const a = profileCave(heights, tunnel())
    const b = profileCave(heights, structuredClone(tunnel()))
    for (const [x, y, z] of [[0, 0, 0], [3.3, -1.2, 1.7], [-11, 1, -4]]) expect(a.sdf(x, y, z)).toBe(b.sdf(x, y, z))
  })
})
