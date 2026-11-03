import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createScene, type Scene } from '../scene/scene'
import type { SceneFileContents } from '../scene/sceneFile'
import { createFlatLayers, type TerrainLayers } from '../terrain/layers'
import { importBrowserScenes } from './importBrowserScenes'
import { openSceneStore, StorageUnavailableError, type SceneStore } from './sceneStore'

let dbCounter = 0

function sceneAt(id: string, iso: string) {
  return createScene({ id, size: 64, name: `Scene ${id}`, now: new Date(iso), seed: 1 })
}

/** An in-memory stand-in for the server that records upload order and can fail chosen ids. */
function fakeRemote(failIds: string[] = []) {
  const saved = new Map<string, SceneFileContents>()
  const order: string[] = []
  const remote: SceneStore = {
    async save(scene: Scene, layers: TerrainLayers) {
      if (failIds.includes(scene.id)) throw new Error('offline')
      saved.set(scene.id, { scene, layers })
      order.push(scene.id)
    },
    load: async (id) => saved.get(id),
    list: async () => [],
    remove: async (id) => void saved.delete(id),
  }
  return { remote, saved, order }
}

async function localWith(...scenes: Scene[]) {
  const name = `import-db-${++dbCounter}`
  const local = await openSceneStore(name)
  for (const s of scenes) await local.save(s, createFlatLayers(64))
  return { name, open: () => openSceneStore(name) }
}

describe('importBrowserScenes', () => {
  it('uploads every browser scene oldest first, then empties browser storage', async () => {
    const a = sceneAt('a', '2026-01-01T00:00:00Z')
    const b = sceneAt('b', '2026-02-01T00:00:00Z')
    const local = await localWith(b, a)
    const { remote, saved, order } = fakeRemote()

    expect(await importBrowserScenes(remote, local.open)).toEqual({ imported: 2, remaining: 0 })
    expect(order).toEqual(['a', 'b'])
    expect(saved.get('a')?.scene).toEqual(a)
    expect(await (await local.open()).list()).toEqual([])
  })

  it('keeps a scene whose upload failed, and a retry uploads only what is left', async () => {
    const a = sceneAt('a', '2026-01-01T00:00:00Z')
    const b = sceneAt('b', '2026-02-01T00:00:00Z')
    const local = await localWith(a, b)

    const first = fakeRemote(['b'])
    expect(await importBrowserScenes(first.remote, local.open)).toEqual({ imported: 1, remaining: 1 })
    expect((await (await local.open()).list()).map((s) => s.id)).toEqual(['b'])

    const retry = fakeRemote()
    expect(await importBrowserScenes(retry.remote, local.open)).toEqual({ imported: 1, remaining: 0 })
    expect(retry.order).toEqual(['b'])
  })

  it('does nothing when browser storage is unavailable', async () => {
    const { remote, order } = fakeRemote()
    const result = await importBrowserScenes(remote, () => Promise.reject(new StorageUnavailableError()))
    expect(result).toEqual({ imported: 0, remaining: 0 })
    expect(order).toEqual([])
  })

  it('does nothing when browser storage is empty', async () => {
    const local = await localWith()
    const { remote, order } = fakeRemote()
    expect(await importBrowserScenes(remote, local.open)).toEqual({ imported: 0, remaining: 0 })
    expect(order).toEqual([])
  })
})
