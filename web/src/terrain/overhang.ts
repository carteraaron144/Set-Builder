import type { SurfaceMap } from '../features/carve'
import data from './biomes.json'
import { CHUNK_VERTS, chunkCount, terrainColorAt, type ChunkGeometry } from './chunks'
import { HEIGHT_SPACING, heightAt, type TerrainLayers } from './layers'
import type { RGB, TerrainPalette } from './palette'

/** Grass lips hung over cliff tops; lengths in metres. */
export interface OverhangSettings {
  /** Steepness (radians) of the fall just past the grassline at which lips start to grow, and are full size. */
  cliffStart: number
  cliffFull: number
  /** How far past the grassline to look for that fall. At most 1 m: chunksForHeightRect allows no more. */
  probe: number
  /** How far back over the grass the lip's top starts, and how far out over the cliff it reaches. */
  inset: number
  reach: number
  /** How far the lip's front hangs below the grass, picked per rim point between these. */
  dropMin: number
  dropMax: number
  /** Brightness of the front's lower edge (of the grass colour) and the underside (of the earth colour). */
  frontShade: number
  underShade: number
}

const deg = Math.PI / 180
const json = data.overhang
export const DEFAULT_OVERHANG: OverhangSettings = {
  ...json,
  cliffStart: json.cliffStartDeg * deg,
  cliffFull: json.cliffFullDeg * deg,
}

const CELLS = CHUNK_VERTS - 1
/** How far over the terrain the lip lies at the rim, covering the earth-tinted grass behind it. */
const LIFT = 0.05
/** How much the outer edge droops at full size, below the line tangent to the grass. */
const DROOP = 0.12
/** How far behind the rim the grass's slope is measured. */
const TANGENT_BACK = 0.5
/** How far behind the rim the lip may reach to cover earth-tinted grass, and how far past the last tint it goes. */
const MAX_BACK = 1.5
const BACK_MARGIN = 0.15
/** Past `back` the top dips under the grass, out to this many times `back`. */
const CLIP = 1.25
/**
 * Smoothing passes along the rim, each averaging a point halfway towards its two neighbours. A chunk smooths a
 * margin one cell wider than this around itself, so its rim points match its neighbours'. With the 5 samples the
 * lip reads around a rim point, chunksForHeightRect must allow for 11.
 */
const SMOOTH_PASSES = 6
const MARGIN = SMOOTH_PASSES + 1
/**
 * Vertices per rim point: the top (dipping under the grass, over the tint, at the rim and three out to the outer
 * edge), then the front's lower edge and the underside's back edge.
 */
const PROFILE = 8

interface RimPoint {
  x: number
  y: number
  z: number
  /** Outward (downhill) unit direction. */
  dx: number
  dz: number
  /** 0..1: how big the lip is here, from how steep the cliff past it is and how grassy the ground is. */
  size: number
  drop: number
  color: RGB
  /** How far behind the rim the top covers the grass: far enough to cover all the earth-tinted grass. */
  back: number
  /** The grass's slope along d just behind the rim (never rising), which the top leaves the rim along. */
  tangent: number
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/**
 * Grass lips for chunk `chunk`: a wedge swept along the grassline (the middle of the earth slope band) wherever
 * the ground just past it drops away as a cliff. The rim is traced with marching squares and smoothed along its
 * length, so grid steps round off. The top dips out of the green grass, covers the earth-tinted band and reaches
 * out over the edge; the front hangs down a varying amount and the underside tucks back into the cliff. Rim
 * points depend only on the layers, so neighbouring chunks meet exactly.
 */
export function buildOverhangGeometry(
  l: TerrainLayers,
  chunk: number,
  p: TerrainPalette,
  surface?: SurfaceMap,
  o: OverhangSettings = DEFAULT_OVERHANG,
): ChunkGeometry {
  const { heights, biomes } = l
  const res = heights.resolution
  const h = heights.data
  const half = heights.size / 2
  const n = chunkCount(heights.size)
  const ci = (chunk % n) * CELLS
  const cj = Math.floor(chunk / n) * CELLS
  const grassline = (p.earth.start + p.earth.full) / 2
  // Biome colours alone: slopes past these never happen.
  const flat: TerrainPalette = { ...p, earth: { ...p.earth, start: 10, full: 11 }, rock: { ...p.rock, start: 10, full: 11 } }

  const clamp = (k: number) => Math.min(res - 1, Math.max(0, k))
  const gradient = (i: number, j: number): [number, number] => {
    const il = clamp(i - 1)
    const ir = clamp(i + 1)
    const jd = clamp(j - 1)
    const ju = clamp(j + 1)
    return [(h[j * res + ir] - h[j * res + il]) / ((ir - il) * HEIGHT_SPACING), (h[ju * res + i] - h[jd * res + i]) / ((ju - jd) * HEIGHT_SPACING)]
  }
  const slope = (i: number, j: number) => Math.atan(Math.hypot(...gradient(i, j)))
  /** How much earth tints the terrain colour at world (x, z), as the mesh's colours interpolate it. */
  const earthAtWorld = (x: number, z: number) => {
    const fi = Math.min(res - 1, Math.max(0, (x + half) / HEIGHT_SPACING))
    const fj = Math.min(res - 1, Math.max(0, (z + half) / HEIGHT_SPACING))
    const i0 = Math.min(res - 2, Math.floor(fi))
    const j0 = Math.min(res - 2, Math.floor(fj))
    const tx = fi - i0
    const tz = fj - j0
    const e = (i: number, j: number) => smoothstep(p.earth.start, p.earth.full, slope(i, j))
    return (e(i0, j0) * (1 - tx) + e(i0 + 1, j0) * tx) * (1 - tz) + (e(i0, j0 + 1) * (1 - tx) + e(i0 + 1, j0 + 1) * tx) * tz
  }
  /** 1 on grass, 0 on the rocky biome or a painted surface. */
  const grass = (i: number, j: number) => {
    const bRes = biomes.resolution
    const bi0 = Math.min(bRes - 1, i >> 1)
    const bj0 = Math.min(bRes - 1, j >> 1)
    const bi1 = Math.min(bRes - 1, bi0 + (i & 1))
    const bj1 = Math.min(bRes - 1, bj0 + (j & 1))
    const b = biomes.data
    const rocky = (b[(bj0 * bRes + bi0) * 4 + 2] + b[(bj0 * bRes + bi1) * 4 + 2] + b[(bj1 * bRes + bi0) * 4 + 2] + b[(bj1 * bRes + bi1) * 4 + 2]) / 4 / 255
    const painted = surface ? surface.weight[j * res + i] / 255 : 0
    return (1 - rocky) * (1 - painted)
  }

  // The chunk's cells plus the smoothing margin, as corner (sample) ranges.
  const i0 = Math.max(0, ci - MARGIN)
  const j0 = Math.max(0, cj - MARGIN)
  const i1 = Math.min(res - 1, ci + CELLS + MARGIN)
  const j1 = Math.min(res - 1, cj + CELLS + MARGIN)
  const W = i1 - i0 + 1
  // Steepness past the grassline, per corner: > 0 is steeper.
  const field = new Float64Array(W * (j1 - j0 + 1))
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) field[(j - j0) * W + (i - i0)] = slope(i, j) - grassline
  const fieldAt = (i: number, j: number) => field[(j - j0) * W + (i - i0)]

  // Rim points as parallel arrays, one per lattice edge the grassline crosses, linked to their neighbours.
  const px: number[] = []
  const py: number[] = []
  const pz: number[] = []
  const pdx: number[] = []
  const pdz: number[] = []
  const psize: number[] = []
  const pdrop: number[] = []
  const pcolor: RGB[] = []
  const links: number[][] = []
  const index = new Map<number, number>()
  const colA = new Float32Array(3)
  const colB = new Float32Array(3)
  /** The rim point on the lattice edge from sample (i, j) towards +x (dir 0) or +z (dir 1). */
  const rimPoint = (i: number, j: number, dir: 0 | 1): number => {
    const id = (j * res + i) * 2 + dir
    const cached = index.get(id)
    if (cached !== undefined) return cached
    const i2 = i + 1 - dir
    const j2 = j + dir
    const fa = fieldAt(i, j)
    const t = fa / (fa - fieldAt(i2, j2))
    const lerp = (a: number, b: number) => a + (b - a) * t
    const [gax, gaz] = gradient(i, j)
    const [gbx, gbz] = gradient(i2, j2)
    const gx = lerp(gax, gbx)
    const gz = lerp(gaz, gbz)
    const glen = Math.hypot(gx, gz)
    const dx = glen > 1e-6 ? -gx / glen : 0
    const dz = glen > 1e-6 ? -gz / glen : 0
    const x = -half + lerp(i, i2) * HEIGHT_SPACING
    const z = -half + lerp(j, j2) * HEIGHT_SPACING
    const y = lerp(h[j * res + i], h[j2 * res + i2])
    // How sharply the ground falls away within the probe distance past the rim decides whether this is a cliff
    // top. Measured as drop over distance rather than by slope: central differences read a one-sample step as
    // half as steep as it is.
    let cliff = 0
    let fall = 0
    for (let s = 1; s <= 4; s++) {
      const d = (o.probe * s) / 4
      fall = y - heightAt(heights, x + dx * d, z + dz * d)
      cliff = Math.max(cliff, Math.atan2(fall, d))
    }
    terrainColorAt(l, i, j, flat, undefined, colA, 0)
    terrainColorAt(l, i2, j2, flat, undefined, colB, 0)
    const k = px.length
    px.push(x)
    py.push(y)
    pz.push(z)
    pdx.push(dx)
    pdz.push(dz)
    psize.push(glen > 1e-6 ? smoothstep(o.cliffStart, o.cliffFull, cliff) * lerp(grass(i, j), grass(i2, j2)) : 0)
    // Never hangs past the foot of a short step.
    pdrop.push(Math.max(0, Math.min(o.dropMin + (o.dropMax - o.dropMin) * hash01(id), 0.6 * fall)))
    pcolor.push([lerp(colA[0], colB[0]), lerp(colA[1], colB[1]), lerp(colA[2], colB[2])])
    links.push([])
    index.set(id, k)
    return k
  }

  // Marching squares over the region's cells. Edges: 0 bottom (+x from i, j), 1 right, 2 top, 3 left.
  const edgeOf = (i: number, j: number, e: number) =>
    e === 0 ? rimPoint(i, j, 0) : e === 1 ? rimPoint(i + 1, j, 1) : e === 2 ? rimPoint(i, j + 1, 0) : rimPoint(i, j, 1)
  /** The two edges next to each corner: 0 (i, j), 1 (i+1, j), 2 (i+1, j+1), 3 (i, j+1). */
  const cornerEdges = [
    [0, 3],
    [0, 1],
    [1, 2],
    [2, 3],
  ]
  /** Rim segments in the chunk's own cells, which are the only ones it draws. */
  const own: [number, number][] = []
  const link = (i: number, j: number, ea: number, eb: number) => {
    const a = edgeOf(i, j, ea)
    const b = edgeOf(i, j, eb)
    links[a].push(b)
    links[b].push(a)
    if (i >= ci && i < ci + CELLS && j >= cj && j < cj + CELLS) own.push([a, b])
  }
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      const c = [fieldAt(i, j) > 0, fieldAt(i + 1, j) > 0, fieldAt(i + 1, j + 1) > 0, fieldAt(i, j + 1) > 0]
      const crossed = [0, 1, 2, 3].filter((e) => c[e] !== c[(e + 1) % 4])
      if (crossed.length === 2) link(i, j, crossed[0], crossed[1])
      else if (crossed.length === 4) {
        // Saddle: cut off the corners whose side differs from the cell centre's.
        const centre = fieldAt(i, j) + fieldAt(i + 1, j) + fieldAt(i + 1, j + 1) + fieldAt(i, j + 1) > 0
        for (let k = 0; k < 4; k++) if (c[k] !== centre) link(i, j, cornerEdges[k][0], cornerEdges[k][1])
      }
    }
  if (own.length === 0) return { positions: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) }

  // Smooth position, height, direction and size along the rim, each point moving halfway to its neighbours' mean.
  const channels = [px, py, pz, pdx, pdz, psize]
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next = channels.map((ch) =>
      ch.map((v, k) => {
        const ns = links[k]
        let sum = 0
        for (const m of ns) sum += ch[m]
        return ns.length > 0 ? (v + sum / ns.length) / 2 : v
      }),
    )
    next.forEach((ch, c) => ch.forEach((v, k) => (channels[c][k] = v)))
  }

  const rim = new Map<number, RimPoint>()
  const rimAt = (k: number): RimPoint => {
    const cached = rim.get(k)
    if (cached) return cached
    const len = Math.hypot(pdx[k], pdz[k])
    const dx = len > 1e-6 ? pdx[k] / len : 0
    const dz = len > 1e-6 ? pdz[k] / len : 0
    const [x, y, z] = [px[k], py[k], pz[k]]
    // Back from the rim until the terrain is fully green, so no earth tint shows behind the lip.
    let back = o.inset
    for (let b = 0; b < MAX_BACK; b += 0.05)
      if (earthAtWorld(x - dx * b, z - dz * b) > 0.005) back = Math.max(back, Math.min(MAX_BACK, b + BACK_MARGIN))
    const r: RimPoint = {
      x,
      y,
      z,
      dx,
      dz,
      size: len > 1e-6 ? psize[k] : 0,
      drop: pdrop[k],
      color: pcolor[k],
      back,
      tangent: Math.min(0, (y - heightAt(heights, x - dx * TANGENT_BACK, z - dz * TANGENT_BACK)) / TANGENT_BACK),
    }
    rim.set(k, r)
    return r
  }

  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const under: RGB = [p.earth.color[0] * o.underShade, p.earth.color[1] * o.underShade, p.earth.color[2] * o.underShade]
  /**
   * Appends the profile vertices of a rim point: the top dipping out of the green grass, lying just over the
   * earth-tinted band, then leaving the rim along the grass's slope and drooping to the outer edge; then the
   * front's lower edge and the underside's back edge, tucked into the ground under the grass.
   */
  const profile = (r: RimPoint) => {
    const size = r.size
    const reach = Math.max(1e-3, o.reach * size)
    const curve = (s: number) => r.y + LIFT + r.tangent * s - DROOP * size * (s / reach) ** 2
    /** Pushes the vertex at distance s out from the rim (negative: behind it). */
    const push = (s: number, y: number, c: readonly number[]) => {
      positions.push(r.x + r.dx * s, y, r.z + r.dz * s)
      colors.push(c[0], c[1], c[2])
    }
    // Behind the rim the top lies LIFT over the grass at the rim, easing to meet it at `back` and under it beyond.
    for (const f of [CLIP, 0.6]) {
      const s = -r.back * f
      push(s, heightAt(heights, r.x + r.dx * s, r.z + r.dz * s) + LIFT * (1 - f * f), r.color)
    }
    for (let k = 0; k <= 3; k++) push((reach * k) / 3, curve((reach * k) / 3), r.color)
    const yFront = curve(reach * 0.75) - r.drop * size
    push(reach * 0.75, yFront, r.color.map((c) => c * o.frontShade))
    push(-o.inset, yFront - o.inset, under)
  }
  for (const [a, b] of own) {
    let r0 = rimAt(a)
    let r1 = rimAt(b)
    if (r0.size <= 0.05 && r1.size <= 0.05) continue
    // Wind so the top faces up (and so the front faces out and the underside down).
    const sx = r1.x - r0.x
    const sz = r1.z - r0.z
    if (sz * (r0.dx + r1.dx) - sx * (r0.dz + r1.dz) < 0) [r0, r1] = [r1, r0]
    const base = positions.length / 3
    profile(r0)
    profile(r1)
    for (let k = 0; k < PROFILE - 1; k++) {
      const a0 = base + k
      const b0 = a0 + 1
      const a1 = base + PROFILE + k
      const b1 = a1 + 1
      indices.push(a0, a1, b1, a0, b1, b0)
    }
  }

  return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint32Array(indices) }
}

/** The chunk's ground with its overhangs appended as one geometry. */
export function withOverhang(ground: ChunkGeometry, lip: ChunkGeometry): ChunkGeometry {
  if (lip.indices.length === 0) return ground
  const base = ground.positions.length / 3
  const positions = new Float32Array(ground.positions.length + lip.positions.length)
  positions.set(ground.positions)
  positions.set(lip.positions, ground.positions.length)
  const colors = new Float32Array(ground.colors.length + lip.colors.length)
  colors.set(ground.colors)
  colors.set(lip.colors, ground.colors.length)
  const indices = new Uint32Array(ground.indices.length + lip.indices.length)
  indices.set(ground.indices)
  for (let k = 0; k < lip.indices.length; k++) indices[ground.indices.length + k] = base + lip.indices[k]
  return { positions, colors, indices }
}
