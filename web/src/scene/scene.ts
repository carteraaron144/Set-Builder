import { emptyFeatures, type Features } from '../features/features'

export type SceneSize = 64 | 128 | 256

export const SCENE_SIZES: readonly SceneSize[] = [64, 128, 256]

export const SCENE_FORMAT_VERSION = 4

/** Recorded per scene so a generator update can't silently change old scenes. */
export const GENERATOR_VERSION = 4

export const DEFAULT_SCENE_NAME = 'Untitled scene'
export const MAX_SCENE_NAME_LENGTH = 80

/** A scene as saved locally and in project files. Units are metres; timestamps are ISO 8601. */
export interface Scene {
  formatVersion: 4
  generatorVersion: number
  id: string
  name: string
  size: SceneSize
  seed: number
  createdAt: string
  updatedAt: string
  /** Paths, rivers and ponds: inputs that the ground is generated from. */
  features: Features
}

export function normalizeSceneName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_SCENE_NAME_LENGTH).trim()
  return trimmed === '' ? DEFAULT_SCENE_NAME : trimmed
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

export function createScene(opts: { name?: string; size: SceneSize; now?: Date; id?: string; seed?: number }): Scene {
  const timestamp = (opts.now ?? new Date()).toISOString()
  return {
    formatVersion: SCENE_FORMAT_VERSION,
    generatorVersion: GENERATOR_VERSION,
    id: opts.id ?? crypto.randomUUID(),
    name: normalizeSceneName(opts.name ?? ''),
    size: opts.size,
    seed: opts.seed ?? randomSeed(),
    createdAt: timestamp,
    updatedAt: timestamp,
    features: emptyFeatures(),
  }
}

export function renameScene(scene: Scene, name: string, now: Date = new Date()): Scene {
  return { ...scene, name: normalizeSceneName(name), updatedAt: now.toISOString() }
}
