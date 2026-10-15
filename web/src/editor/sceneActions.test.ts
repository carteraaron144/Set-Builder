import 'fake-indexeddb/auto'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { openSceneStore, StorageUnavailableError, type SceneStore } from '../persistence/sceneStore'
import { createScene, type Scene } from '../scene/scene'
import { readSceneFile, writeSceneFile } from '../scene/sceneFile'
import { createFlatLayers } from '../terrain/layers'
import { createEditorStore } from './editorStore'
import {
  downloadCurrent,
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
    expect(saved).toEqual(store.getState().scene)
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
    await (await declined.deps.sceneStore()).save(other)
    declined.store.getState().rename('Edited')
    const before = declined.store.getState().scene
    await openScene(declined.deps, other.id)
    expect(declined.store.getState().scene).toBe(before)

    const accepted = setup({ confirm: true })
    await (await accepted.deps.sceneStore()).save(other)
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
    await (await deps.sceneStore()).save(other)
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
    await sceneStore.save(older)
    await sceneStore.save(newer)
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
