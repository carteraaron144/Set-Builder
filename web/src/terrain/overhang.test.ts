import { describe, expect, it } from 'vitest'
import type { SurfaceMap } from '../features/carve'
import { chunksForHeightRect } from './chunks'
import { createFlatLayers, HEIGHT_SPACING, heightAt, type TerrainLayers } from './layers'
import { buildOverhangGeometry } from './overhang'
import { DEFAULT_PALETTE } from './palette'

const SIZE = 64
const RES = SIZE * 2 + 1
/** The cliff top's last sample: x = -32 + 0.5·30 = -17. */
const EDGE_I = 30
const EDGE_X = -SIZE / 2 + EDGE_I * HEIGHT_SPACING
const TOP = 10

/** A 10 m step running along z, high ground on −x, with the cliff face between samples 30 and 31. */
function cliff(): TerrainLayers {
  const l = createFlatLayers(SIZE)
  for (let j = 0; j < RES; j++) for (let i = 0; i <= EDGE_I; i++) l.heights.data[j * RES + i] = TOP
  return l
}

const vertices = (p: Float32Array) => Array.from({ length: p.length / 3 }, (_, k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]])

describe('buildOverhangGeometry', () => {
  it('adds nothing on flat ground', () => {
    const g = buildOverhangGeometry(createFlatLayers(SIZE), 0, DEFAULT_PALETTE)
    expect(g.positions.length).toBe(0)
    expect(g.indices.length).toBe(0)
  })

  it('hangs a lip over a grassy cliff, flush with the grass and dropping below it', () => {
    const g = buildOverhangGeometry(cliff(), 0, DEFAULT_PALETTE)
    const v = vertices(g.positions)
    expect(v.length).toBeGreaterThan(0)
    expect(g.colors.length).toBe(g.positions.length)
    // Reaches out past the cliff edge, lies only just over the grass, and hangs down underneath.
    expect(Math.max(...v.map((p) => p[0]))).toBeGreaterThan(EDGE_X + 0.2)
    expect(Math.max(...v.map((p) => p[1]))).toBeLessThanOrEqual(TOP + 0.05 + 1e-6)
    expect(Math.min(...v.map((p) => p[1]))).toBeLessThan(TOP - 0.25)
    // Its back edge starts on the grass, behind the cliff edge.
    expect(Math.min(...v.map((p) => p[0]))).toBeLessThan(EDGE_X)
  })

  it('meets a sloping top tangentially, hugging the grass where it sits over it', () => {
    // The top falls 20° towards the cliff edge, like the shoulder of a dome.
    const l = cliff()
    const grade = Math.tan((20 * Math.PI) / 180) * HEIGHT_SPACING
    for (let j = 0; j < RES; j++) for (let i = 0; i <= EDGE_I; i++) l.heights.data[j * RES + i] = TOP + (EDGE_I - i) * grade
    const behind = vertices(buildOverhangGeometry(l, 0, DEFAULT_PALETTE).positions).filter((p) => p[0] < EDGE_X - 0.05)
    const gaps = behind.map((p) => p[1] - heightAt(l.heights, p[0], p[2]))
    // The top follows the grass closely rather than cutting in at an angle.
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.08)
    expect(Math.max(...gaps)).toBeGreaterThan(-0.05)
    expect(gaps.filter((g) => g > -0.05).length).toBeGreaterThan(behind.length / 3)
  })

  it('reaches back over every earth-tinted triangle to fully green grass, lying on top of the tint', () => {
    // A dome shoulder steepening towards the cliff: samples 28 and 29 are past 30° and tinted with earth.
    const l = cliff()
    for (let j = 0; j < RES; j++)
      for (let i = 24; i <= EDGE_I; i++) l.heights.data[j * RES + i] = TOP - 0.15 * ((i - 24) * HEIGHT_SPACING) ** 2
    const lastGreenX = EDGE_X - 3 * HEIGHT_SPACING
    const v = vertices(buildOverhangGeometry(l, 0, DEFAULT_PALETTE).positions)
    expect(v.length).toBeGreaterThan(0)
    expect(Math.min(...v.map((p) => p[0]))).toBeLessThanOrEqual(lastGreenX + 1e-6)
    // Over the tinted band (sample 28 onwards, behind the edge) the top sits just above the terrain.
    const tinted = v.filter((p) => p[0] > lastGreenX + 0.6 && p[0] < EDGE_X - 0.1).map((p) => p[1] - heightAt(l.heights, p[0], p[2]))
    expect(Math.max(...tinted)).toBeGreaterThan(0.01)
    expect(Math.max(...tinted)).toBeLessThanOrEqual(0.1)
  })

  it('winds the top faces upwards so they are not culled', () => {
    const g = buildOverhangGeometry(cliff(), 0, DEFAULT_PALETTE)
    const p = g.positions
    let tops = 0
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [g.indices[t] * 3, g.indices[t + 1] * 3, g.indices[t + 2] * 3]
      if (Math.min(p[a + 1], p[b + 1], p[c + 1]) < TOP - 0.15) continue
      // y of (b − a) × (c − a).
      const ny = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2])
      expect(ny).toBeGreaterThan(0)
      tops++
    }
    expect(tops).toBeGreaterThan(0)
  })

  it('skips rocky ground', () => {
    const l = cliff()
    const b = l.biomes.data
    for (let k = 0; k < b.length; k += 4) b.set([0, 0, 255, 0], k)
    expect(buildOverhangGeometry(l, 0, DEFAULT_PALETTE).positions.length).toBe(0)
  })

  it('skips painted surfaces such as paths', () => {
    const surface: SurfaceMap = { kind: new Uint8Array(RES * RES).fill(1), weight: new Uint8Array(RES * RES).fill(255) }
    expect(buildOverhangGeometry(cliff(), 0, DEFAULT_PALETTE, surface).positions.length).toBe(0)
  })

  it('hangs a lip over a 1 m terrace step, which central-difference slopes read as only 45°', () => {
    const l = createFlatLayers(SIZE)
    for (let j = 0; j < RES; j++) for (let i = 0; i <= EDGE_I; i++) l.heights.data[j * RES + i] = 1
    const v = vertices(buildOverhangGeometry(l, 0, DEFAULT_PALETTE).positions)
    expect(v.length).toBeGreaterThan(0)
    // It never hangs below the foot of the step.
    expect(Math.min(...v.filter((p) => p[0] > EDGE_X).map((p) => p[1]))).toBeGreaterThan(0)
  })

  it('skips slopes that are not steep enough to be a cliff', () => {
    const l = createFlatLayers(SIZE)
    const grade = Math.tan((35 * Math.PI) / 180) * HEIGHT_SPACING
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) l.heights.data[j * RES + i] = Math.max(0, EDGE_I - i) * -grade + TOP
    expect(buildOverhangGeometry(l, 0, DEFAULT_PALETTE).positions.length).toBe(0)
  })

  it('meets the neighbouring chunk at the same rim points', () => {
    const l = cliff()
    // Chunks 0 and 2 share the row z = 0.
    const atBorder = (chunk: number) =>
      vertices(buildOverhangGeometry(l, chunk, DEFAULT_PALETTE).positions)
        .filter((p) => Math.abs(p[2]) < 1e-6)
        .map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`)
    const a = new Set(atBorder(0))
    const b = new Set(atBorder(2))
    expect(a.size).toBeGreaterThan(0)
    expect(a).toEqual(b)
  })

  it('is the same every time it is built', () => {
    const a = buildOverhangGeometry(cliff(), 0, DEFAULT_PALETTE)
    const b = buildOverhangGeometry(cliff(), 0, DEFAULT_PALETTE)
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
  })

  it('varies how far the lip drops along the rim', () => {
    const v = vertices(buildOverhangGeometry(cliff(), 0, DEFAULT_PALETTE).positions)
    const lows = new Set(v.filter((p) => p[1] < TOP - 0.2).map((p) => p[1].toFixed(3)))
    expect(lows.size).toBeGreaterThan(3)
  })
})

describe('chunksForHeightRect', () => {
  it('reaches far enough for the overhang to see a cliff five samples away', () => {
    expect(chunksForHeightRect({ x0: 69, z0: 10, x1: 80, z1: 20 }, 64)).toEqual([0, 1])
  })
})
