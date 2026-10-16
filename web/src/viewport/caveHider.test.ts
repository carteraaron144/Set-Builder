import { describe, expect, it } from 'vitest'
import { CaveHider } from './caveHider'

const cave = (i: number) => i < 10

describe('CaveHider', () => {
  it('hides every dirty chunk while hiding, and remembers the ones with caves', () => {
    const h = new CaveHider()
    expect(h.split(true, [1, 2, 20], cave)).toEqual({ hide: [1, 2, 20], flush: [], normal: [] })
    expect(h.split(true, [2, 3], cave)).toEqual({ hide: [2, 3], flush: [], normal: [] })
  })

  it('flushes the hidden cave chunks, once, when hiding stops', () => {
    const h = new CaveHider()
    h.split(true, [1, 2, 20], cave)
    h.split(true, [3], cave)
    expect(h.split(false, [], cave).flush.sort()).toEqual([1, 2, 3])
    expect(h.split(false, [], cave).flush).toEqual([])
  })

  it('leaves chunks dirtied after the flush to the normal path, and does not remesh a flushed chunk twice', () => {
    const h = new CaveHider()
    h.split(true, [1], cave)
    expect(h.split(false, [1, 2, 20], cave)).toEqual({ hide: [], flush: [1], normal: [2, 20] })
  })

  it('does nothing when nothing was hidden', () => {
    const h = new CaveHider()
    expect(h.split(false, [4], cave)).toEqual({ hide: [], flush: [], normal: [4] })
  })
})
