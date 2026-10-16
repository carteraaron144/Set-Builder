import { describe, expect, it } from 'vitest'
import type { Features } from '../features/features'
import { SelectInput } from './selectInput'

const features = (): Features => ({
  splines: [{ id: 's', kind: 'path', style: 'dirt', width: 2, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }] }],
  ponds: [{ id: 'p', seed: { x: -10, z: 10 }, level: 1 }],
  caves: [{ id: 'c', radius: 2, points: [{ x: 0, y: -5, z: 10, chamber: 0 }, { x: 10, y: -5, z: 10, chamber: 0 }] }],
})

/** A ray straight down onto (x, z) from 50 m up. */
const down = (x: number, z: number) => ({ origin: { x, y: 50, z }, dir: { x: 0, y: -1, z: 0 } })
/** A ray along +z at height y and lateral x: passes through points at that x and y. */
const along = (x: number, y: number) => ({ origin: { x, y, z: -50 }, dir: { x: 0, y: 0, z: 1 } })

function setup() {
  let f = features()
  const input = new SelectInput(() => f, () => 0, 64, () => 4)
  return { input, set: (next: Features) => (f = next), get: () => f }
}

describe('SelectInput', () => {
  it('selects a path point, a pond seed and a cave point by ray, whichever tool made them', () => {
    const { input } = setup()
    input.pointerDown(down(10, 0))
    input.pointerUp()
    expect(input.selected).toEqual({ kind: 'spline', id: 's', point: 1 })
    input.pointerDown(down(-10, 10))
    input.pointerUp()
    expect(input.selected).toEqual({ kind: 'pond', id: 'p' })
    input.pointerDown(along(10, -5))
    input.pointerUp()
    expect(input.selected).toEqual({ kind: 'cave', id: 'c', point: 1 })
  })

  it('deselects when the press hits nothing', () => {
    const { input } = setup()
    input.select({ kind: 'spline', id: 's', point: 0 })
    input.pointerDown(down(40, 40))
    input.pointerUp()
    expect(input.selected).toBeNull()
  })

  it('hovers the handle under the ray', () => {
    const { input } = setup()
    input.pointerMove(down(20, 0))
    expect(input.hovered).toEqual({ kind: 'spline', id: 's', point: 2 })
    input.pointerMove(down(40, 40))
    expect(input.hovered).toBeNull()
  })

  it('drags the grabbed handle in its horizontal plane, previewing then committing once on release', () => {
    const { input, set } = setup()
    input.pointerDown(down(10, 0))
    const move = input.pointerMove(down(12, 3))
    expect(move!.preview!.splines[0].points[1]).toEqual({ x: 12, z: 3 })
    set(move!.preview!)
    const up = input.pointerUp()
    expect(up!.commit!.splines[0].points[1]).toEqual({ x: 12, z: 3 })
  })

  it('drags a cave point at its own depth', () => {
    const { input } = setup()
    input.pointerDown(along(10, -5))
    const move = input.pointerMove({ origin: { x: 14, y: 50, z: 12 }, dir: { x: 0, y: -1, z: 0 } })
    const p = move!.preview!.caves[0].points[1]
    expect([p.x, p.y, p.z]).toEqual([14, -5, 12])
  })

  it('commits nothing for a press and release without moving', () => {
    const { input } = setup()
    input.pointerDown(down(10, 0))
    expect(input.pointerUp()).toEqual({})
  })

  it('moves a cave point up and down along the y arrow of its gizmo', () => {
    const { input } = setup()
    input.select({ kind: 'cave', id: 'c', point: 1 })
    // The y arrow runs up from the point; grab it 2 m above (gizmo length 4, starting a quarter out).
    const grab = { origin: { x: 10, y: -3, z: -50 }, dir: { x: 0, y: 0, z: 1 } }
    expect(input.pointerDown(grab)).not.toBeNull()
    const move = input.pointerMove({ origin: { x: 10, y: -1, z: -50 }, dir: { x: 0, y: 0, z: 1 } })
    const p = move!.preview!.caves[0].points[1]
    expect([p.x, p.z]).toEqual([10, 10])
    expect(p.y).toBeCloseTo(-3)
  })

  it('deletes the selected point with Delete, and the pond with Delete', () => {
    const { input } = setup()
    input.select({ kind: 'spline', id: 's', point: 1 })
    expect(input.key('Delete')!.commit!.splines[0].points).toHaveLength(2)
    expect(input.selected).toBeNull()
    input.select({ kind: 'pond', id: 'p' })
    expect(input.key('Backspace')!.commit!.ponds).toEqual([])
  })

  it('deselects on Escape and ignores keys with nothing selected', () => {
    const { input } = setup()
    expect(input.key('Delete')).toBeNull()
    input.select({ kind: 'pond', id: 'p' })
    expect(input.key('Escape')).toEqual({})
    expect(input.selected).toBeNull()
  })

  it('forgets a selection whose feature has gone', () => {
    const { input, set } = setup()
    input.select({ kind: 'pond', id: 'p' })
    set({ ...features(), ponds: [] })
    expect(input.selected).toBeNull()
  })

  it('cancel drops a drag without committing', () => {
    const { input } = setup()
    input.pointerDown(down(10, 0))
    input.pointerMove(down(12, 3))
    expect(input.cancel()).toBe(true)
    expect(input.pointerUp()).toBeNull()
  })
})
