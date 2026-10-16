import { describe, expect, it } from 'vitest'
import { createFlatLayers, heightAt, type Heightmap, type Rect } from '../terrain/layers'
import { carveRect, exclusionRect, profileSpline, SURFACE, type SplineProfile, type SurfaceMap } from './carve'
import { FEATURES, type Spline, type SplinePoint } from './features'
import { nearestOnSamples } from './spline'

const SIZE = 64
const H_RES = SIZE * 2 + 1
const B_RES = SIZE + 1
const FULL: Rect = { x0: 0, z0: 0, x1: H_RES - 1, z1: H_RES - 1 }

/** A 1:4 slope rising towards +x, with gentle noise so smoothing matters. */
function slope(): Heightmap {
  const h = createFlatLayers(SIZE).heights
  for (let j = 0; j < H_RES; j++)
    for (let i = 0; i < H_RES; i++) {
      const x = -SIZE / 2 + i * 0.5
      const z = -SIZE / 2 + j * 0.5
      h.data[j * H_RES + i] = 0.25 * x + 0.3 * Math.sin(x * 0.7) * Math.cos(z * 0.5)
    }
  return h
}

const spline = (kind: Spline['kind'], points: SplinePoint[], width = kind === 'path' ? 3 : 4): Spline => ({
  id: kind,
  kind,
  style: 'dirt',
  width,
  points,
})

const idx = (x: number, z: number) => ((z + SIZE / 2) / 0.5) * H_RES + (x + SIZE / 2) / 0.5

function carve(base: Heightmap, splines: Spline[], rect: Rect = FULL) {
  const profiles = splines.map((s) => profileSpline(base, s))
  const heights = base.data.slice()
  const surface: SurfaceMap = { kind: new Uint8Array(H_RES * H_RES), weight: new Uint8Array(H_RES * H_RES) }
  carveRect(base, profiles, rect, heights, surface)
  return { profiles, heights, surface }
}

/** Linear interpolation of a per-sample profile value at arc length s. */
function at(p: SplineProfile, values: Float32Array, s: number): number {
  const ss = p.samples.s
  let k = 0
  while (k + 2 < ss.length && ss[k + 1] < s) k++
  const t = Math.min(1, Math.max(0, (s - ss[k]) / (ss[k + 1] - ss[k])))
  return values[k] + (values[k + 1] - values[k]) * t
}

const road = spline('path', [
  { x: -20, z: 0 },
  { x: 20, z: 0 },
])

describe('path carving', () => {
  it('is flat across the path width', () => {
    const base = slope()
    const { heights } = carve(base, [road])
    for (let x = -18; x <= 18; x += 0.5) {
      const centre = heights[idx(x, 0)]
      for (let z = -1; z <= 1; z += 0.5) expect(heights[idx(x, z)]).toBeCloseTo(centre, 3)
    }
  })

  it('follows the smoothed grade along the centreline', () => {
    const base = slope()
    const { profiles, heights } = carve(base, [road])
    for (let x = -18; x <= 18; x += 2) expect(heights[idx(x, 0)]).toBeCloseTo(at(profiles[0], profiles[0].grade, x + 20), 3)
  })

  it('leaves the base untouched beyond the shoulder', () => {
    const base = slope()
    const { heights } = carve(base, [road])
    const reach = 1.5 + FEATURES.path.shoulder
    for (let j = 0; j < H_RES; j++)
      for (let i = 0; i < H_RES; i++) {
        const x = -SIZE / 2 + i * 0.5
        const z = -SIZE / 2 + j * 0.5
        const outside = Math.abs(z) > reach || x < -20 - reach || x > 20 + reach
        if (outside) expect(heights[j * H_RES + i]).toBe(base.data[j * H_RES + i])
      }
  })

  it('matches the base height at both ends', () => {
    const base = slope()
    const p = profileSpline(base, road)
    expect(p.grade[0]).toBeCloseTo(heightAt(base, -20, 0), 5)
    expect(p.grade[p.grade.length - 1]).toBeCloseTo(heightAt(base, 20, 0), 5)
  })

  it('paints the path then a verge band', () => {
    const { surface } = carve(slope(), [road])
    expect([surface.kind[idx(0, 0)], surface.weight[idx(0, 0)]]).toEqual([SURFACE.dirt, 255])
    expect([surface.kind[idx(0, 2)], surface.weight[idx(0, 2)]]).toEqual([SURFACE.verge, 255])
    expect(surface.weight[idx(0, 3)]).toBe(0)
    const cobble = carve(slope(), [{ ...road, style: 'cobble' }]).surface
    expect(cobble.kind[idx(0, 0)]).toBe(SURFACE.cobble)
  })
})

describe('river carving', () => {
  const downhill = spline('river', [
    { x: 20, z: 5 },
    { x: 0, z: -5 },
    { x: -20, z: 5 },
  ])
  const uphill = { ...downhill, points: [...downhill.points].reverse() }

  const nonIncreasing = (a: Float32Array) => a.every((v, i) => i === 0 || v <= a[i - 1])
  const nonDecreasing = (a: Float32Array) => a.every((v, i) => i === 0 || v >= a[i - 1])

  it('flows downhill only, whichever way it was drawn', () => {
    const base = slope()
    const down = profileSpline(base, downhill)
    expect(nonIncreasing(down.water!)).toBe(true)
    const up = profileSpline(base, uphill)
    expect(nonDecreasing(up.water!)).toBe(true)
    expect(up.water![up.water!.length - 1]).toBeGreaterThan(up.water![0])
  })

  it('keeps water below the bank by the freeboard', () => {
    const p = profileSpline(slope(), downhill)
    for (let i = 0; i < p.grade.length; i++) expect(p.water![i]).toBeCloseTo(p.grade[i] - FEATURES.river.freeboard, 5)
  })

  it('cuts the bed one depth below the water at the centre', () => {
    const base = slope()
    const straight = spline('river', [
      { x: 20, z: 0 },
      { x: -20, z: 0 },
    ])
    const { profiles, heights } = carve(base, [straight])
    const depth = Math.min(FEATURES.river.maxDepth, Math.max(FEATURES.river.minDepth, 4 * FEATURES.river.depthRatio))
    for (let x = -16; x <= 16; x += 4) expect(heights[idx(x, 0)]).toBeCloseTo(at(profiles[0], profiles[0].water!, 20 - x) - depth, 3)
  })

  it('only ever lowers the ground', () => {
    const base = slope()
    const { heights } = carve(base, [downhill])
    for (let i = 0; i < heights.length; i++) expect(heights[i]).toBeLessThanOrEqual(base.data[i])
  })

  it('paints the bed across its width', () => {
    const { surface } = carve(slope(), [spline('river', [{ x: 20, z: 0 }, { x: -20, z: 0 }])])
    expect(surface.kind[idx(0, 1.5)]).toBe(SURFACE.bed)
    expect(surface.weight[idx(0, 3)]).toBe(0)
  })

  it('cuts through a road where they cross', () => {
    const base = slope()
    const river = spline('river', [
      { x: 0, z: -20 },
      { x: 0.5, z: 20 },
    ])
    const both = carve(base, [river, road])
    const riverOnly = carve(base, [river])
    expect(both.heights[idx(0, 0)]).toBe(riverOnly.heights[idx(0, 0)])
    expect(both.surface.kind[idx(0, 0)]).toBe(SURFACE.bed)
  })
})

describe('carveRect', () => {
  it('gives the same bytes in quadrants as in one pass', () => {
    const base = slope()
    const splines = [
      road,
      spline('river', [
        { x: -25, z: -25 },
        { x: 3, z: 2 },
        { x: 25, z: 20 },
      ]),
    ]
    const whole = carve(base, splines)
    const profiles = splines.map((s) => profileSpline(base, s))
    const heights = new Float32Array(H_RES * H_RES)
    const surface: SurfaceMap = { kind: new Uint8Array(H_RES * H_RES), weight: new Uint8Array(H_RES * H_RES) }
    const m = 64
    for (const r of [
      { x0: 0, z0: 0, x1: m, z1: m },
      { x0: m + 1, z0: 0, x1: H_RES - 1, z1: m },
      { x0: 0, z0: m + 1, x1: m, z1: H_RES - 1 },
      { x0: m + 1, z0: m + 1, x1: H_RES - 1, z1: H_RES - 1 },
    ])
      carveRect(base, profiles, r, heights, surface)
    expect(heights).toEqual(whole.heights)
    expect(surface.kind).toEqual(whole.surface.kind)
    expect(surface.weight).toEqual(whole.surface.weight)
  })

  it('writes only inside its rect', () => {
    const base = slope()
    const profiles = [profileSpline(base, road)]
    const heights = new Float32Array(H_RES * H_RES).fill(99)
    const surface: SurfaceMap = { kind: new Uint8Array(H_RES * H_RES), weight: new Uint8Array(H_RES * H_RES) }
    carveRect(base, profiles, { x0: 10, z0: 10, x1: 20, z1: 20 }, heights, surface)
    expect(heights[idx(0, 0)]).toBe(99)
    expect(heights[10 * H_RES + 10]).toBe(base.data[10 * H_RES + 10])
  })

  it('treats a zero-length spline as nothing', () => {
    const base = slope()
    const dot = spline('path', [
      { x: 3, z: 3 },
      { x: 3, z: 3 },
    ])
    const { heights, surface } = carve(base, [dot, { ...dot, kind: 'river' }])
    expect(heights).toEqual(base.data)
    expect(surface.weight.every((w) => w === 0)).toBe(true)
  })
})

describe('exclusionRect', () => {
  it('clears scatter within the width plus margin, and no further than 1 m beyond', () => {
    const base = slope()
    const profiles = [profileSpline(base, road)]
    const out = new Uint8Array(B_RES * B_RES)
    exclusionRect(profiles, B_RES, SIZE, { x0: 0, z0: 0, x1: B_RES - 1, z1: B_RES - 1 }, out)
    const reach = 1.5 + FEATURES.path.clearMargin
    for (let j = 0; j < B_RES; j++)
      for (let i = 0; i < B_RES; i++) {
        const x = -SIZE / 2 + i
        const z = -SIZE / 2 + j
        if (Math.abs(x) <= 18 && Math.abs(z) <= reach) expect(out[j * B_RES + i]).toBe(1)
        if (Math.abs(z) > reach + 1) expect(out[j * B_RES + i]).toBe(0)
      }
  })

  it('uses the river margin for rivers', () => {
    const profiles = [profileSpline(slope(), spline('river', [{ x: 20, z: 0 }, { x: -20, z: 0 }]))]
    const out = new Uint8Array(B_RES * B_RES)
    exclusionRect(profiles, B_RES, SIZE, { x0: 0, z0: 0, x1: B_RES - 1, z1: B_RES - 1 }, out)
    const edge = Math.floor(2 + FEATURES.river.clearMargin)
    expect(out[(edge + SIZE / 2) * B_RES + SIZE / 2]).toBe(1)
    expect(out[(edge + 2 + SIZE / 2) * B_RES + SIZE / 2]).toBe(0)
  })

  it('marks the nearest sample of every point within the width plus margin, as scatter looks it up', () => {
    const diagonal = spline('path', [{ x: -24, z: -20 }, { x: 0, z: 3 }, { x: 24, z: 22 }])
    const p = profileSpline(slope(), diagonal)
    const out = new Uint8Array(B_RES * B_RES)
    exclusionRect([p], B_RES, SIZE, { x0: 0, z0: 0, x1: B_RES - 1, z1: B_RES - 1 }, out)
    const reach = diagonal.width / 2 + FEATURES.path.clearMargin
    for (let z = -28; z <= 28; z += 0.1)
      for (let x = -28; x <= 28; x += 0.1) {
        if (nearestOnSamples(p.samples, x, z).distance > reach) continue
        expect(out[Math.round(z + SIZE / 2) * B_RES + Math.round(x + SIZE / 2)]).toBe(1)
      }
  })

  it('clears its rect first', () => {
    const out = new Uint8Array(B_RES * B_RES).fill(1)
    exclusionRect([], B_RES, SIZE, { x0: 0, z0: 0, x1: 3, z1: 3 }, out)
    expect(out[0]).toBe(0)
    expect(out[4]).toBe(1)
  })
})
