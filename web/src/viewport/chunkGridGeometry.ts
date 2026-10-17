import { CHUNK_VERTS, chunkCount } from '../terrain/chunks'
import { HEIGHT_SPACING, type Heightmap } from '../terrain/layers'

/** How far above the ground the grid floats, so it isn't buried in the terrain. */
export const GRID_LIFT = 0.1

const CELLS = CHUNK_VERTS - 1

/** Vertices of the grid's line segments: every chunk edge, both ways, one segment per height-sample step. */
export function chunkGridVertexCount(size: number): number {
  const n = chunkCount(size as Parameters<typeof chunkCount>[0])
  return (n + 1) * 2 * (size / HEIGHT_SPACING) * 2
}

/** Line-segment positions of the chunk boundaries, draped on the heightmap. Reuses `out` when it is the right length. */
export function chunkGridPositions(h: Heightmap, out?: Float32Array): Float32Array {
  const { size, resolution: res, data } = h
  const n = size / (CELLS * HEIGHT_SPACING)
  const positions = out?.length === chunkGridVertexCount(size) * 3 ? out : new Float32Array(chunkGridVertexCount(size) * 3)
  const half = size / 2
  let k = 0
  const put = (i: number, j: number) => {
    positions[k++] = -half + i * HEIGHT_SPACING
    positions[k++] = data[j * res + i] + GRID_LIFT
    positions[k++] = -half + j * HEIGHT_SPACING
  }
  for (let e = 0; e <= n; e++) {
    const edge = e * CELLS
    for (let s = 0; s + 1 < res; s++) {
      put(edge, s)
      put(edge, s + 1)
      put(s, edge)
      put(s + 1, edge)
    }
  }
  return positions
}
