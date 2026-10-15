import { openDB, type DBSchema } from 'idb'
import type { Scene, SceneSize } from '../scene/scene'
import { parseScene } from '../scene/sceneFile'

export interface SceneSummary {
  id: string
  name: string
  size: SceneSize
  updatedAt: string
}

export interface SceneStore {
  save(scene: Scene): Promise<void>
  load(id: string): Promise<Scene | undefined>
  /** Newest updatedAt first. Records that fail validation are skipped. */
  list(): Promise<SceneSummary[]>
  remove(id: string): Promise<void>
}

/** IndexedDB is missing or blocked (private windows, disabled site data). */
export class StorageUnavailableError extends Error {
  constructor(message = 'Browser storage is unavailable', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageUnavailableError'
  }
}

const STORE = 'scenes'

interface SetBuilderDB extends DBSchema {
  // Values are untrusted until parseScene accepts them.
  scenes: { key: string; value: unknown }
}

function tryParse(value: unknown): Scene | undefined {
  try {
    return parseScene(value)
  } catch {
    return undefined
  }
}

export async function openSceneStore(dbName = 'set-builder'): Promise<SceneStore> {
  if (typeof indexedDB === 'undefined') throw new StorageUnavailableError()
  let db
  try {
    db = await openDB<SetBuilderDB>(dbName, 1, {
      upgrade(database) {
        database.createObjectStore(STORE, { keyPath: 'id' })
      },
    })
  } catch (cause) {
    throw new StorageUnavailableError(undefined, { cause })
  }

  return {
    async save(scene) {
      await db.put(STORE, scene)
    },
    async load(id) {
      return tryParse(await db.get(STORE, id))
    },
    async list() {
      const scenes = (await db.getAll(STORE)).map(tryParse).filter((s): s is Scene => s !== undefined)
      scenes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      return scenes.map(({ id, name, size, updatedAt }) => ({ id, name, size, updatedAt }))
    },
    async remove(id) {
      await db.delete(STORE, id)
    },
  }
}
