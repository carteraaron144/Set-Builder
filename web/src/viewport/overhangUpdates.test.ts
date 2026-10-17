import { describe, expect, it } from 'vitest'
import { overhangsToBuild } from './overhangUpdates'

describe('overhangsToBuild', () => {
  it('builds nothing while overhangs are off, even for changed chunks', () => {
    expect(overhangsToBuild(false, false, [1, 2], 4)).toEqual([])
    expect(overhangsToBuild(false, true, [1, 2], 4)).toEqual([])
  })

  it('builds every chunk when overhangs are switched on', () => {
    expect(overhangsToBuild(true, false, [2], 4)).toEqual([0, 1, 2, 3])
  })

  it('builds only changed chunks while they stay on', () => {
    expect(overhangsToBuild(true, true, [3, 1], 4)).toEqual([3, 1])
  })
})
