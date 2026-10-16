import { HEIGHT_SPACING } from '../terrain/layers'
import type { SplineProfile } from './carve'
import { FEATURES } from './features'
import type { Ground } from './ground'
import type { PondFill } from './ponds'

/** One water mesh: a river ribbon or a pond sheet, named as it is exported. */
export interface WaterGeometry {
  name: string
  positions: Float32Array
  indices: Uint32Array
}

/** The one shared water material. */
export const WATER_MATERIAL = { name: 'water', color: FEATURES.water.color, opacity: FEATURES.water.opacity }

/** Rivers first, then ponds, each in feature order; rivers with no length and empty ponds are skipped. */
export function buildWater(ground: Ground): WaterGeometry[] {
  const out: WaterGeometry[] = []
  for (const p of ground.profiles) {
    if (p.spline.kind !== 'river' || !p.footprint || p.samples.xs.length < 2) continue
    out.push({ name: `River ${out.length + 1}`, ...riverRibbon(p) })
  }
  const rivers = out.length
  const { size, resolution } = ground.layers.heights
  for (const fill of ground.ponds) {
    if (!fill.bounds) continue
    out.push({ name: `Pond ${out.length - rivers + 1}`, ...pondSheet(fill, size, resolution) })
  }
  return out
}

/** Two vertices per centreline sample, `width` apart across the tangent, at the water surface. */
function riverRibbon(p: SplineProfile): Omit<WaterGeometry, 'name'> {
  const { xs, zs } = p.samples
  const n = xs.length
  const positions = new Float32Array(n * 6)
  let tx = 1
  let tz = 0
  for (let k = 0; k < n; k++) {
    const dx = xs[Math.min(n - 1, k + 1)] - xs[Math.max(0, k - 1)]
    const dz = zs[Math.min(n - 1, k + 1)] - zs[Math.max(0, k - 1)]
    const len = Math.hypot(dx, dz)
    // Keep the last good tangent where samples coincide.
    if (len > 1e-9) {
      tx = dx / len
      tz = dz / len
    }
    // (tz, −tx) is to the right of the flow; this order makes the triangles below face up.
    const y = p.water![k]
    const hw = p.samples.widths[k] / 2
    positions.set([xs[k] - tz * hw, y, zs[k] + tx * hw, xs[k] + tz * hw, y, zs[k] - tx * hw], k * 6)
  }
  const indices = new Uint32Array((n - 1) * 6)
  for (let k = 0; k + 1 < n; k++) {
    const a = 2 * k
    const b = a + 1
    indices.set([a, a + 2, b, b, a + 2, b + 2], k * 6)
  }
  return { positions, indices }
}

/** One flat quad per height cell with any corner flooded, at the pond's level; corners are shared. */
function pondSheet(fill: PondFill, size: number, res: number): Omit<WaterGeometry, 'name'> {
  const b = fill.bounds!
  const half = size / 2
  // Cells (i, j) span samples i..i+1 and j..j+1; those touching a flooded sample start one sample before it.
  const ci0 = Math.max(0, b.x0 - 1)
  const cj0 = Math.max(0, b.z0 - 1)
  const ci1 = Math.min(res - 2, b.x1)
  const cj1 = Math.min(res - 2, b.z1)
  const w = ci1 - ci0 + 2
  const vertexOf = new Int32Array(w * (cj1 - cj0 + 2)).fill(-1)
  const positions: number[] = []
  const indices: number[] = []
  const vertex = (i: number, j: number) => {
    const l = (j - cj0) * w + (i - ci0)
    if (vertexOf[l] < 0) {
      vertexOf[l] = positions.length / 3
      positions.push(-half + i * HEIGHT_SPACING, fill.level, -half + j * HEIGHT_SPACING)
    }
    return vertexOf[l]
  }
  const m = fill.mask
  for (let j = cj0; j <= cj1; j++)
    for (let i = ci0; i <= ci1; i++) {
      const s = j * res + i
      if (!(m[s] || m[s + 1] || m[s + res] || m[s + res + 1])) continue
      // Same winding as the terrain chunks: counter-clockwise seen from above.
      const a = vertex(i, j)
      const bb = vertex(i, j + 1)
      const c = vertex(i + 1, j)
      const d = vertex(i + 1, j + 1)
      indices.push(a, bb, c, c, bb, d)
    }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
