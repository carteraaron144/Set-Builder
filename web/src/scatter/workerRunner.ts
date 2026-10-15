import type { ScatterRequest, ScatterResponse, ScatterRunner } from './scatterManager'

/** A ScatterRunner backed by one module Worker; requests are answered in order. */
export function createWorkerRunner(): { run: ScatterRunner; dispose(): void } {
  const worker = new Worker(new URL('./scatterWorker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, { resolve: (r: ScatterResponse) => void; reject: (e: unknown) => void }>()
  worker.onmessage = (e: MessageEvent<ScatterResponse>) => {
    waiting.get(e.data.id)?.resolve(e.data)
    waiting.delete(e.data.id)
  }
  // A crash inside the Worker must reject the waiting request, or scatter would stall for the rest of the session.
  const failAll = (e: unknown) => {
    for (const w of waiting.values()) w.reject(e)
    waiting.clear()
  }
  worker.onerror = (e) => {
    e.preventDefault()
    failAll(new Error(e.message || 'Scatter worker error'))
  }
  worker.onmessageerror = () => failAll(new Error('Scatter worker sent an unreadable message'))
  return {
    run: (req: ScatterRequest) =>
      new Promise((resolve, reject) => {
        waiting.set(req.id, { resolve, reject })
        const transfer = [req.heights.buffer, req.biomes.buffer, ...(req.exclusion ? [req.exclusion.buffer] : [])] as ArrayBuffer[]
        worker.postMessage(req, transfer)
      }),
    dispose: () => worker.terminate(),
  }
}
