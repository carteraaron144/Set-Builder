import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parsePackManifest } from '../assets/packManifest'
import { createScene, type SceneSize } from '../scene/scene'
import { readSceneFile, writeSceneFile } from '../scene/sceneFile'
import { createFlatLayers } from '../terrain/layers'
import { TerrainEditor } from '../terrain/terrainEditor'
import { parseRules, rulesFor } from './rules'
import { assetInfoFrom, scatterChunk } from './scatter'
import { ScatterManager, type ScatterRequest, type ScatterResponse, type ScatterRunner } from './scatterManager'

const manifest = parsePackManifest(JSON.parse(readFileSync(resolve(__dirname, '../../../packs/setbuilder-basics/pack.json'), 'utf8')))
const assets = assetInfoFrom([{ packId: 'setbuilder-basics', manifest }])

/** Runs requests in-process, like the Worker does. */
function runRequest(req: ScatterRequest): ScatterResponse {
  const res = req.size * 2 + 1
  const layers = {
    heights: { size: req.size, resolution: res, data: req.heights },
    biomes: { size: req.size, resolution: req.size + 1, data: req.biomes },
  }
  const inp = { layers, seed: req.seed, rules: req.rules, exclusion: req.exclusion }
  return { id: req.id, results: req.chunks.map((c) => scatterChunk(inp, c, req.assets)) }
}

function deferredRunner() {
  const calls: { req: ScatterRequest; resolve: () => void }[] = []
  const run: ScatterRunner = (req) =>
    new Promise((resolve) => {
      calls.push({ req, resolve: () => resolve(runRequest(req)) })
    })
  return { run, calls }
}

const immediate: ScatterRunner = async (req) => runRequest(req)
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(size: SceneSize = 64, run: ScatterRunner = immediate, opts: { onCapped?: (c: boolean) => void; rules?: ReturnType<typeof rulesFor> } = {}) {
  const scene = createScene({ size, seed: 5 })
  const layers = createFlatLayers(size)
  for (let o = 0; o < layers.biomes.data.length; o += 4) layers.biomes.data.set([0, 255, 0, 0], o)
  const terrain = new TerrainEditor(layers, scene.seed, () => {})
  const manager = new ScatterManager(terrain, scene, run, assets, opts)
  return { scene, terrain, manager }
}

function paintStroke(t: TerrainEditor, x: number, z: number) {
  t.beginStroke({ tool: 'paint', biome: 'rocky' }, { radius: 3, strength: 1, falloff: 0 }, { x, z })
  t.dab({ x, z }, 1, false)
  t.endStroke()
}

describe('ScatterManager', () => {
  it('requests every chunk once, then only dirtied chunks and their neighbours', async () => {
    const d = deferredRunner()
    const { terrain, manager } = setup(256, d.run)
    manager.pump()
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].req.chunks).toHaveLength(64)
    d.calls[0].resolve()
    await flush()
    manager.pump()
    expect(d.calls).toHaveLength(1)
    // Chunk 9 is (1, 1) in an 8 × 8 grid.
    paintStroke(terrain, -128 + 48, -128 + 48)
    manager.pump()
    expect(d.calls[1].req.chunks).toEqual([0, 1, 2, 8, 9, 10, 16, 17, 18])
  })

  it('keeps one request in flight and accumulates dirt meanwhile', async () => {
    const d = deferredRunner()
    const { terrain, manager } = setup(64, d.run)
    manager.pump()
    paintStroke(terrain, -20, -20)
    manager.pump()
    paintStroke(terrain, 20, 20)
    manager.pump()
    expect(d.calls).toHaveLength(1)
    d.calls[0].resolve()
    await flush()
    manager.pump()
    expect(d.calls).toHaveLength(2)
    expect(d.calls[1].req.chunks).toEqual([0, 1, 2, 3])
  })

  it('drops results for chunks dirtied after the request and ends matching the final layers', async () => {
    const d = deferredRunner()
    const { terrain, manager } = setup(64, d.run)
    manager.pump()
    d.calls[0].resolve()
    await flush()
    paintStroke(terrain, -20, -20)
    manager.pump()
    terrain.undo()
    d.calls[1].resolve()
    await flush()
    manager.pump()
    d.calls[2].resolve()
    await flush()
    const fresh = setup(64)
    fresh.manager.pump()
    await flush()
    expect(manager.instancesByRule()).toEqual(fresh.manager.instancesByRule())
  })

  it('ignores responses after dispose', async () => {
    const d = deferredRunner()
    const { manager } = setup(64, d.run)
    manager.pump()
    const v = manager.version
    manager.dispose()
    d.calls[0].resolve()
    await flush()
    expect(manager.version).toBe(v)
    expect(manager.instancesByRule().flat()).toHaveLength(0)
  })

  it('is deterministic, including after a file round trip', async () => {
    const a = setup(64)
    paintStroke(a.terrain, 5, 5)
    a.manager.pump()
    await flush()
    const b = setup(64)
    paintStroke(b.terrain, 5, 5)
    b.manager.pump()
    await flush()
    expect(a.manager.instancesByRule()).toEqual(b.manager.instancesByRule())
    const read = readSceneFile(writeSceneFile(a.scene, a.terrain.layers))
    const c = new ScatterManager(new TerrainEditor(read.layers, read.scene.seed, () => {}), read.scene, immediate, assets)
    c.pump()
    await flush()
    expect(c.instancesByRule()).toEqual(a.manager.instancesByRule())
    expect(a.manager.instancesByRule().flat().length).toBeGreaterThan(0)
  })

  it('reports when chunks hit the density cap', async () => {
    const onCapped = vi.fn()
    const base = rulesFor(2).rules.find((r) => r.asset.endsWith('grass-tuft') && r.biome === 'forest')!
    const rules = parseRules({ maxInstances: 400, rules: [{ ...base, minSpacing: 0.3, density: 22 }] })
    const { manager } = setup(64, immediate, { onCapped, rules })
    manager.pump()
    await flush()
    expect(manager.capped).toBe(true)
    expect(onCapped).toHaveBeenLastCalledWith(true)
  })

  it('sends copies of the layers', () => {
    const d = deferredRunner()
    const { terrain, manager } = setup(64, d.run)
    manager.pump()
    const sent = d.calls[0].req.heights
    terrain.layers.heights.data[0] = 99
    expect(sent[0]).toBe(0)
  })
})
