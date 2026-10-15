import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import { SCENE_FORMAT_VERSION, SCENE_SIZES, type Scene } from './scene'

/** A project file is a zip containing scene.json (and, from M1, layer blobs). */
export const SCENE_FILE_EXTENSION = '.setbuilder'

const SCENE_JSON = 'scene.json'

export type SceneFileErrorReason = 'not-a-zip' | 'missing-scene-json' | 'invalid-json' | 'invalid-scene' | 'newer-version'

export class SceneFileError extends Error {
  readonly reason: SceneFileErrorReason

  constructor(reason: SceneFileErrorReason, message: string = reason) {
    super(message)
    this.name = 'SceneFileError'
    this.reason = reason
  }
}

const isoTimestamp = z.iso.datetime()

const sceneSchema = z.object({
  formatVersion: z.literal(SCENE_FORMAT_VERSION),
  id: z.string().min(1),
  name: z.string(),
  size: z.union(SCENE_SIZES.map((s) => z.literal(s))),
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
})

/** Validates untrusted data as a Scene. A newer formatVersion is reported before the shape is checked. */
export function parseScene(data: unknown): Scene {
  if (typeof data === 'object' && data !== null && 'formatVersion' in data) {
    const version = (data as { formatVersion: unknown }).formatVersion
    if (typeof version === 'number' && version > SCENE_FORMAT_VERSION) {
      throw new SceneFileError('newer-version', `Scene format ${version} is newer than ${SCENE_FORMAT_VERSION}`)
    }
  }
  const result = sceneSchema.safeParse(data)
  if (!result.success) throw new SceneFileError('invalid-scene', result.error.message)
  return result.data as Scene
}

export function writeSceneFile(scene: Scene): Uint8Array {
  return zipSync({ [SCENE_JSON]: strToU8(JSON.stringify(scene, null, 2)) })
}

export function readSceneFile(bytes: Uint8Array): Scene {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new SceneFileError('not-a-zip')
  }
  const sceneJson = files[SCENE_JSON]
  if (!sceneJson) throw new SceneFileError('missing-scene-json')
  let data: unknown
  try {
    data = JSON.parse(strFromU8(sceneJson))
  } catch {
    throw new SceneFileError('invalid-json')
  }
  return parseScene(data)
}
