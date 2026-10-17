import { meshChunks, type CaveMeshResponse } from '../features/caveMesh'
import type { CaveMeshRunner } from './caveMeshManager'

/** A runner backed by one module Worker; requests are answered in order. Falls back to the calling thread without Workers. */
export function createCaveMeshRunner(): { run: CaveMeshRunner; dispose(): void } {
  if (typeof Worker === 'undefined') return { run: (req) => Promise.resolve(meshChunks(req)), dispose: () => {} }
  const worker = new Worker(new URL('./caveMeshWorker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, { resolve: (r: CaveMeshResponse) => void; reject: (e: unknown) => void }>()
  worker.onmessage = (e) => {
    waiting.get(e.data.id)?.resolve(e.data)
    waiting.delete(e.data.id)
  }
  // A crash inside the Worker must reject the waiting request, or caves would stop updating for the session.
  const failAll = (e: unknown) => {
    for (const w of waiting.values()) w.reject(e)
    waiting.clear()
  }
  worker.onerror = (e) => {
    e.preventDefault()
    failAll(new Error(e.message || 'Cave mesh worker error'))
  }
  worker.onmessageerror = () => failAll(new Error('Cave mesh worker sent an unreadable message'))
  return {
    run: (req) =>
      new Promise((resolve, reject) => {
        waiting.set(req.id, { resolve, reject })
        worker.postMessage(req)
      }),
    dispose: () => worker.terminate(),
  }
}
