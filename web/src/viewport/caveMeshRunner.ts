import { meshChunks, type CaveMeshResponse } from '../features/caveMesh'
import type { CaveMeshRunner } from './caveMeshManager'

/** Up to four workers, leaving a couple of cores for the page and the GPU process. */
export function defaultWorkerCount(cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4): number {
  return Math.min(4, Math.max(1, cores - 2))
}

interface Slot {
  worker: Worker
  waiting: Map<number, { resolve: (r: CaveMeshResponse) => void; reject: (e: unknown) => void }>
}

/**
 * A runner backed by a pool of module Workers; a request goes to the worker its slot names. Falls back to the calling thread without Workers.
 */
export function createCaveMeshRunner(count = defaultWorkerCount()): { run: CaveMeshRunner; workers: number; dispose(): void } {
  if (typeof Worker === 'undefined') return { run: (req) => Promise.resolve(meshChunks(req)), workers: 1, dispose: () => {} }
  const slots: Slot[] = Array.from({ length: count }, () => {
    const slot: Slot = { worker: new Worker(new URL('./caveMeshWorker.ts', import.meta.url), { type: 'module' }), waiting: new Map() }
    slot.worker.onmessage = (e: MessageEvent<CaveMeshResponse>) => {
      slot.waiting.get(e.data.id)?.resolve(e.data)
      slot.waiting.delete(e.data.id)
    }
    // A crash inside a Worker must reject its waiting requests, or caves would stop updating for the session.
    const failAll = (e: unknown) => {
      for (const w of slot.waiting.values()) w.reject(e)
      slot.waiting.clear()
    }
    slot.worker.onerror = (e) => {
      e.preventDefault()
      failAll(new Error(e.message || 'Cave mesh worker error'))
    }
    slot.worker.onmessageerror = () => failAll(new Error('Cave mesh worker sent an unreadable message'))
    return slot
  })
  return {
    workers: count,
    run: (req, slot) =>
      new Promise((resolve, reject) => {
        const s = slots[slot % count]
        s.waiting.set(req.id, { resolve, reject })
        s.worker.postMessage(req)
      }),
    dispose: () => slots.forEach((s) => s.worker.terminate()),
  }
}
