import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { createScene, type SceneSize } from '../scene/scene'
import { SceneFileError } from '../scene/sceneFile'
import { sculpt } from '../terrain/brush'
import { createFlatLayers } from '../terrain/layers'
import { openSceneStore, StorageUnavailableError } from './sceneStore'

let dbCounter = 0
const freshDbName = () => `test-db-${++dbCounter}`

function sceneAt(id: string, iso: string, size: SceneSize = 64) {
  return createScene({ id, size, name: `Scene ${id}`, now: new Date(iso), seed: 1 })
}

function hilly(size: SceneSize = 64) {
  const l = createFlatLayers(size)
  sculpt(l.heights, 'raise', { radius: 8, strength: 1, falloff: 0.5 }, { x: 0, z: 0, dt: 1, invert: false }, { flattenTo: 0, seed: 1 })
  l.biomes.data.set([0, 0, 255, 0], 400)
  return l
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v, i) => v === b[i])

describe('SceneStore', () => {
  const realIndexedDB = globalThis.indexedDB
  afterEach(() => {
    globalThis.indexedDB = realIndexedDB
  })

  it('saves and loads a scene with its layers', async () => {
    const store = await openSceneStore(freshDbName())
    const s = sceneAt('a', '2026-10-15T12:00:00Z')
    const layers = hilly()
    await store.save(s, layers)
    const loaded = await store.load('a')
    expect(loaded?.scene).toEqual(s)
    expect(same(loaded!.layers.heights.data, layers.heights.data)).toBe(true)
    expect(same(loaded!.layers.biomes.data, layers.biomes.data)).toBe(true)
  })

  it('returns undefined for an unknown id', async () => {
    const store = await openSceneStore(freshDbName())
    expect(await store.load('nope')).toBeUndefined()
  })

  it('keeps one record per id, the newer one', async () => {
    const store = await openSceneStore(freshDbName())
    await store.save(sceneAt('a', '2026-10-15T12:00:00Z'), createFlatLayers(64))
    const newer = { ...sceneAt('a', '2026-10-16T12:00:00Z'), name: 'Renamed' }
    await store.save(newer, hilly())
    expect(await store.list()).toHaveLength(1)
    expect((await store.load('a'))?.scene).toEqual(newer)
  })

  it('lists summaries newest first', async () => {
    const store = await openSceneStore(freshDbName())
    await store.save(sceneAt('old', '2026-10-01T00:00:00Z', 64), createFlatLayers(64))
    await store.save(sceneAt('new', '2026-10-15T00:00:00Z', 128), createFlatLayers(128))
    await store.save(sceneAt('mid', '2026-10-08T00:00:00Z'), createFlatLayers(64))
    expect(await store.list()).toEqual([
      { id: 'new', name: 'Scene new', size: 128, updatedAt: '2026-10-15T00:00:00.000Z' },
      { id: 'mid', name: 'Scene mid', size: 64, updatedAt: '2026-10-08T00:00:00.000Z' },
      { id: 'old', name: 'Scene old', size: 64, updatedAt: '2026-10-01T00:00:00.000Z' },
    ])
  })

  it('removes a scene and its layers', async () => {
    const dbName = freshDbName()
    const store = await openSceneStore(dbName)
    await store.save(sceneAt('a', '2026-10-15T12:00:00Z'), hilly())
    await store.remove('a')
    expect(await store.load('a')).toBeUndefined()
    expect(await store.list()).toEqual([])
    const raw = await openDB(dbName)
    expect(await raw.get('layers', 'a')).toBeUndefined()
    raw.close()
  })

  it('rejects with StorageUnavailableError when indexedDB is missing', async () => {
    // @ts-expect-error simulating a browser without IndexedDB
    delete globalThis.indexedDB
    await expect(openSceneStore(freshDbName())).rejects.toBeInstanceOf(StorageUnavailableError)
  })

  it('skips stored scene records that are not valid scenes', async () => {
    const dbName = freshDbName()
    const store = await openSceneStore(dbName)
    await store.save(sceneAt('good', '2026-10-15T12:00:00Z'), createFlatLayers(64))
    const raw = await openDB(dbName)
    await raw.put('scenes', { id: 'bad', name: 5, size: 100 })
    raw.close()
    expect((await store.list()).map((s) => s.id)).toEqual(['good'])
    expect(await store.load('bad')).toBeUndefined()
  })

  it('opens an M0 (version 1) database and its v1 scenes as flat terrain', async () => {
    const dbName = freshDbName()
    const v1 = await openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore('scenes', { keyPath: 'id' })
      },
    })
    const { generatorVersion: _g, ...old } = { ...sceneAt('m0', '2026-10-10T00:00:00Z', 128), formatVersion: 1 }
    await v1.put('scenes', old)
    v1.close()

    const store = await openSceneStore(dbName)
    expect((await store.list()).map((s) => s.id)).toEqual(['m0'])
    const loaded = await store.load('m0')
    expect(loaded?.scene).toMatchObject({ id: 'm0', formatVersion: 4, generatorVersion: 4, size: 128 })
    expect(same(loaded!.layers.heights.data, createFlatLayers(128).heights.data)).toBe(true)
  })

  it('rejects damaged stored layers with invalid-layers', async () => {
    const dbName = freshDbName()
    const store = await openSceneStore(dbName)
    await store.save(sceneAt('a', '2026-10-15T12:00:00Z'), createFlatLayers(64))
    const raw = await openDB(dbName)
    await raw.put('layers', { id: 'a', heights: new ArrayBuffer(12), biomes: new ArrayBuffer(4) })
    raw.close()
    const error = await store.load('a').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SceneFileError)
    expect((error as SceneFileError).reason).toBe('invalid-layers')
  })

  it('reports an upgrade blocked by another open tab', async () => {
    const dbName = freshDbName()
    const other = await openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore('scenes', { keyPath: 'id' })
      },
    })
    const error = await openSceneStore(dbName).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageUnavailableError)
    expect((error as Error).message).toMatch(/close other Set Builder tabs/i)
    other.close()
  })

  it('closes itself when a newer version needs the database', async () => {
    const dbName = freshDbName()
    await openSceneStore(dbName)
    const newer = await openDB(dbName, 3)
    expect(newer.version).toBe(3)
    newer.close()
  })
})
