import { describe, expect, it } from 'vitest'
import { createFlatLayers } from '../terrain/layers'
import { chunkGridPositions, chunkGridVertexCount, GRID_LIFT } from './chunkGridGeometry'

describe('chunkGrid', () => {
  it('has a line segment per height sample along every chunk edge, both ways', () => {
    const { heights } = createFlatLayers(64) // 2×2 chunks: 3 edges each way, 128 segments per edge
    expect(chunkGridVertexCount(heights.size)).toBe(3 * 2 * 128 * 2)
    expect(chunkGridPositions(heights).length).toBe(chunkGridVertexCount(heights.size) * 3)
  })

  it('lies on chunk boundaries, 32 m apart, and follows the ground', () => {
    const { heights } = createFlatLayers(64)
    const res = heights.resolution
    heights.data[0 * res + 64] = 5 // sample (i = 64, j = 0) sits on the middle vertical edge
    const p = chunkGridPositions(heights)
    const xs = new Set<number>()
    for (let v = 0; v < p.length; v += 3) {
      const onX = Math.abs(((p[v] + 32) % 32) ) < 1e-6
      const onZ = Math.abs(((p[v + 2] + 32) % 32)) < 1e-6
      expect(onX || onZ).toBe(true)
      xs.add(p[v])
    }
    expect([...xs]).toContain(-32)
    expect([...xs]).toContain(0)
    expect([...xs]).toContain(32)
    let raised = false
    for (let v = 0; v < p.length; v += 3) if (p[v] === 0 && p[v + 2] === -32 && Math.abs(p[v + 1] - (5 + GRID_LIFT)) < 1e-5) raised = true
    expect(raised).toBe(true)
  })
})
