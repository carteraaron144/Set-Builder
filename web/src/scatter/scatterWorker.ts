/// <reference lib="webworker" />
import { scatterChunk } from './scatter'
import type { ScatterRequest, ScatterResponse } from './scatterManager'

self.onmessage = (e: MessageEvent<ScatterRequest>) => {
  const req = e.data
  const layers = {
    heights: { size: req.size, resolution: req.size * 2 + 1, data: req.heights },
    biomes: { size: req.size, resolution: req.size + 1, data: req.biomes },
  }
  const inputs = { layers, seed: req.seed, rules: req.rules, exclusion: req.exclusion }
  const response: ScatterResponse = { id: req.id, results: req.chunks.map((c) => scatterChunk(inputs, c, req.assets)) }
  ;(self as unknown as Worker).postMessage(response)
}
