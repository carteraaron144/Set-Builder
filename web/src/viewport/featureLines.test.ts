import { describe, expect, it } from 'vitest'
import { emptyFeatures, type Features } from '../features/features'
import { centrelineSegments } from './featureLines'

const flat = () => 2
const features = (): Features => ({
  splines: [
    { id: 'p', kind: 'path', style: 'dirt', width: 2, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }] },
    { id: 'r', kind: 'river', style: 'dirt', width: 2, points: [{ x: 0, z: 5 }, { x: 10, z: 5 }] },
  ],
  ponds: [],
  caves: [{ id: 'c', radius: 2, points: [{ x: 0, y: -3, z: 0, chamber: 0 }, { x: 8, y: -4, z: 0, chamber: 0 }] }],
})

describe('centrelineSegments', () => {
  it('is empty with no features', () => {
    const s = centrelineSegments(emptyFeatures(), flat)
    expect(s.paths.length).toBe(0)
    expect(s.caves.length).toBe(0)
  })

  it('draws paths (not rivers) on the ground, as line-segment pairs', () => {
    const { paths } = centrelineSegments(features(), flat)
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.length % 6).toBe(0)
    for (let v = 0; v < paths.length; v += 3) {
      expect(paths[v + 1]).toBe(2)
      expect(paths[v + 2]).toBe(0) // the river at z = 5 is left out
    }
    // Consecutive segments join end to start.
    expect(Array.from(paths.slice(3, 6))).toEqual(Array.from(paths.slice(6, 9)))
  })

  it('draws caves through their points at depth', () => {
    const { caves } = centrelineSegments(features(), flat)
    expect(caves.length).toBeGreaterThan(0)
    expect(caves.length % 6).toBe(0)
    const ys = Array.from({ length: caves.length / 3 }, (_, k) => caves[k * 3 + 1])
    expect(Math.min(...ys)).toBeCloseTo(-4)
    expect(Math.max(...ys)).toBeCloseTo(-3)
  })

  it('skips a spline with fewer than two points', () => {
    const f = features()
    f.splines[0].points = [{ x: 0, z: 0 }]
    f.caves[0].points = f.caves[0].points.slice(0, 1)
    const s = centrelineSegments(f, flat)
    expect(s.paths.length).toBe(0)
    expect(s.caves.length).toBe(0)
  })
})
