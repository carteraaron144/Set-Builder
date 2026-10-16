import { describe, expect, it } from 'vitest'
import { emptyFeatures, FEATURES, type Features } from '../features/features'
import { handleAxes, listHandles, moveHandle, removeHandle, scaleHandle, type HandleRef } from './handles'

const features = (): Features => ({
  splines: [
    { id: 's', kind: 'path', style: 'dirt', width: 2, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 9, z: 3 }] },
    { id: 'r', kind: 'path', style: 'dirt', width: 4, points: [{ x: 9, z: 3 }, { x: 20, z: 3 }] },
  ],
  ponds: [{ id: 'p', seed: { x: -4, z: -4 }, level: 1 }],
  caves: [{ id: 'c', radius: 2, points: [{ x: 1, y: -2, z: 1, chamber: 0 }, { x: 6, y: -3, z: 1, chamber: 0 }] }],
})
const spline: HandleRef = { kind: 'spline', id: 's', point: 1 }
const cave: HandleRef = { kind: 'cave', id: 'c', point: 1 }
const pond: HandleRef = { kind: 'pond', id: 'p' }
const flat = () => 0.5

describe('listHandles', () => {
  it('lists every point of every feature, with ground height for splines and ponds and own depth for caves', () => {
    const hs = listHandles(features(), flat)
    expect(hs).toHaveLength(3 + 2 + 1 + 2)
    expect(hs.find((h) => h.ref.kind === 'spline' && h.ref.id === 's' && h.ref.point === 1)!.position).toEqual({ x: 5, y: 0.5, z: 0 })
    expect(hs.find((h) => h.ref.kind === 'cave' && h.ref.point === 1)!.position).toEqual({ x: 6, y: -3, z: 1 })
    expect(hs.find((h) => h.ref.kind === 'pond')!.position).toEqual({ x: -4, y: 0.5, z: -4 })
  })

  it('lists nothing for empty features', () => {
    expect(listHandles(emptyFeatures(), flat)).toEqual([])
  })
})

describe('handleAxes', () => {
  it('offers y only for cave points', () => {
    expect(handleAxes(spline)).toEqual(['x', 'z'])
    expect(handleAxes(pond)).toEqual(['x', 'z'])
    expect(handleAxes(cave)).toEqual(['x', 'y', 'z'])
  })
})

describe('moveHandle', () => {
  it('moves a spline point in x, z, clamped to the scene, keeping its width', () => {
    const f = features()
    f.splines[0].points[1].width = 3
    const moved = moveHandle(f, spline, { x: 100, y: 9, z: 2 }, 32)
    expect(moved.splines[0].points[1]).toEqual({ x: 32, z: 2, width: 3 })
  })

  it('moves a cave point in x, y, z, clamping depth', () => {
    const moved = moveHandle(features(), cave, { x: 7, y: -500, z: 2 }, 32)
    const p = moved.caves[0].points[1]
    expect([p.x, p.z]).toEqual([7, 2])
    expect(p.y).toBeGreaterThan(-500)
  })

  it('moves a pond seed, keeping its level', () => {
    const moved = moveHandle(features(), pond, { x: 3, y: 0, z: 4 }, 32)
    expect(moved.ponds[0]).toEqual({ id: 'p', seed: { x: 3, z: 4 }, level: 1 })
  })

  it('snaps the end of a path to the end of another within the snap distance', () => {
    const near = { x: 9 + FEATURES.snapDistance / 2, y: 0, z: 3 }
    const moved = moveHandle(features(), { kind: 'spline', id: 's', point: 2 }, near, 32)
    expect(moved.splines[0].points[2]).toEqual({ x: 9, z: 3 })
  })

  it('returns the same features for an unknown or non-finite target', () => {
    const f = features()
    expect(moveHandle(f, { kind: 'spline', id: 'nope', point: 0 }, { x: 1, y: 0, z: 1 }, 32)).toBe(f)
    expect(moveHandle(f, spline, { x: NaN, y: 0, z: 1 }, 32)).toBe(f)
  })
})

describe('removeHandle', () => {
  it('removes a point, or the whole spline or cave when it would drop below two points', () => {
    expect(removeHandle(features(), spline).splines[0].points).toHaveLength(2)
    expect(removeHandle(features(), { kind: 'spline', id: 'r', point: 0 }).splines.map((s) => s.id)).toEqual(['s'])
    expect(removeHandle(features(), cave).caves).toEqual([])
  })

  it('deletes a pond', () => {
    expect(removeHandle(features(), pond).ponds).toEqual([])
  })
})

describe('scaleHandle', () => {
  it('scales spline and cave points, and ignores ponds', () => {
    const f = features()
    expect(scaleHandle(f, spline, 2)!.splines[0].points[1].width).toBe(4)
    expect(scaleHandle(f, cave, 1.5)!.caves[0].points[1].radius).toBe(3)
    expect(scaleHandle(f, pond, 2)).toBeNull()
  })
})
