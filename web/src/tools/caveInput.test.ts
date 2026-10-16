import { describe, expect, it } from 'vitest'
import { emptyFeatures, FEATURE_LIMITS, FEATURES, type Cave, type Features } from '../features/features'
import { CaveInput, editCave, editCavePoint, type Ray } from './caveInput'
import type { SplineResult } from './splineInput'

const SIZE = 64

function setup(features: Features = emptyFeatures()) {
  let f = features
  const input = new CaveInput(() => f, SIZE)
  const run = (r: SplineResult | null) => {
    if (r?.preview) f = r.preview
    if (r?.commit) f = r.commit
    return r
  }
  return { input, run, features: () => f }
}

const P = (x: number, y: number, z: number) => ({ x, y, z })
/** A ray straight down onto (x, z) from high above. */
const down = (x: number, z: number): Ray => ({ origin: P(x, 100, z), dir: P(0, -1, 0) })
/** Clicks the ground at (x, h, z), from straight above. */
const at = (x: number, h: number, z: number) => [P(x, h, z), down(x, z)] as const

const cave = (overrides: Partial<Cave> = {}): Cave => ({
  id: 'c',
  radius: 2,
  points: [
    { x: -10, y: 2, z: 0, chamber: 0 },
    { x: 0, y: 1, z: 0, chamber: 6 },
    { x: 10, y: 0, z: 0, chamber: 0 },
  ],
  ...overrides,
})
const withCave = (c: Cave = cave()): Features => ({ ...emptyFeatures(), caves: [c] })

describe('CaveInput drawing', () => {
  it('commits click, click, Enter as one cave: the entrance at the hit, later points at the previous y', () => {
    const { input, run, features } = setup()
    run(input.click(...at(-5, 3, 2)))
    run(input.click(...at(5, 7, 2)))
    run(input.click(...at(12, -1, 4)))
    expect(input.draft).toHaveLength(3)
    const r = run(input.key('Enter'))
    expect(r?.commit?.caves).toHaveLength(1)
    const c = features().caves[0]
    expect(c.points).toEqual([
      { x: -5, y: 3, z: 2, chamber: 0 },
      { x: 5, y: 3, z: 2, chamber: 0 },
      { x: 12, y: 3, z: 4, chamber: 0 },
    ])
    expect(c.radius).toBe(FEATURES.cave.radius.default)
    expect(input.draft).toBeNull()
    expect(input.selectedId).toBe(c.id)
  })

  it('finishes on a double-click, dropping its duplicate click', () => {
    const { input, run, features } = setup()
    run(input.click(...at(0, 1, 0)))
    run(input.click(...at(8, 1, 0)))
    run(input.click(...at(8.1, 1, 0)))
    run(input.doubleClick(...at(8.1, 1, 0)))
    expect(features().caves[0].points.map((p) => p.x)).toEqual([0, 8])
  })

  it('cancels the draft with Escape, drops a point with Backspace, and commits nothing for one point', () => {
    const { input, run, features } = setup()
    run(input.click(...at(0, 1, 0)))
    run(input.click(...at(5, 1, 0)))
    run(input.key('Backspace'))
    expect(input.draft).toHaveLength(1)
    run(input.key('Enter'))
    expect(features().caves).toEqual([])
    run(input.click(...at(0, 1, 0)))
    expect(input.key('Escape')).not.toBeNull()
    expect(input.draft).toBeNull()
    expect(input.key('Escape')).toBeNull()
  })

  it('ignores misses and clamps points into the scene', () => {
    const { input, run, features } = setup()
    expect(input.click(null, down(0, 0))).toBeNull()
    run(input.click(...at(0, 1, 0)))
    run(input.click(P(90, 1, 0), down(90, 0)))
    run(input.key('Enter'))
    expect(features().caves[0].points[1].x).toBe(SIZE / 2)
  })

  it('holds the cave and point limits', () => {
    const many = { ...emptyFeatures(), caves: Array.from({ length: FEATURE_LIMITS.maxCaves }, (_, k) => cave({ id: `c${k}`, points: cave().points.map((p) => ({ ...p, z: k * 3 - 30 })) })) }
    const { input, run, features } = setup(many)
    run(input.click(...at(20, 1, 20)))
    run(input.click(...at(25, 1, 20)))
    expect(run(input.key('Enter'))?.message).toMatch(/at most 20 caves/)
    expect(features().caves).toHaveLength(FEATURE_LIMITS.maxCaves)

    const one = setup()
    for (let k = 0; k <= FEATURE_LIMITS.maxCavePoints; k++) one.run(one.input.click(...at(-30 + k * 0.6, 1, 0)))
    expect(one.input.draft).toHaveLength(FEATURE_LIMITS.maxCavePoints)
  })
})

describe('CaveInput editing', () => {
  it('selects a cave and point by a ray passing near an underground point', () => {
    const { input, run } = setup(withCave())
    // The ground over the point is at 6 m; the ray passes 0.3 m from the point at y = 1.
    run(input.click(P(0.3, 6, 0), down(0.3, 0)))
    expect(input.selectedId).toBe('c')
    expect(input.selectedPoint).toBe(1)
    expect(input.draft).toBeNull()
  })

  it('drags a point in x, z at its own height as one commit', () => {
    const { input, run, features } = setup(withCave())
    input.select('c', 1)
    // A slanted ray from above: it crosses the point's plane (y = 1) at x.
    const slant = (x: number): Ray => ({ origin: P(x - 5, 11, 0), dir: P(0.5, -1, 0) })
    expect(run(input.pointerDown(slant(0)))).not.toBeNull()
    run(input.pointerMove(slant(8)))
    const r = run(input.pointerUp())
    expect(r?.commit).toBeDefined()
    expect(features().caves[0].points[1]).toEqual({ x: 8, y: 1, z: 0, chamber: 6 })
    // The click that ends the drag doesn't start a draft.
    expect(input.click(...at(8, 6, 0))).toBeNull()
    expect(input.draft).toBeNull()
  })

  it('deletes the hovered point, then the whole cave', () => {
    const { input, run, features } = setup(withCave())
    input.select('c', null)
    input.pointerMove(down(10, 0))
    expect(input.hoveredHandle).toBe(2)
    run(input.key('Delete'))
    expect(features().caves[0].points).toHaveLength(2)
    input.pointerMove(down(30, 30))
    run(input.key('Delete'))
    expect(features().caves).toEqual([])
    expect(input.selectedId).toBeNull()
  })

  it('edits a point and the cave with clamping, leaving the rest alone', () => {
    const f = withCave()
    const raised = editCavePoint(f, 'c', 0, { y: 4 })
    expect(raised.caves[0].points[0]).toEqual({ x: -10, y: 4, z: 0, chamber: 0 })
    expect(editCavePoint(f, 'c', 1, { chamber: 50 }).caves[0].points[1].chamber).toBe(FEATURES.cave.chamber.max)
    expect(editCavePoint(f, 'c', 1, { chamber: 0 }).caves[0].points[1].chamber).toBe(0)
    expect(editCave(f, 'c', { radius: 0.2 }).caves[0].radius).toBe(FEATURES.cave.radius.min)
    expect(editCavePoint(f, 'c', 9, { y: 4 })).toBe(f)
    expect(f.caves[0].points[0].y).toBe(2)
  })
})

describe('CaveInput axis arrows', () => {
  /** A ray from the +x side along -x at height y, through z = 0. */
  const side = (y: number, z = 0): Ray => ({ origin: P(100, y, z), dir: P(-1, 0, 0) })

  it('moves the selected point along an arrow by how far the pointer travelled, as one commit', () => {
    const { input, run, features } = setup(withCave())
    input.select('c', 1)
    // The x arrow runs 0–4 m from the point at (0, 1, 0): grab it at x = 2, drag to x = 5.
    expect(input.pointerDown(down(2, 0))).not.toBeNull()
    run(input.pointerMove(down(5, 0)))
    expect(features().caves[0].points[1]).toMatchObject({ x: 3, y: 1, z: 0, chamber: 6 })
    expect(input.pointerUp()?.commit).toBeDefined()
  })

  it('moves a point up and down along the y arrow', () => {
    const { input, run, features } = setup(withCave())
    input.select('c', 1)
    expect(input.pointerDown(side(3))).not.toBeNull()
    run(input.pointerMove(side(4.5)))
    expect(features().caves[0].points[1]).toMatchObject({ x: 0, y: 2.5, z: 0 })
  })

  it('moves the other points of the cave not at all', () => {
    const { input, run, features } = setup(withCave())
    input.select('c', 1)
    input.pointerDown(down(2, 0))
    run(input.pointerMove(down(5, 0)))
    expect(features().caves[0].points[0]).toEqual(cave().points[0])
    expect(features().caves[0].points[2]).toEqual(cave().points[2])
  })

  it('reports the arrow under the pointer, and none away from them', () => {
    const { input } = setup(withCave())
    input.select('c', 1)
    input.pointerMove(down(2, 0))
    expect(input.hoveredAxis).toBe('x')
    input.pointerMove(down(30, 30))
    expect(input.hoveredAxis).toBeNull()
  })

  it('shows no arrows until a point is selected', () => {
    const { input } = setup(withCave())
    input.select('c')
    input.pointerMove(down(2, 0))
    expect(input.hoveredAxis).toBeNull()
    expect(input.pointerDown(down(2, 0))).toBeNull()
  })

  it('keeps a dragged point inside the scene and the height limits', () => {
    const { input, run, features } = setup(withCave())
    input.select('c', 1)
    input.pointerDown(down(2, 0))
    run(input.pointerMove(down(500, 0)))
    expect(features().caves[0].points[1].x).toBe(SIZE / 2)
  })
})

describe('editCavePoint radius', () => {
  it('clamps a point radius to the cave radius range', () => {
    const f: Features = { ...emptyFeatures(), caves: [{ id: 'c', radius: 2, points: [{ x: 0, y: 0, z: 0, chamber: 0 }, { x: 5, y: 0, z: 0, chamber: 0 }] }] }
    const big = editCavePoint(f, 'c', 0, { radius: 1000 })
    expect(big.caves[0].points[0].radius).toBe(FEATURES.cave.radius.max)
    const small = editCavePoint(f, 'c', 0, { radius: 0 })
    expect(small.caves[0].points[0].radius).toBe(FEATURES.cave.radius.min)
  })
})
