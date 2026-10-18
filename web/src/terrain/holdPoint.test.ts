import { describe, expect, it, vi } from 'vitest'
import { HoldPoint } from './holdPoint'

describe('HoldPoint', () => {
  it('re-picks when the pointer moves, so the brush follows the terrain', () => {
    const hold = new HoldPoint<number>()
    const pick = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2)
    expect(hold.resolve(10, 10, pick)).toBe(1)
    expect(hold.resolve(11, 10, pick)).toBe(2)
  })

  it('keeps the last point while the pointer is still, so Add does not climb its own material', () => {
    const hold = new HoldPoint<number>()
    const pick = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2)
    hold.resolve(10, 10, pick)
    expect(hold.resolve(10, 10, pick)).toBe(1)
    expect(pick).toHaveBeenCalledTimes(1)
  })

  it('forgets the point on reset', () => {
    const hold = new HoldPoint<number>()
    const pick = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2)
    hold.resolve(10, 10, pick)
    hold.reset()
    expect(hold.resolve(10, 10, pick)).toBe(2)
  })
})
