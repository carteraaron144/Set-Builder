import { describe, expect, it } from 'vitest'
import { emptyFeatures, type Features, type Spline, type SplineKind } from '../features/features'
import { SplineInput, type SplineResult } from './splineInput'

const SIZE = 64

function setup(kind: SplineKind = 'path', features: Features = emptyFeatures()) {
  let f = features
  const input = new SplineInput(kind, () => f, SIZE)
  /** Applies an event's result the way the rig does: previews and commits become the current features. */
  const run = (r: SplineResult | null) => {
    if (r?.preview) f = r.preview
    if (r?.commit) f = r.commit
    return r
  }
  return { input, run, features: () => f }
}

const existing = (id: string, kind: SplineKind, points: [number, number][]): Spline => ({
  id,
  kind,
  style: 'dirt',
  width: 2,
  points: points.map(([x, z]) => ({ x, z })),
})

const P = (x: number, z: number) => ({ x, z })
const plain = { alt: false }

describe('SplineInput drafting', () => {
  it('commits three clicks and a double-click as one 3-point path, dropping the duplicate', () => {
    const { input, run, features } = setup()
    run(input.click(P(0, 0), plain))
    run(input.click(P(10, 0), plain))
    run(input.click(P(20, 5), plain))
    run(input.click(P(20.05, 5), plain))
    const r = run(input.doubleClick(P(20.05, 5)))
    expect(r?.commit?.splines).toHaveLength(1)
    const s = features().splines[0]
    expect(s.points).toEqual([P(0, 0), P(10, 0), P(20, 5)])
    expect(s).toMatchObject({ kind: 'path', style: 'dirt', width: 2 })
    expect(s.id).toMatch(/.+/)
    expect(input.draft).toBeNull()
  })

  it('commits nothing for one click and Enter', () => {
    const { input, run, features } = setup()
    run(input.click(P(0, 0), plain))
    const r = run(input.key('Enter'))
    expect(r?.commit).toBeUndefined()
    expect(features().splines).toEqual([])
    expect(input.draft).toBeNull()
  })

  it('clears the draft with Escape and removes its last point with Backspace', () => {
    const { input } = setup()
    input.click(P(0, 0), plain)
    input.click(P(5, 0), plain)
    input.key('Backspace')
    expect(input.draft).toEqual([P(0, 0)])
    expect(input.key('Escape')).not.toBeNull()
    expect(input.draft).toBeNull()
    expect(input.key('Escape')).toBeNull()
  })

  it('snaps the start and end onto path ends within 2 m, but not onto river ends', () => {
    const { input, run, features } = setup('path', {
      splines: [existing('a', 'path', [[-20, 0], [-5, 0]]), existing('r', 'river', [[10, 10], [20, 20]])],
      ponds: [],
      caves: [],
    })
    run(input.click(P(-3.5, 1), plain))
    expect(input.draft).toEqual([P(-5, 0)])
    run(input.click(P(5, 5), plain))
    run(input.click(P(11, 11), plain))
    run(input.key('Enter'))
    expect(features().splines[2].points).toEqual([P(-5, 0), P(5, 5), P(11, 11)])

    run(input.click(P(0, 20), plain))
    run(input.click(P(-19, 1), plain))
    run(input.key('Enter'))
    expect(features().splines[3].points).toEqual([P(0, 20), P(-20, 0)])
  })

  it('clamps points outside the scene to its edge', () => {
    const { input } = setup()
    input.click(P(100, -40), plain)
    expect(input.draft).toEqual([P(32, -32)])
  })

  it('ignores clicks past 200 points with a message', () => {
    const { input } = setup()
    for (let k = 0; k < 200; k++) input.click(P(-30 + (k % 20) * 3, -30 + Math.floor(k / 20) * 3), plain)
    expect(input.draft).toHaveLength(200)
    const r = input.click(P(31, 31), plain)
    expect(r?.message).toBe('A spline can have at most 200 points.')
    expect(input.draft).toHaveLength(200)
  })
})

describe('SplineInput selecting and editing', () => {
  const road = () => ({ splines: [existing('a', 'path', [[-20, 0], [0, 0], [20, 0]])], ponds: [], caves: [] })

  it('selects a path clicked near its body with no draft', () => {
    const { input, run } = setup('path', road())
    run(input.click(P(-10, 1.5), plain))
    expect(input.selectedId).toBe('a')
    expect(input.draft).toBeNull()
  })

  it('does not select splines of the other kind', () => {
    const { input } = setup('river', road())
    input.click(P(-10, 1), plain)
    expect(input.selectedId).toBeNull()
    expect(input.draft).toEqual([P(-10, 1)])
  })

  it('previews a handle drag on every move and commits once on release, swallowing its click', () => {
    const { input, run, features } = setup('path', road())
    input.click(P(-10, 1), plain)
    expect(run(input.pointerDown(P(0.4, 0.3)))).not.toBeNull()
    const a = run(input.pointerMove(P(0, 5)))
    const b = run(input.pointerMove(P(0, 8)))
    expect(a?.preview?.splines[0].points[1]).toEqual(P(0, 5))
    expect(b?.preview?.splines[0].points[1]).toEqual(P(0, 8))
    expect(a?.commit).toBeUndefined()
    const up = run(input.pointerUp())
    expect(up?.commit?.splines[0].points[1]).toEqual(P(0, 8))
    expect(input.click(P(0, 8), plain)).toBeNull()
    expect(input.draft).toBeNull()
    expect(features().splines[0].points).toHaveLength(3)
  })

  it('does not start a drag away from the handles', () => {
    const { input } = setup('path', road())
    input.click(P(-10, 1), plain)
    expect(input.pointerDown(P(-10, 1))).toBeNull()
  })

  it('inserts a point between the right neighbours on Alt-click', () => {
    const { input, run } = setup('path', road())
    input.click(P(-10, 1), plain)
    const r = run(input.click(P(10, 0.5), { alt: true }))
    expect(r?.commit?.splines[0].points).toEqual([P(-20, 0), P(0, 0), P(10, 0.5), P(20, 0)])
  })

  it('deletes the hovered handle point, or the whole 2-point spline', () => {
    const { input, run, features } = setup('path', road())
    input.click(P(-10, 1), plain)
    input.pointerMove(P(0.3, 0))
    run(input.key('Delete'))
    expect(features().splines[0].points).toEqual([P(-20, 0), P(20, 0)])
    input.pointerMove(P(-20, 0))
    run(input.key('Delete'))
    expect(features().splines).toEqual([])
    expect(input.selectedId).toBeNull()
  })

  it('deletes the whole spline when no handle is hovered', () => {
    const { input, run, features } = setup('path', road())
    input.click(P(-10, 1), plain)
    input.pointerMove(P(-10, 1))
    run(input.key('Backspace'))
    expect(features().splines).toEqual([])
  })

  it('never produces non-finite points for degenerate drafts', () => {
    const { input, run, features } = setup()
    run(input.click(P(NaN, 0), plain))
    run(input.click(P(5, Infinity), plain))
    run(input.key('Enter'))
    for (const s of features().splines) for (const p of s.points) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true)
  })
})

describe('SplineInput point selection and arrows', () => {
  const ray = (x: number, y: number, z: number, dir = { x: 0, y: -1, z: 0 }) => ({ origin: { x, y, z }, dir })
  const path = () => ({ ...emptyFeatures(), splines: [existing('s', 'path', [[-10, 0], [0, 0], [10, 0]])] })
  const selectMiddle = () => {
    const s = setup('path', path())
    s.input.select('s')
    s.input.pointerDown(P(0, 0))
    s.run(s.input.pointerUp())
    return s
  }

  it('selects the point whose handle is grabbed, and drops it on Escape before the path', () => {
    const { input } = selectMiddle()
    expect(input.selectedPoint).toBe(1)
    expect(input.key('Escape')).not.toBeNull()
    expect(input.selectedPoint).toBeNull()
    expect(input.selectedId).toBe('s')
    input.key('Escape')
    expect(input.selectedId).toBeNull()
  })

  it('forgets the point when another path is selected', () => {
    const { input } = selectMiddle()
    input.select('s')
    expect(input.selectedPoint).toBeNull()
  })

  it('moves the selected point along the x arrow, as one commit', () => {
    const { input, run, features } = selectMiddle()
    // The arrow starts at the handle (0.15 m up) and runs 4 m: grab it at x = 2, drag to x = 5.
    expect(input.pointerDown(P(2, 0), ray(2, 100, 0))).not.toBeNull()
    run(input.pointerMove(P(5, 0), ray(5, 100, 0)))
    expect(features().splines[0].points[1]).toEqual(P(3, 0))
    expect(features().splines[0].points[0]).toEqual(P(-10, 0))
    expect(input.pointerUp()?.commit).toBeDefined()
  })

  it('moves the selected point along the z arrow', () => {
    const { input, run, features } = selectMiddle()
    input.pointerDown(P(0, 2), ray(0, 100, 2))
    run(input.pointerMove(P(0, 4), ray(0, 100, 4)))
    expect(features().splines[0].points[1]).toEqual(P(0, 2))
  })

  it('has no vertical arrow: the height follows the ground', () => {
    const { input } = selectMiddle()
    input.pointerMove(P(50, 50), ray(100, 2, 0, { x: -1, y: 0, z: 0 }))
    expect(input.hoveredAxis).toBeNull()
  })

  it('reports the hovered arrow only when a point is selected', () => {
    const { input } = selectMiddle()
    input.pointerMove(P(2, 0), ray(2, 100, 0))
    expect(input.hoveredAxis).toBe('x')
    const none = setup('path', path())
    none.input.select('s')
    none.input.pointerMove(P(2, 0), ray(2, 100, 0))
    expect(none.input.hoveredAxis).toBeNull()
  })
})
