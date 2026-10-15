import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { createScene, type SceneSize } from '../scene/scene'
import { openSceneStore, StorageUnavailableError } from './sceneStore'

let dbCounter = 0
const freshDbName = () => `test-db-${++dbCounter}`

function sceneAt(id: string, iso: string, size: SceneSize = 128) {
  return createScene({ id, size, name: `Scene ${id}`, now: new Date(iso), seed: 1 })
}

describe('SceneStore', () => {
  const realIndexedDB = globalThis.indexedDB
  afterEach(() => {
    globalThis.indexedDB = realIndexedDB
  })

  it('saves and loads a scene', async () => {
    const store = await openSceneStore(freshDbName())
    const s = sceneAt('a', '2026-10-15T12:00:00Z')
    await store.save(s)
    expect(await store.load('a')).toEqual(s)
  })

  it('returns undefined for an unknown id', async () => {
    const store = await openSceneStore(freshDbName())
    expect(await store.load('nope')).toBeUndefined()
  })

  it('keeps one record per id, the newer one', async () => {
    const store = await openSceneStore(freshDbName())
    await store.save(sceneAt('a', '2026-10-15T12:00:00Z'))
    const newer = { ...sceneAt('a', '2026-10-16T12:00:00Z'), name: 'Renamed' }
    await store.save(newer)
    expect(await store.list()).toHaveLength(1)
    expect(await store.load('a')).toEqual(newer)
  })

  it('lists summaries newest first', async () => {
    const store = await openSceneStore(freshDbName())
    await store.save(sceneAt('old', '2026-10-01T00:00:00Z', 64))
    await store.save(sceneAt('new', '2026-10-15T00:00:00Z', 256))
    await store.save(sceneAt('mid', '2026-10-08T00:00:00Z'))
    expect(await store.list()).toEqual([
      { id: 'new', name: 'Scene new', size: 256, updatedAt: '2026-10-15T00:00:00.000Z' },
      { id: 'mid', name: 'Scene mid', size: 128, updatedAt: '2026-10-08T00:00:00.000Z' },
      { id: 'old', name: 'Scene old', size: 64, updatedAt: '2026-10-01T00:00:00.000Z' },
    ])
  })

  it('removes a scene', async () => {
    const store = await openSceneStore(freshDbName())
    await store.save(sceneAt('a', '2026-10-15T12:00:00Z'))
    await store.remove('a')
    expect(await store.load('a')).toBeUndefined()
    expect(await store.list()).toEqual([])
  })

  it('rejects with StorageUnavailableError when indexedDB is missing', async () => {
    // @ts-expect-error simulating a browser without IndexedDB
    delete globalThis.indexedDB
    await expect(openSceneStore(freshDbName())).rejects.toBeInstanceOf(StorageUnavailableError)
  })

  it('skips stored records that are not valid scenes', async () => {
    const dbName = freshDbName()
    const store = await openSceneStore(dbName)
    await store.save(sceneAt('good', '2026-10-15T12:00:00Z'))
    const raw = await openDB(dbName, 1)
    await raw.put('scenes', { id: 'bad', name: 5, size: 100 })
    raw.close()
    expect((await store.list()).map((s) => s.id)).toEqual(['good'])
    expect(await store.load('bad')).toBeUndefined()
  })
})
