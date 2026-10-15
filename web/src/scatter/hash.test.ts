import { describe, expect, it } from 'vitest'
import { hash4, unit } from './hash'

describe('hash4', () => {
  it('is deterministic and sensitive to every argument', () => {
    expect(hash4(1, 2, 3, 4, 5)).toBe(hash4(1, 2, 3, 4, 5))
    const base = hash4(1, 2, 3, 4, 5)
    for (const args of [[9, 2, 3, 4, 5], [1, 9, 3, 4, 5], [1, 2, 9, 4, 5], [1, 2, 3, 9, 5], [1, 2, 3, 4, 9]] as [number, number, number, number, number][])
      expect(hash4(...args)).not.toBe(base)
  })

  it('has no collisions on a 100 × 100 grid and maps to [0, 1)', () => {
    const seen = new Set<number>()
    for (let a = -50; a < 50; a++)
      for (let b = -50; b < 50; b++) {
        const h = hash4(7, 0, a, b, 1)
        seen.add(h)
        expect(unit(h)).toBeGreaterThanOrEqual(0)
        expect(unit(h)).toBeLessThan(1)
      }
    expect(seen.size).toBe(10000)
  })
})
