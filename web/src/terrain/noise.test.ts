import { describe, expect, it } from 'vitest'
import { valueNoise2 } from './noise'

describe('valueNoise2', () => {
  it('is deterministic for a seed and position', () => {
    expect(valueNoise2(7, 12.3, -4.5)).toBe(valueNoise2(7, 12.3, -4.5))
  })

  it('changes with the seed', () => {
    let differ = 0
    for (let i = 0; i < 100; i++) if (valueNoise2(1, i * 1.7, i * -2.3) !== valueNoise2(2, i * 1.7, i * -2.3)) differ++
    expect(differ).toBeGreaterThan(90)
  })

  it('stays in [-1, 1] and varies', () => {
    const values = new Set<number>()
    for (let i = 0; i < 10000; i++) {
      const v = valueNoise2(42, (i % 100) * 0.37 - 20, Math.floor(i / 100) * 0.41 - 20)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
      values.add(v)
    }
    expect(values.size).toBeGreaterThan(1000)
  })
})
