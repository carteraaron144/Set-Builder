import { describe, expect, it } from 'vitest'
import { defaultWidth, emptyFeatures, FEATURE_LIMITS, featuresBytes, featuresSchema, type Cave, type Features, type Spline } from './features'

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

const withSplines = (splines: Spline[]): Features => ({ splines, ponds: [], caves: [] })

const cave = (overrides: Partial<Cave> = {}): Cave => ({
  id: 'c1',
  radius: 2,
  points: [
    { x: -10, y: 2, z: 0, chamber: 0 },
    { x: 10, y: 0, z: 5, chamber: 6 },
  ],
  ...overrides,
})

const withCaves = (caves: Cave[]): Features => ({ splines: [], ponds: [], caves })

describe('features', () => {
  it('starts empty', () => {
    expect(emptyFeatures()).toEqual({ splines: [], ponds: [], caves: [] })
  })

  it('has default widths per kind and style', () => {
    expect(defaultWidth('path', 'dirt')).toBe(2)
    expect(defaultWidth('path', 'cobble')).toBe(3)
    expect(defaultWidth('river', 'dirt')).toBe(3)
  })

  it('accepts valid features unchanged', () => {
    const f: Features = { splines: [path()], ponds: [{ id: 'w1', seed: { x: 0, z: 0 }, level: 1.5 }], caves: [cave()] }
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

  it('loads features without caves with no caves', () => {
    expect(featuresSchema(64).parse({ splines: [], ponds: [] })).toEqual(emptyFeatures())
  })

  it('clamps tunnel and chamber radii, keeping chamber 0 as none', () => {
    const c = cave({
      radius: 9,
      points: [
        { x: 0, y: 0, z: 0, chamber: 1 },
        { x: 1, y: 0, z: 0, chamber: 40 },
        { x: 2, y: 0, z: 0, chamber: 0 },
      ],
    })
    const parsed = featuresSchema(64).parse(withCaves([c, cave({ id: 'c2', radius: 0.1 })])).caves
    expect(parsed.map((k) => k.radius)).toEqual([4, 1])
    expect(parsed[0].points.map((p) => p.chamber)).toEqual([3, 12, 0])
  })

  it('clamps per-point radii and widths, and omits them when unset', () => {
    const c = cave({ points: [{ x: 0, y: 0, z: 0, chamber: 0, radius: 99 }, { x: 1, y: 0, z: 0, chamber: 0 }] })
    const sp = path({ points: [{ x: 0, z: 0, width: 99 }, { x: 1, z: 0 }] })
    const parsed = featuresSchema(64).parse({ splines: [sp], ponds: [], caves: [c] })
    expect(parsed.caves[0].points[0].radius).toBe(4)
    expect(parsed.caves[0].points[1]).not.toHaveProperty('radius')
    expect(parsed.splines[0].points[0].width).toBe(8)
    expect(parsed.splines[0].points[1]).not.toHaveProperty('width')
  })

  it.each([
    ['a cave point outside the scene', withCaves([cave({ points: [{ x: 0, y: 0, z: 40, chamber: 0 }, { x: 0, y: 0, z: 0, chamber: 0 }] })])],
    ['a cave point too deep', withCaves([cave({ points: [{ x: 0, y: -33, z: 0, chamber: 0 }, { x: 0, y: 0, z: 0, chamber: 0 }] })])],
    ['a 1-point cave', withCaves([cave({ points: [{ x: 0, y: 0, z: 0, chamber: 0 }] })])],
    ['too many cave points', withCaves([cave({ points: Array.from({ length: FEATURE_LIMITS.maxCavePoints + 1 }, (_, i) => ({ x: 0, y: 0, z: i / 10, chamber: 0 })) })])],
    ['too many caves', withCaves(Array.from({ length: FEATURE_LIMITS.maxCaves + 1 }, (_, i) => cave({ id: `c${i}` })))],
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
