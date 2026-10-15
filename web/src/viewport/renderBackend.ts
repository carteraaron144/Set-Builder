export type RenderBackend = 'webgpu' | 'webgl2'

export function detectSupport(env: { gpu?: unknown; webgl2: boolean }): RenderBackend | 'none' {
  if (env.gpu) return 'webgpu'
  return env.webgl2 ? 'webgl2' : 'none'
}

/** Reads the current browser's capabilities for detectSupport. */
export function browserSupport(): { gpu?: unknown; webgl2: boolean } {
  const gpu = typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: unknown }).gpu : undefined
  let webgl2 = false
  try {
    webgl2 = typeof WebGL2RenderingContext !== 'undefined' && !!document.createElement('canvas').getContext('webgl2')
  } catch {
    webgl2 = false
  }
  return { gpu, webgl2 }
}

/** `?renderer=webgl2` forces the WebGL2 backend (for testing the fallback, or working around a bad WebGPU driver). */
export function forcedBackend(search: string): 'webgl2' | null {
  return new URLSearchParams(search).get('renderer') === 'webgl2' ? 'webgl2' : null
}
