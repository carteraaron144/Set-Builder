import { describe, expect, it } from 'vitest'
import { defaultWorkerCount } from './caveMeshRunner'

describe('defaultWorkerCount', () => {
  it('leaves two cores free, between one and four workers', () => {
    expect(defaultWorkerCount(2)).toBe(1)
    expect(defaultWorkerCount(1)).toBe(1)
    expect(defaultWorkerCount(4)).toBe(2)
    expect(defaultWorkerCount(6)).toBe(4)
    expect(defaultWorkerCount(16)).toBe(4)
  })
})
