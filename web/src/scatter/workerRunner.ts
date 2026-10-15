import type { ScatterRequest, ScatterResponse, ScatterRunner } from './scatterManager'

/** A ScatterRunner backed by one module Worker; requests are answered in order. */
export function createWorkerRunner(): { run: ScatterRunner; dispose(): void } {
  const worker = new Worker(new URL('./scatterWorker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, (r: ScatterResponse) => void>()
  worker.onmessage = (e: MessageEvent<ScatterResponse>) => {
    waiting.get(e.data.id)?.(e.data)
    waiting.delete(e.data.id)
  }
  return {
    run: (req: ScatterRequest) =>
      new Promise((resolve) => {
        waiting.set(req.id, resolve)
        const transfer = [req.heights.buffer, req.biomes.buffer, ...(req.exclusion ? [req.exclusion.buffer] : [])] as ArrayBuffer[]
        worker.postMessage(req, transfer)
      }),
    dispose: () => worker.terminate(),
  }
}
