import { describe, expect, it } from 'vitest'
import type { Spline, SplinePoint } from './features'
import { nearestOnSamples, sampleSpline, snapToEnd, splineBounds } from './spline'

const curved: SplinePoint[] = [
  { x: -20, z: 0 },
  { x: -5, z: 12 },
  { x: 8, z: -6 },
  { x: 22, z: 4 },
]

const spline = (id: string, kind: Spline['kind'], points: SplinePoint[]): Spline => ({ id, kind, style: 'dirt', width: 2, points })

const allFinite = (a: Float32Array) => a.every(Number.isFinite)

describe('sampleSpline', () => {
  it('passes through every control point', () => {
    const sm = sampleSpline(curved)
    for (const p of curved) {
      const hit = Array.from(sm.xs).some((x, i) => Math.abs(x - p.x) < 1e-4 && Math.abs(sm.zs[i] - p.z) < 1e-4)
      expect(hit).toBe(true)
    }
  })

  it('spaces samples 0.5 m apart along the curve', () => {
    const sm = sampleSpline(curved)
    for (let i = 1; i < sm.xs.length; i++) {
      const d = Math.hypot(sm.xs[i] - sm.xs[i - 1], sm.zs[i] - sm.zs[i - 1])
      expect(d).toBeGreaterThan(0.45)
      expect(d).toBeLessThan(0.55)
    }
  })

  it('records arc length, ending at the total length', () => {
    const sm = sampleSpline(curved)
    expect(sm.s[0]).toBe(0)
    for (let i = 1; i < sm.s.length; i++) expect(sm.s[i]).toBeGreaterThan(sm.s[i - 1])
    expect(sm.s[sm.s.length - 1]).toBeCloseTo(sm.length, 4)
  })

  it('samples a straight 10 m spline as 21 points', () => {
    const sm = sampleSpline([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ])
    expect(sm.xs.length).toBe(21)
    expect(sm.length).toBeCloseTo(10, 4)
    expect(sm.zs.every((z) => Math.abs(z) < 1e-6)).toBe(true)
  })

  it('stays finite with duplicate points', () => {
    const sm = sampleSpline([
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 5, z: 5 },
      { x: 5, z: 5 },
      { x: 9, z: 0 },
    ])
    expect(allFinite(sm.xs) && allFinite(sm.zs) && allFinite(sm.s)).toBe(true)
    expect(sm.length).toBeGreaterThan(0)
  })

  it('samples a 200-point zigzag finitely, through every point', () => {
    const zigzag = Array.from({ length: 200 }, (_, i) => ({ x: -32 + i * 0.32, z: i % 2 ? 1 : -1 }))
    const sm = sampleSpline(zigzag)
    expect(allFinite(sm.xs) && allFinite(sm.zs) && allFinite(sm.s)).toBe(true)
    expect(sm.xs.length).toBeGreaterThanOrEqual(200)
  })

  it('gives one finite sample for a spline whose points are all equal', () => {
    const sm = sampleSpline([
      { x: 3, z: -2 },
      { x: 3, z: -2 },
    ])
    expect(Array.from(sm.xs)).toEqual([3])
    expect(Array.from(sm.zs)).toEqual([-2])
    expect(sm.length).toBe(0)
  })
})

describe('nearestOnSamples', () => {
  it('finds a point on the curve at distance 0', () => {
    const sm = sampleSpline(curved)
    const n = nearestOnSamples(sm, sm.xs[30], sm.zs[30])
    expect(n.index).toBe(30)
    expect(n.distance).toBeCloseTo(0, 5)
    expect(n.s).toBeCloseTo(sm.s[30], 4)
  })

  it('measures the distance to a straight spline', () => {
    const sm = sampleSpline([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ])
    const n = nearestOnSamples(sm, 4.2, 3)
    expect(n.distance).toBeCloseTo(3, 5)
    expect(n.s).toBeCloseTo(4.2, 4)
  })
})

describe('snapToEnd', () => {
  const road = spline('a', 'path', [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ])
  const river = spline('r', 'river', [
    { x: 20, z: 20 },
    { x: 30, z: 20 },
  ])

  it('snaps onto a same-kind spline end within 2 m', () => {
    expect(snapToEnd({ x: 11.2, z: 1 }, [road, river], 'path')).toEqual({ x: 10, z: 0 })
  })

  it('leaves points farther than 2 m alone', () => {
    expect(snapToEnd({ x: 12.5, z: 0 }, [road], 'path')).toEqual({ x: 12.5, z: 0 })
  })

  it('ignores ends of the other kind', () => {
    expect(snapToEnd({ x: 20.5, z: 20 }, [road, river], 'path')).toEqual({ x: 20.5, z: 20 })
  })

  it('ignores the excluded spline', () => {
    expect(snapToEnd({ x: 0.5, z: 0 }, [road], 'path', 'a')).toEqual({ x: 0.5, z: 0 })
  })

  it('picks the nearest end', () => {
    const other = spline('b', 'path', [
      { x: 1.5, z: 0 },
      { x: 1.5, z: 10 },
    ])
    expect(snapToEnd({ x: 1.2, z: 0 }, [road, other], 'path')).toEqual({ x: 1.5, z: 0 })
  })
})

describe('splineBounds', () => {
  it('pads the samples bounding box', () => {
    const sm = sampleSpline([
      { x: -4, z: 2 },
      { x: 6, z: 2 },
    ])
    expect(splineBounds(sm, 1)).toEqual({ x0: -5, z0: 1, x1: 7, z1: 3 })
  })
})
