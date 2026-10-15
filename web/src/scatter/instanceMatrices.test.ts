import { Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { writeInstanceMatrices } from './instanceMatrices'
import type { Instance } from './scatter'

describe('writeInstanceMatrices', () => {
  it('matches Matrix4.compose for random instances, including non-uniform scale', () => {
    let seed = 1
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const instances: Instance[] = Array.from({ length: 100 }, (_, k) => {
      const q = new Quaternion(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize()
      return { rule: 0, x: r() * 100, y: r() * 10, z: -r() * 100, quat: [q.x, q.y, q.z, q.w], scale: k % 2 ? [1.2, 7, 1.2] : [0.9, 0.9, 0.9], priority: k }
    })
    const out = new Float32Array(100 * 16)
    writeInstanceMatrices(instances, out)
    instances.forEach((i, k) => {
      const m = new Matrix4().compose(new Vector3(i.x, i.y, i.z), new Quaternion(...i.quat), new Vector3(...i.scale))
      m.elements.forEach((v, e) => expect(out[k * 16 + e]).toBeCloseTo(v, 4))
    })
  })
})
