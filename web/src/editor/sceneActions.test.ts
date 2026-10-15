import 'fake-indexeddb/auto'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { openSceneStore, StorageUnavailableError, type SceneStore } from '../persistence/sceneStore'
import { createScene, type Scene } from '../scene/scene'
import { readSceneFile, SceneFileError, writeSceneFile } from '../scene/sceneFile'
import { createFlatLayers } from '../terrain/layers'
import { createEditorStore } from './editorStore'
import { EXPORT_DEFAULTS } from '../export/exportScene'
import {
  downloadCurrent,
  exportCurrent,
  loadInitialScene,
  MESSAGES,
  newScene,
  openScene,
  saveCurrent,
  uploadSceneFile,
  type ActionDeps,
} from './sceneActions'

let dbCounter = 0

function setup(opts: { storage?: 'ok' | 'unavailable'; confirm?: boolean; scene?: Scene } = {}) {
  const store = createEditorStore(opts.scene ?? createScene({ size: 128, name: 'My Scene' }))
  const dbName = `actions-db-${++dbCounter}`
  const download = vi.fn<(filename: string, bytes: Uint8Array) => void>()
  const confirmDiscard = vi.fn(() => opts.confirm ?? true)
  const sceneStore: () => Promise<SceneStore> =
    opts.storage === 'unavailable' ? () => Promise.reject(new StorageUnavailableError()) : () => openSceneStore(dbName)
  const deps: ActionDeps = { store, sceneStore, confirmDiscard, download }
  return { store, deps, download, confirmDiscard, dbName }
}

function fileOf(bytes: Uint8Array, name = 'scene.setbuilder') {
  return new File([bytes as BlobPart], name)
}

describe('saveCurrent', () => {
  it('stores the scene, clears dirty and says Saved', async () => {
    const { store, deps, dbName } = setup()
    store.getState().rename('Valley')
    expect(store.getState().dirty).toBe(true)
    await saveCurrent(deps)
    const saved = await (await openSceneStore(dbName)).load(store.getState().scene.id)
    expect(saved?.scene).toEqual(store.getState().scene)
    expect(store.getState().dirty).toBe(false)
    expect(store.getState().message).toEqual({ kind: 'info', text: 'Saved' })
  })

  it('reports blocked storage, stays dirty, and Download still works', async () => {
    const { store, deps, download } = setup({ storage: 'unavailable' })
    store.getState().rename('Draft')
    await saveCurrent(deps)
    expect(store.getState().message).toEqual({ kind: 'error', text: MESSAGES.storageFailed })
    expect(MESSAGES.storageFailed).toBe(
      "Couldn't save in this browser (storage is blocked or full). Use Download to keep a copy.",
    )
    expect(store.getState().dirty).toBe(true)

    store.getState().rename('My Scene')
    downloadCurrent(deps)
    expect(download).toHaveBeenCalledTimes(1)
    const [filename, bytes] = download.mock.calls[0]
    expect(filename).toBe('my-scene.setbuilder')
    expect(readSceneFile(bytes).scene).toEqual(store.getState().scene)
  })

  it('reports a failed write as a storage error', async () => {
    const { store, deps } = setup()
    deps.sceneStore = async () => ({
      save: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
      load: async () => undefined,
      list: async () => [],
      remove: async () => {},
    })
    store.getState().rename('X')
    await saveCurrent(deps)
    expect(store.getState().message).toEqual({ kind: 'error', text: MESSAGES.storageFailed })
    expect(store.getState().dirty).toBe(true)
  })
})

describe('replacing a dirty scene', () => {
  it('newScene asks first and keeps the scene when declined', () => {
    const { store, deps, confirmDiscard } = setup({ confirm: false })
    store.getState().rename('Edited')
    const before = store.getState().scene
    newScene(deps, 'Fresh', 64)
    expect(confirmDiscard).toHaveBeenCalled()
    expect(store.getState().scene).toBe(before)
    expect(store.getState().dirty).toBe(true)
  })

  it('newScene replaces the scene when confirmed', () => {
    const { store, deps } = setup({ confirm: true })
    store.getState().rename('Edited')
    newScene(deps, 'Fresh', 64)
    expect(store.getState().scene).toMatchObject({ name: 'Fresh', size: 64 })
    expect(store.getState().dirty).toBe(false)
  })

  it('does not ask when the scene is clean', () => {
    const { deps, confirmDiscard } = setup({ confirm: false })
    newScene(deps, 'Fresh', 256)
    expect(confirmDiscard).not.toHaveBeenCalled()
    expect(deps.store.getState().scene.size).toBe(256)
  })

  it('openScene keeps the scene when declined and replaces it when confirmed', async () => {
    const other = createScene({ size: 64, name: 'Other' })
    const declined = setup({ confirm: false })
    await (await declined.deps.sceneStore()).save(other, createFlatLayers(other.size))
    declined.store.getState().rename('Edited')
    const before = declined.store.getState().scene
    await openScene(declined.deps, other.id)
    expect(declined.store.getState().scene).toBe(before)

    const accepted = setup({ confirm: true })
    await (await accepted.deps.sceneStore()).save(other, createFlatLayers(other.size))
    accepted.store.getState().rename('Edited')
    await openScene(accepted.deps, other.id)
    expect(accepted.store.getState().scene).toEqual(other)
    expect(accepted.store.getState().dirty).toBe(false)
  })

  it('uploadSceneFile keeps the scene when declined and replaces it when confirmed', async () => {
    const other = createScene({ size: 256, name: 'Uploaded' })
    const declined = setup({ confirm: false })
    declined.store.getState().rename('Edited')
    const before = declined.store.getState().scene
    await uploadSceneFile(declined.deps, fileOf(writeSceneFile(other, createFlatLayers(other.size))))
    expect(declined.store.getState().scene).toBe(before)

    const accepted = setup({ confirm: true })
    accepted.store.getState().rename('Edited')
    await uploadSceneFile(accepted.deps, fileOf(writeSceneFile(other, createFlatLayers(other.size))))
    expect(accepted.store.getState().scene).toEqual(other)
    expect(accepted.store.getState().dirty).toBe(false)
  })
})

describe('uploadSceneFile errors', () => {
  it('rejects random bytes and leaves the scene untouched', async () => {
    const { store, deps, confirmDiscard } = setup()
    const before = store.getState().scene
    const bytes = new Uint8Array(512).map((_, i) => (i * 31 + 7) % 256)
    await uploadSceneFile(deps, fileOf(bytes, 'photo.setbuilder'))
    expect(store.getState().scene).toBe(before)
    expect(store.getState().message).toEqual({ kind: 'error', text: "That file isn't a Set Builder scene." })
    expect(confirmDiscard).not.toHaveBeenCalled()
  })

  it('names a newer format version', async () => {
    const { store, deps } = setup()
    const before = store.getState().scene
    const newer = zipSync({ 'scene.json': strToU8(JSON.stringify({ ...before, formatVersion: 3 })) })
    await uploadSceneFile(deps, fileOf(newer))
    expect(store.getState().scene).toBe(before)
    expect(store.getState().message).toEqual({ kind: 'error', text: 'That scene was made with a newer version of Set Builder.' })
  })
})

describe('openScene', () => {
  it('replaces the scene with a saved one', async () => {
    const { store, deps } = setup()
    const other = createScene({ size: 64, name: 'Other' })
    await (await deps.sceneStore()).save(other, createFlatLayers(other.size))
    await openScene(deps, other.id)
    expect(store.getState().scene).toEqual(other)
  })

  it('reports an unknown id and changes nothing', async () => {
    const { store, deps } = setup()
    const before = store.getState().scene
    await openScene(deps, 'missing')
    expect(store.getState().scene).toBe(before)
    expect(store.getState().message?.kind).toBe('error')
  })
})

describe('loadInitialScene', () => {
  it('opens the newest saved scene', async () => {
    const { store, deps } = setup()
    const sceneStore = await deps.sceneStore()
    const older = createScene({ size: 64, name: 'Older', now: new Date('2026-10-01T00:00:00Z') })
    const newer = createScene({ size: 256, name: 'Newer', now: new Date('2026-10-14T00:00:00Z') })
    await sceneStore.save(older, createFlatLayers(older.size))
    await sceneStore.save(newer, createFlatLayers(newer.size))
    await loadInitialScene(deps)
    expect(store.getState().scene).toEqual(newer)
    expect(store.getState().dirty).toBe(false)
  })

  it('keeps the new scene when nothing is saved or storage is blocked', async () => {
    for (const storage of ['ok', 'unavailable'] as const) {
      const { store, deps } = setup({ storage })
      const before = store.getState().scene
      await loadInitialScene(deps)
      expect(store.getState().scene).toBe(before)
      expect(store.getState().message).toBeNull()
    }
  })
})

describe('terrain layers in scene actions', () => {
  function sculpted(store: ReturnType<typeof createEditorStore>) {
    const { terrain } = store.getState()
    terrain.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 6, strength: 1, falloff: 0.5 }, { x: 3, z: 3 })
    terrain.dab({ x: 3, z: 3 }, 0.1, false)
    terrain.endStroke()
    return terrain.layers.heights.data.slice()
  }
  const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v, i) => v === b[i])

  it('saves layers and opens them again', async () => {
    const { store, deps } = setup()
    const heights = sculpted(store)
    await saveCurrent(deps)
    const fresh = createEditorStore()
    await openScene({ ...deps, store: fresh }, store.getState().scene.id)
    expect(same(fresh.getState().terrain.layers.heights.data, heights)).toBe(true)
  })

  it('downloads the current layers', () => {
    const { store, deps, download } = setup()
    const heights = sculpted(store)
    downloadCurrent(deps)
    expect(same(readSceneFile(download.mock.calls[0][1]).layers.heights.data, heights)).toBe(true)
  })

  it('starts a new scene flat with no history', () => {
    const { store, deps } = setup()
    sculpted(store)
    newScene(deps, 'Fresh', 64)
    expect(store.getState().terrain.layers.heights.data.every((v) => v === 0)).toBe(true)
    expect(store.getState().canUndo).toBe(false)
  })

  it('restores the newest scene with its layers at startup', async () => {
    const { store, deps } = setup()
    const heights = sculpted(store)
    await saveCurrent(deps)
    const fresh = createEditorStore()
    await loadInitialScene({ ...deps, store: fresh })
    expect(same(fresh.getState().terrain.layers.heights.data, heights)).toBe(true)
  })

  it('opens an uploaded v1 file as flat terrain', async () => {
    const { store, deps } = setup()
    sculpted(store)
    const { generatorVersion: _g, ...v1 } = { ...createScene({ size: 64, name: 'Old' }), formatVersion: 1 }
    await uploadSceneFile(deps, fileOf(zipSync({ 'scene.json': strToU8(JSON.stringify(v1)) })))
    expect(store.getState().scene.name).toBe('Old')
    expect(store.getState().terrain.layers.heights.data.every((v) => v === 0)).toBe(true)
  })

  it('rejects an uploaded file with damaged layers and keeps the scene', async () => {
    const { store, deps } = setup()
    const heights = sculpted(store)
    const before = store.getState().scene
    const v2 = createScene({ size: 64 })
    const damaged = zipSync({ 'scene.json': strToU8(JSON.stringify(v2)), 'heightmap.f32': new Uint8Array(8), 'biomes.rgba8': new Uint8Array(8) })
    await uploadSceneFile(deps, fileOf(damaged))
    expect(store.getState().message).toEqual({ kind: 'error', text: MESSAGES.damaged })
    expect(MESSAGES.damaged).toBe('That scene file is damaged: its terrain data is missing or the wrong size.')
    expect(store.getState().scene).toBe(before)
    expect(same(store.getState().terrain.layers.heights.data, heights)).toBe(true)
  })

  it('reports a saved scene whose layers are damaged', async () => {
    const { store, deps } = setup()
    deps.sceneStore = async () => ({
      save: async () => {},
      load: () => Promise.reject(new SceneFileError('invalid-layers')),
      list: async () => [],
      remove: async () => {},
    })
    const before = store.getState().scene
    await openScene(deps, 'x')
    expect(store.getState().message).toEqual({ kind: 'error', text: MESSAGES.damagedSaved })
    expect(MESSAGES.damagedSaved).toBe("That saved scene is damaged and can't be opened.")
    expect(store.getState().scene).toBe(before)
  })

  it('saves the layers as they were when Save started, and a stroke during the write stays unsaved', async () => {
    const { store, deps } = setup()
    let release: () => void = () => {}
    let stored: Float32Array | undefined
    deps.sceneStore = async () => ({
      save: (_scene, layers) =>
        new Promise<void>((resolve) => {
          stored = layers.heights.data
          release = resolve
        }),
      load: async () => undefined,
      list: async () => [],
      remove: async () => {},
    })
    const before = store.getState().terrain.layers.heights.data.slice()
    const saving = saveCurrent(deps)
    await Promise.resolve()
    await Promise.resolve()
    sculpted(store)
    release()
    await saving
    expect(same(stored!, before)).toBe(true)
    expect(store.getState().dirty).toBe(true)
    expect(store.getState().message).toEqual({ kind: 'info', text: 'Saved' })
  })
})

describe('exportCurrent', () => {
  it('downloads <slug>.glb and reports its size', async () => {
    const { store, deps, download } = setup()
    const writeGlb = vi.fn(async () => new Uint8Array(3 * 1024 * 1024))
    await exportCurrent({ ...deps, library: null, writeGlb }, EXPORT_DEFAULTS)
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0][0]).toBe('my-scene.glb')
    expect(store.getState().message).toEqual({ kind: 'info', text: 'Exported my-scene.glb (3.0 MB)' })
  })

  it('reports an exporter failure and leaves the scene untouched', async () => {
    const { store, deps, download } = setup()
    const before = store.getState().scene
    await exportCurrent({ ...deps, library: null, writeGlb: async () => Promise.reject(new Error('out of memory')) }, EXPORT_DEFAULTS)
    expect(download).not.toHaveBeenCalled()
    expect(store.getState().message).toEqual({ kind: 'error', text: "Couldn't export the scene: out of memory" })
    expect(store.getState().scene).toBe(before)
  })
})

describe('exportCurrent scatter', () => {
  it('exports scatter generated from the current layers, not from the live viewport state', async () => {
    const { loadBasicsLibrary } = await import('../test/basicsLibrary')
    const { assetInfoOf } = await import('../assets/assetLibrary')
    const { rulesFor } = await import('../scatter/rules')
    const { scatterChunk } = await import('../scatter/scatter')
    const library = await loadBasicsLibrary()
    const { store, deps } = setup({ scene: createScene({ size: 64, name: 'Fresh export', seed: 5 }) })
    const { terrain, scene } = store.getState()
    terrain.beginStroke({ tool: 'paint', biome: 'forest' }, { radius: 20, strength: 1, falloff: 0 }, { x: 0, z: 0 })
    terrain.dab({ x: 0, z: 0 }, 1, false)
    terrain.endStroke()
    let root: import('three').Object3D | null = null
    await exportCurrent({ ...deps, library, writeGlb: async (r) => ((root = r), new Uint8Array(4)) }, { grouping: 'element', collision: false, includeGrass: true })
    const rules = rulesFor(scene.generatorVersion)
    const expected = [0, 1, 2, 3].reduce((a, c) => a + scatterChunk({ layers: terrain.layers, seed: scene.seed, rules, exclusion: null }, c, assetInfoOf(library)).instances.length, 0)
    expect(expected).toBeGreaterThan(0)
    expect(root!.getObjectByName('scatter')!.children).toHaveLength(expected)
  })
})
