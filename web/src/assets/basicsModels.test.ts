import { Box3, Mesh, type BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { basicsModels } from './basicsModels'

const SLOTS = ['bark', 'leaf', 'pine', 'stone', 'grass', 'reed']
const meshes = (o: import('three').Object3D) => {
  const out: Mesh[] = []
  o.traverse((c) => c instanceof Mesh && out.push(c))
  return out
}
const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3

describe('basicsModels', () => {
  const models = basicsModels()
  const byId = Object.fromEntries(models.map((m) => [m.asset.id, m]))
  const height = (id: string) => new Box3().setFromObject(byId[id].object).max.y

  it('has the planned assets with palette-slot materials and 20–400 triangles', () => {
    expect(models.map((m) => m.asset.id)).toEqual([
      'pine', 'broadleaf', 'rock-large', 'rock-small', 'bush', 'grass-tuft', 'reeds',
      'pillar-single', 'pillar-pair', 'pillar-cluster-3', 'pillar-cluster-5',
    ])
    for (const m of models) {
      const ms = meshes(m.object)
      for (const mesh of ms) expect(SLOTS).toContain((mesh.material as { name: string }).name)
      const total = ms.reduce((a, mesh) => a + tris(mesh.geometry), 0)
      expect(total, m.asset.id).toBeGreaterThanOrEqual(20)
      expect(total, m.asset.id).toBeLessThanOrEqual(400)
    }
  })

  it('stands on y = 0 at real-world sizes', () => {
    for (const m of models) expect(new Box3().setFromObject(m.object).min.y, m.asset.id).toBeCloseTo(0, 5)
    expect(height('pine')).toBeGreaterThanOrEqual(6)
    expect(height('pine')).toBeLessThanOrEqual(9)
    expect(height('broadleaf')).toBeGreaterThanOrEqual(5)
    expect(height('broadleaf')).toBeLessThanOrEqual(8)
    expect(height('grass-tuft')).toBeLessThanOrEqual(0.6)
  })

  it('makes faceted, tapered stone pillars 1 m long with box collision', () => {
    for (const id of ['pillar-single', 'pillar-pair', 'pillar-cluster-3', 'pillar-cluster-5']) {
      const m = byId[id]
      expect(m.asset.kind).toBe('cliff')
      expect(typeof m.asset.collision === 'object' && 'box' in m.asset.collision).toBe(true)
      expect(m.asset.lengthRange).toBeDefined()
      expect(height(id)).toBeCloseTo(1, 1)
      const ms = meshes(m.object)
      const total = ms.reduce((a, mesh) => a + tris(mesh.geometry), 0)
      expect(total, id).toBeGreaterThanOrEqual(40)
      expect(total, id).toBeLessThanOrEqual(200)
      for (const mesh of ms) {
        expect((mesh.material as { name: string }).name).toBe('stone')
        const box = new Box3().setFromObject(mesh)
        const pos = mesh.geometry.getAttribute('position')
        // Narrower near the top than at the base.
        let topR = 0
        let baseR = 0
        const cx = (box.min.x + box.max.x) / 2
        const cz = (box.min.z + box.max.z) / 2
        for (let i = 0; i < pos.count; i++) {
          const r = Math.hypot(pos.getX(i) + mesh.position.x - cx, pos.getZ(i) + mesh.position.z - cz)
          const y = pos.getY(i) + mesh.position.y
          if (y > box.max.y - 0.15) topR = Math.max(topR, r)
          if (y < box.min.y + 0.15) baseR = Math.max(baseR, r)
        }
        expect(topR).toBeLessThan(baseR)
      }
    }
    for (const [id, n] of [['pillar-cluster-3', 3], ['pillar-cluster-5', 5]] as const) {
      const heights = meshes(byId[id].object).map((mesh) => new Box3().setFromObject(mesh).max.y)
      expect(heights).toHaveLength(n)
      expect(new Set(heights.map((h) => h.toFixed(2))).size).toBeGreaterThan(1)
    }
  })

  it('is deterministic', () => {
    const a = basicsModels()
    const b = basicsModels()
    for (let i = 0; i < a.length; i++) {
      const ma = meshes(a[i].object)
      const mb = meshes(b[i].object)
      ma.forEach((mesh, k) => expect([...mesh.geometry.getAttribute('position').array]).toEqual([...mb[k].geometry.getAttribute('position').array]))
    }
  })
})
