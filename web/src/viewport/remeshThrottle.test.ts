import { describe, expect, it } from 'vitest'
import { RemeshThrottle } from './remeshThrottle'

describe('RemeshThrottle', () => {
  it('releases queued chunks at once when nothing was meshed recently', () => {
    const t = new RemeshThrottle(100)
    t.add([3, 4])
    expect(t.take(0).sort()).toEqual([3, 4])
    expect(t.take(1)).toEqual([])
  })

  it('holds chunks queued during the wait and releases them together afterwards', () => {
    const t = new RemeshThrottle(100)
    t.add([1])
    t.take(0)
    t.finished(0, 0)
    t.add([1, 2])
    t.add([2, 5])
    expect(t.take(50)).toEqual([])
    expect(t.take(99)).toEqual([])
    expect(t.take(100).sort()).toEqual([1, 2, 5])
    expect(t.take(100)).toEqual([])
  })

  it('waits longer after a slow remesh', () => {
    const t = new RemeshThrottle(100, 2)
    t.add([1])
    t.take(0)
    t.finished(300, 300)
    t.add([1])
    expect(t.take(800)).toEqual([])
    expect(t.take(900)).toEqual([1])
  })

  it('does not start the wait when nothing was taken', () => {
    const t = new RemeshThrottle(100)
    expect(t.take(0)).toEqual([])
    t.add([7])
    expect(t.take(1)).toEqual([7])
  })
})
