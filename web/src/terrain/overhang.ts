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
/** Sits the lip's top just under the grass so the two never fight. */
const SINK = 0.02
/** How much the outer edge droops at full size. */
const DROOP = 0.08

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
 * the ground just past it drops away as a cliff. The top starts under the grass and reaches out over the edge;
 * the front hangs down a varying amount and the underside tucks back into the cliff. Rim points sit on lattice
 * edges and depend only on the layers, so neighbouring chunks meet exactly.
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

  // Steepness past the grassline, per corner of the chunk's cells: > 0 is steeper.
  const field = new Float64Array((CELLS + 1) * (CELLS + 1))
  for (let vj = 0; vj <= CELLS; vj++)
    for (let vi = 0; vi <= CELLS; vi++) field[vj * (CELLS + 1) + vi] = slope(ci + vi, cj + vj) - grassline
  const steep = (i: number, j: number) => field[(j - cj) * (CELLS + 1) + (i - ci)] > 0

  const colA = new Float32Array(3)
  const colB = new Float32Array(3)
  const rim = new Map<number, RimPoint | null>()
  /** The rim point on the lattice edge from sample (i, j) towards +x (dir 0) or +z (dir 1). */
  const rimPoint = (i: number, j: number, dir: 0 | 1): RimPoint | null => {
    const id = (j * res + i) * 2 + dir
    const cached = rim.get(id)
    if (cached !== undefined) return cached
    const i2 = i + 1 - dir
    const j2 = j + dir
    const fa = field[(j - cj) * (CELLS + 1) + (i - ci)]
    const fb = field[(j2 - cj) * (CELLS + 1) + (i2 - ci)]
    const t = fa / (fa - fb)
    const lerp = (a: number, b: number) => a + (b - a) * t
    const [gax, gaz] = gradient(i, j)
    const [gbx, gbz] = gradient(i2, j2)
    const gx = lerp(gax, gbx)
    const gz = lerp(gaz, gbz)
    const glen = Math.hypot(gx, gz)
    let point: RimPoint | null = null
    if (glen > 1e-6) {
      const dx = -gx / glen
      const dz = -gz / glen
      const x = -half + lerp(i, i2) * HEIGHT_SPACING
      const z = -half + lerp(j, j2) * HEIGHT_SPACING
      // How sharply the ground falls away within the probe distance past the rim decides whether this is a cliff
      // top. Measured as drop over distance rather than by slope: central differences read a one-sample step as
      // half as steep as it is.
      const y = lerp(h[j * res + i], h[j2 * res + i2])
      let cliff = 0
      let fall = 0
      for (let s = 1; s <= 4; s++) {
        const d = (o.probe * s) / 4
        fall = y - heightAt(heights, x + dx * d, z + dz * d)
        cliff = Math.max(cliff, Math.atan2(fall, d))
      }
      const size = smoothstep(o.cliffStart, o.cliffFull, cliff) * lerp(grass(i, j), grass(i2, j2))
      if (size > 0.05) {
        terrainColorAt(l, i, j, flat, undefined, colA, 0)
        terrainColorAt(l, i2, j2, flat, undefined, colB, 0)
        point = {
          x,
          y,
          z,
          dx,
          dz,
          size,
          // Never hangs past the foot of a short step.
          drop: Math.min(o.dropMin + (o.dropMax - o.dropMin) * hash01(id), 0.6 * fall),
          color: [lerp(colA[0], colB[0]), lerp(colA[1], colB[1]), lerp(colA[2], colB[2])],
        }
      }
    }
    rim.set(id, point)
    return point
  }

  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const under: RGB = [p.earth.color[0] * o.underShade, p.earth.color[1] * o.underShade, p.earth.color[2] * o.underShade]
  /** Appends the four profile vertices of a rim point: top back, top front, front bottom, under back. */
  const profile = (r: RimPoint) => {
    const s = r.size
    const front = r.color.map((c) => c * o.frontShade)
    const verts: [number, number, number, readonly number[]][] = [
      [-o.inset, r.y - SINK, -o.inset, r.color],
      [o.reach * s, r.y - SINK - DROOP * s, o.reach * s, r.color],
      [o.reach * s * 0.75, r.y - r.drop * s, o.reach * s * 0.75, front],
      [-o.inset, r.y - r.drop * s - o.inset, -o.inset, under],
    ]
    for (const [ox, y, oz, c] of verts) {
      positions.push(r.x + r.dx * ox, y, r.z + r.dz * oz)
      colors.push(c[0], c[1], c[2])
    }
  }
  const segment = (r0: RimPoint | null, r1: RimPoint | null) => {
    if (!r0 || !r1) return
    // Wind so the top faces up (and so the front faces out and the underside down).
    const sx = r1.x - r0.x
    const sz = r1.z - r0.z
    if (sz * (r0.dx + r1.dx) - sx * (r0.dz + r1.dz) < 0) [r0, r1] = [r1, r0]
    const base = positions.length / 3
    profile(r0)
    profile(r1)
    for (let k = 0; k < 3; k++) {
      const a0 = base + k
      const b0 = a0 + 1
      const a1 = base + 4 + k
      const b1 = a1 + 1
      indices.push(a0, a1, b1, a0, b1, b0)
    }
  }

  // Marching squares over the chunk's cells. Edges: 0 bottom (+x from i, j), 1 right, 2 top, 3 left.
  const edgeOf = (i: number, j: number, e: number) =>
    e === 0 ? rimPoint(i, j, 0) : e === 1 ? rimPoint(i + 1, j, 1) : e === 2 ? rimPoint(i, j + 1, 0) : rimPoint(i, j, 1)
  /** The two edges next to each corner: 0 (i, j), 1 (i+1, j), 2 (i+1, j+1), 3 (i, j+1). */
  const cornerEdges = [
    [0, 3],
    [0, 1],
    [1, 2],
    [2, 3],
  ]
  for (let j = cj; j < cj + CELLS; j++)
    for (let i = ci; i < ci + CELLS; i++) {
      const c = [steep(i, j), steep(i + 1, j), steep(i + 1, j + 1), steep(i, j + 1)]
      const crossed = [0, 1, 2, 3].filter((e) => c[e] !== c[(e + 1) % 4])
      if (crossed.length === 2) segment(edgeOf(i, j, crossed[0]), edgeOf(i, j, crossed[1]))
      else if (crossed.length === 4) {
        // Saddle: cut off the corners whose side differs from the cell centre's.
        const centre = (field[(j - cj) * (CELLS + 1) + (i - ci)] + field[(j - cj) * (CELLS + 1) + (i + 1 - ci)] +
          field[(j + 1 - cj) * (CELLS + 1) + (i + 1 - ci)] + field[(j + 1 - cj) * (CELLS + 1) + (i - ci)]) > 0
        for (let k = 0; k < 4; k++) if (c[k] !== centre) segment(edgeOf(i, j, cornerEdges[k][0]), edgeOf(i, j, cornerEdges[k][1]))
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
