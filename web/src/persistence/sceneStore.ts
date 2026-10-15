import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Scene, SceneSize } from '../scene/scene'
import { layersFromBuffers, parseScene, type SceneFileContents } from '../scene/sceneFile'
import { createFlatLayers, type TerrainLayers } from '../terrain/layers'

export interface SceneSummary {
  id: string
  name: string
  size: SceneSize
  updatedAt: string
}

export interface SceneStore {
  /** Writes the scene and its layers in one transaction. */
  save(scene: Scene, layers: TerrainLayers): Promise<void>
  /** undefined when there is no valid scene record; rejects with SceneFileError('invalid-layers') for damaged layers. */
  load(id: string): Promise<SceneFileContents | undefined>
  /** Newest updatedAt first. Records that fail validation are skipped. */
  list(): Promise<SceneSummary[]>
  remove(id: string): Promise<void>
}

/** IndexedDB is missing or blocked (private windows, disabled site data, another tab holding an old version). */
export class StorageUnavailableError extends Error {
  constructor(message = 'Browser storage is unavailable', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageUnavailableError'
  }
}

const SCENES = 'scenes'
const LAYERS = 'layers'
const DB_VERSION = 2

interface LayersRecord {
  id: string
  heights: ArrayBuffer
  biomes: ArrayBuffer
}

interface SetBuilderDB extends DBSchema {
  // Values are untrusted until parseScene / layersFromBuffers accept them.
  scenes: { key: string; value: unknown }
  layers: { key: string; value: LayersRecord }
}

function tryParse(value: unknown): Scene | undefined {
  try {
    return parseScene(value)
  } catch {
    return undefined
  }
}

/** Opens the database, failing fast (instead of hanging) when another tab blocks the upgrade. */
function open(dbName: string): Promise<IDBPDatabase<SetBuilderDB>> {
  return new Promise((resolve, reject) => {
    let blocked = false
    openDB<SetBuilderDB>(dbName, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) database.createObjectStore(SCENES, { keyPath: 'id' })
        if (oldVersion < 2) database.createObjectStore(LAYERS, { keyPath: 'id' })
      },
      blocked() {
        blocked = true
        reject(new StorageUnavailableError('Browser storage is being upgraded. Close other Set Builder tabs and try again.'))
      },
      blocking(_current, _blocked, event) {
        // A newer version wants the database (another tab): step aside.
        ;(event.target as IDBDatabase).close()
      },
    }).then(
      (db) => {
        // The upgrade went through after we reported it blocked: don't leak the connection.
        if (blocked) db.close()
        else resolve(db)
      },
      (cause: unknown) => reject(new StorageUnavailableError(undefined, { cause })),
    )
  })
}

export async function openSceneStore(dbName = 'set-builder'): Promise<SceneStore> {
  if (typeof indexedDB === 'undefined') throw new StorageUnavailableError()
  const db = await open(dbName)

  return {
    async save(scene, layers) {
      const tx = db.transaction([SCENES, LAYERS], 'readwrite')
      await Promise.all([
        tx.objectStore(SCENES).put(scene),
        tx
          .objectStore(LAYERS)
          .put({ id: scene.id, heights: layers.heights.data.slice().buffer, biomes: layers.biomes.data.slice().buffer }),
        tx.done,
      ])
    },
    async load(id) {
      const scene = tryParse(await db.get(SCENES, id))
      if (!scene) return undefined
      const record = await db.get(LAYERS, id)
      // Scenes saved before layers existed (M0) are flat, all meadow.
      if (!record) return { scene, layers: createFlatLayers(scene.size) }
      return { scene, layers: layersFromBuffers(scene.size, record.heights, record.biomes) }
    },
    async list() {
      const scenes = (await db.getAll(SCENES)).map(tryParse).filter((s): s is Scene => s !== undefined)
      scenes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      return scenes.map(({ id, name, size, updatedAt }) => ({ id, name, size, updatedAt }))
    },
    async remove(id) {
      const tx = db.transaction([SCENES, LAYERS], 'readwrite')
      await Promise.all([tx.objectStore(SCENES).delete(id), tx.objectStore(LAYERS).delete(id), tx.done])
    },
  }
}
