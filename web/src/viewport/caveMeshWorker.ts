/// <reference lib="webworker" />
import { meshChunks, type CaveMeshRequest, type CaveMeshResponse } from '../features/caveMesh'

self.onmessage = (e: MessageEvent<CaveMeshRequest>) => {
  const res = meshChunks(e.data)
  const transfer = res.results.flatMap((r) => [r.geometry.positions.buffer, r.geometry.colors.buffer, r.geometry.indices.buffer]) as ArrayBuffer[]
  ;(self as unknown as Worker).postMessage(res satisfies CaveMeshResponse, transfer)
}
