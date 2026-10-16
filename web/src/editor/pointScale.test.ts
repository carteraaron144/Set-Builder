import { describe, expect, it } from 'vitest'
import { emptyFeatures, FEATURES, type Features } from '../features/features'
import { scaleSelectedPoint } from './pointScale'

const features = (): Features => ({
  ...emptyFeatures(),
  splines: [{ id: 's', kind: 'path', style: 'dirt', width: 2, points: [{ x: 0, z: 0 }, { x: 5, z: 0, width: 4 }] }],
  caves: [{ id: 'c', radius: 2, points: [{ x: 0, y: 0, z: 0, chamber: 0 }, { x: 5, y: 0, z: 0, chamber: 0, radius: 3 }] }],
})

describe('scaleSelectedPoint', () => {
  it('scales a cave point from its own radius, or the cave radius when unset', () => {
    const f = features()
    expect(scaleSelectedPoint(f, { kind: 'cave', id: 'c', point: 1 }, 1.25)!.caves[0].points[1].radius).toBeCloseTo(3.75)
    expect(scaleSelectedPoint(f, { kind: 'cave', id: 'c', point: 0 }, 1.25)!.caves[0].points[0].radius).toBeCloseTo(2.5)
  })

  it('clamps to the cave radius range', () => {
    const f = scaleSelectedPoint(features(), { kind: 'cave', id: 'c', point: 1 }, 1000)!
    expect(f.caves[0].points[1].radius).toBe(FEATURES.cave.radius.max)
  })

  it('scales a spline point from its own width, or the spline width when unset', () => {
    const f = features()
    expect(scaleSelectedPoint(f, { kind: 'spline', id: 's', point: 1 }, 0.5)!.splines[0].points[1].width).toBeCloseTo(2)
    expect(scaleSelectedPoint(f, { kind: 'spline', id: 's', point: 0 }, 2)!.splines[0].points[0].width).toBeCloseTo(4)
  })

  it('does nothing without a selected point', () => {
    const f = features()
    expect(scaleSelectedPoint(f, null, 2)).toBeNull()
    expect(scaleSelectedPoint(f, { kind: 'cave', id: 'c', point: null }, 2)).toBeNull()
    expect(scaleSelectedPoint(f, { kind: 'spline', id: 's', point: null }, 2)).toBeNull()
    expect(scaleSelectedPoint(f, { kind: 'pond', id: 'p' }, 2)).toBeNull()
    expect(scaleSelectedPoint(f, { kind: 'cave', id: 'c', point: 9 }, 2)).toBeNull()
  })
})
