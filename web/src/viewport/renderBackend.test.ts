import { describe, expect, it } from 'vitest'
import { detectSupport, forcedBackend } from './renderBackend'

describe('detectSupport', () => {
  it('prefers WebGPU when navigator.gpu exists', () => {
    expect(detectSupport({ gpu: {}, webgl2: true })).toBe('webgpu')
  })

  it('falls back to WebGL2 without navigator.gpu', () => {
    expect(detectSupport({ gpu: undefined, webgl2: true })).toBe('webgl2')
  })

  it('reports none when neither is available', () => {
    expect(detectSupport({ webgl2: false })).toBe('none')
  })
})

describe('forcedBackend', () => {
  it('reads ?renderer=webgl2 from the query string', () => {
    expect(forcedBackend('?renderer=webgl2')).toBe('webgl2')
    expect(forcedBackend('?renderer=webgpu')).toBeNull()
    expect(forcedBackend('')).toBeNull()
  })
})
