import { describe, expect, it } from 'vitest'
import { defaultWidth, emptyFeatures, FEATURE_LIMITS, featuresBytes, featuresSchema, type Features, type Spline } from './features'

const path = (overrides: Partial<Spline> = {}): Spline => ({
  id: 'p1',
  kind: 'path',
  style: 'dirt',
  width: 2,
  points: [
    { x: -10, z: 0 },
    { x: 10, z: 5 },
  ],
  ...overrides,
})

const withSplines = (splines: Spline[]): Features => ({ splines, ponds: [] })

describe('features', () => {
  it('starts empty', () => {
    expect(emptyFeatures()).toEqual({ splines: [], ponds: [] })
  })

  it('has default widths per kind and style', () => {
    expect(defaultWidth('path', 'dirt')).toBe(2)
    expect(defaultWidth('path', 'cobble')).toBe(3)
    expect(defaultWidth('river', 'dirt')).toBe(3)
  })

  it('accepts valid features unchanged', () => {
    const f: Features = { splines: [path()], ponds: [{ id: 'w1', seed: { x: 0, z: 0 }, level: 1.5 }] }
    expect(featuresSchema(64).parse(f)).toEqual(f)
  })

  it('accepts points on the scene edge', () => {
    const f = withSplines([path({ points: [{ x: -32, z: -32 }, { x: 32, z: 32 }] })])
    expect(featuresSchema(64).safeParse(f).success).toBe(true)
  })

  it('clamps widths to the kind range', () => {
    const parsed = featuresSchema(64).parse(withSplines([path({ width: 20 }), path({ id: 'r', kind: 'river', width: 0.2 })]))
    expect(parsed.splines.map((s) => s.width)).toEqual([8, 1])
    expect(featuresSchema(64).parse(withSplines([path({ kind: 'river', width: 20 })])).splines[0].width).toBe(12)
  })

  it.each([
    ['a point outside the scene', withSplines([path({ points: [{ x: 33, z: 0 }, { x: 0, z: 0 }] })])],
    ['a 1-point spline', withSplines([path({ points: [{ x: 0, z: 0 }] })])],
    ['too many points', withSplines([path({ points: Array.from({ length: FEATURE_LIMITS.maxPoints + 1 }, (_, i) => ({ x: 0, z: i / 10 })) })])],
    ['too many splines', withSplines(Array.from({ length: FEATURE_LIMITS.maxSplines + 1 }, (_, i) => path({ id: `p${i}` })))],
    ['too many ponds', { splines: [], ponds: Array.from({ length: FEATURE_LIMITS.maxPonds + 1 }, (_, i) => ({ id: `w${i}`, seed: { x: 0, z: 0 }, level: 0 })) }],
    ['a pond seed outside the scene', { splines: [], ponds: [{ id: 'w', seed: { x: 0, z: -40 }, level: 0 }] }],
    ['a non-finite level', { splines: [], ponds: [{ id: 'w', seed: { x: 0, z: 0 }, level: Infinity }] }],
    ['an unknown kind', withSplines([path({ kind: 'road' as Spline['kind'] })])],
  ])('rejects %s', (_label, f) => {
    expect(featuresSchema(64).safeParse(f).success).toBe(false)
  })

  it('measures features as JSON length × 2', () => {
    const f = withSplines([path()])
    expect(featuresBytes(f)).toBe(JSON.stringify(f).length * 2)
  })
})
