import type { SceneSize } from '../scene/scene'
import { CHUNK_VERTS, chunkCount } from './chunks'
import { HEIGHT_SPACING } from './layers'

/** Solid density at height sample (i, j) and world height y: > 0 is solid, ≤ 0 is air. */
export type DensityAt = (i: number, j: number, y: number) => number

/** A chunk surface meshed from a density field, with where each vertex sits on the lattice (for colours). */
export interface SdfMesh {
  positions: Float32Array
  indices: Uint32Array
  /** Height-sample index (j·res + i) of each vertex's edge ends; equal for vertical edges. */
  edgeA: Uint32Array
  edgeB: Uint32Array
  /** How far along A→B the vertex is. */
  t: Float32Array
}

const CELLS = CHUNK_VERTS - 1

/**
 * Six tetrahedra around the cube diagonal 0→7, as corner numbers with bit 1 = +x, 2 = +y, 4 = +z. Every cube
 * splits the same way, so neighbouring cubes (and chunks) agree on every shared face.
 */
const TETS = [
  [0, 1, 3, 7],
  [0, 1, 5, 7],
  [0, 2, 3, 7],
  [0, 2, 6, 7],
  [0, 4, 5, 7],
  [0, 4, 6, 7],
]

/**
 * Meshes chunk `chunk` of a scene by marching tetrahedra on the height-sample lattice, with y levels every
 * 0.5 m from y0 to y1 (both snapped outward to 0.5 m). The field must be solid at y0 and air at y1.
 */
export function meshSdfChunk(size: SceneSize, chunk: number, density: DensityAt, y0: number, y1: number): SdfMesh {
  const res = size * 2 + 1
  const n = chunkCount(size)
  const ci = (chunk % n) * CELLS
  const cj = Math.floor(chunk / n) * CELLS
  const half = size / 2
  const yBase = Math.floor(y0 / HEIGHT_SPACING) * HEIGHT_SPACING
  const levels = Math.ceil((y1 - yBase) / HEIGHT_SPACING) + 1
  const V = CHUNK_VERTS
  const yAt = (k: number) => yBase + k * HEIGHT_SPACING

  // Density on every lattice point; exact zeros count as air so a crossing never lands on a corner.
  const field = new Float64Array(V * V * levels)
  for (let k = 0; k < levels; k++) {
    const y = yAt(k)
    for (let vj = 0; vj < V; vj++)
      for (let vi = 0; vi < V; vi++) {
        const d = density(ci + vi, cj + vj, y)
        field[(k * V + vj) * V + vi] = d === 0 ? -1e-9 : d
      }
  }

  const positions: number[] = []
  const edgeA: number[] = []
  const edgeB: number[] = []
  const ts: number[] = []
  const indices: number[] = []
  // A vertex per lattice edge, found by the edge's lower grid point and its direction (one of 7 offsets).
  const welded = new Int32Array(V * V * levels * 7).fill(-1)

  /** The vertex on the edge between grid point a and a + EDGE_OFFSET[dir]; made once per edge. */
  const vertex = (a: number, b: number): number => {
    if (a > b) [a, b] = [b, a]
    const slot = a * 7 + DIR_OF[b - a + DIR_BIAS]
    const known = welded[slot]
    if (known >= 0) return known
    const fa = field[a]
    const fb = field[b]
    const t = fa / (fa - fb)
    const ai = a % V
    const aj = Math.floor(a / V) % V
    const ak = Math.floor(a / (V * V))
    const bi = b % V
    const bj = Math.floor(b / V) % V
    const bk = Math.floor(b / (V * V))
    const xa = -half + (ci + ai) * HEIGHT_SPACING
    const za = -half + (cj + aj) * HEIGHT_SPACING
    const ya = yAt(ak)
    positions.push(
      xa + t * (-half + (ci + bi) * HEIGHT_SPACING - xa),
      ya + t * (yAt(bk) - ya),
      za + t * (-half + (cj + bj) * HEIGHT_SPACING - za),
    )
    edgeA.push((cj + aj) * res + ci + ai)
    edgeB.push((cj + bj) * res + ci + bi)
    ts.push(t)
    const id = ts.length - 1
    welded[slot] = id
    return id
  }

  /** Emits triangle (a, b, c) wound so its normal points along (dx, dy, dz), from solid towards air. */
  const emit = (a: number, b: number, c: number, dx: number, dy: number, dz: number) => {
    const pa = a * 3
    const pb = b * 3
    const pc = c * 3
    const ux = positions[pb] - positions[pa]
    const uy = positions[pb + 1] - positions[pa + 1]
    const uz = positions[pb + 2] - positions[pa + 2]
    const vx = positions[pc] - positions[pa]
    const vy = positions[pc + 1] - positions[pa + 1]
    const vz = positions[pc + 2] - positions[pa + 2]
    const dot = (uy * vz - uz * vy) * dx + (uz * vx - ux * vz) * dy + (ux * vy - uy * vx) * dz
    if (dot < 0) indices.push(a, c, b)
    else indices.push(a, b, c)
  }

  // Corner c of the cube at grid point g0 is g0 + offset[c].
  const offset = Array.from({ length: 8 }, (_, c) => (c & 1) + ((c >> 2) & 1) * V + ((c >> 1) & 1) * V * V)
  const DIR_BIAS = V * V + V + 1
  const DIR_OF = new Int8Array(2 * DIR_BIAS + 1).fill(-1)
  ;[1, V, V * V, 1 + V, 1 + V * V, V + V * V, 1 + V + V * V].forEach((d, i) => (DIR_OF[d + DIR_BIAS] = i))
  const solid = [0, 0, 0, 0]
  const air = [0, 0, 0, 0]

  for (let k = 0; k + 1 < levels; k++)
    for (let vj = 0; vj < CELLS; vj++)
      for (let vi = 0; vi < CELLS; vi++) {
        const g0 = (k * V + vj) * V + vi
        let solidCount = 0
        for (let c = 0; c < 8; c++) if (field[g0 + offset[c]] > 0) solidCount++
        if (solidCount === 0 || solidCount === 8) continue
        for (const tet of TETS) {
          let ns = 0
          let na = 0
          // Corner sums in cube units (x = bit 1, y = bit 2, z = bit 4), for the solid → air direction.
          let sx = 0
          let sy = 0
          let sz = 0
          let ax = 0
          let ay = 0
          let az = 0
          for (const c of tet) {
            const g = g0 + offset[c]
            if (field[g] > 0) {
              solid[ns++] = g
              sx += c & 1
              sy += (c >> 1) & 1
              sz += (c >> 2) & 1
            } else {
              air[na++] = g
              ax += c & 1
              ay += (c >> 1) & 1
              az += (c >> 2) & 1
            }
          }
          if (ns === 0 || na === 0) continue
          const dx = ax / na - sx / ns
          const dy = ay / na - sy / ns
          const dz = az / na - sz / ns
          if (ns === 1) emit(vertex(solid[0], air[0]), vertex(solid[0], air[1]), vertex(solid[0], air[2]), dx, dy, dz)
          else if (na === 1) emit(vertex(air[0], solid[0]), vertex(air[0], solid[1]), vertex(air[0], solid[2]), dx, dy, dz)
          else {
            // Two and two: a quad through the four crossing edges, as two triangles.
            const q0 = vertex(solid[0], air[0])
            const q1 = vertex(solid[0], air[1])
            const q2 = vertex(solid[1], air[1])
            const q3 = vertex(solid[1], air[0])
            emit(q0, q1, q2, dx, dy, dz)
            emit(q0, q2, q3, dx, dy, dz)
          }
        }
      }

  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    edgeA: Uint32Array.from(edgeA),
    edgeB: Uint32Array.from(edgeB),
    t: Float32Array.from(ts),
  }
}
