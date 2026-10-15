import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import {
  createFlatLayers,
  MAX_HEIGHT,
  MIN_HEIGHT,
  quantizeWeights,
  type TerrainLayers,
} from '../terrain/layers'
import { GENERATOR_VERSION, SCENE_FORMAT_VERSION, SCENE_SIZES, type Scene, type SceneSize } from './scene'

/** A project file is a zip of scene.json plus the layer blobs. */
export const SCENE_FILE_EXTENSION = '.setbuilder'

const SCENE_JSON = 'scene.json'
const HEIGHTMAP = 'heightmap.f32'
const BIOMES = 'biomes.rgba8'

export type SceneFileErrorReason =
  | 'not-a-zip'
  | 'missing-scene-json'
  | 'invalid-json'
  | 'invalid-scene'
  | 'newer-version'
  | 'invalid-layers'

export class SceneFileError extends Error {
  readonly reason: SceneFileErrorReason

  constructor(reason: SceneFileErrorReason, message: string = reason) {
    super(message)
    this.name = 'SceneFileError'
    this.reason = reason
  }
}

const isoTimestamp = z.iso.datetime()

const sceneFields = {
  id: z.string().min(1),
  name: z.string(),
  size: z.union(SCENE_SIZES.map((s) => z.literal(s))),
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
}

const v1Schema = z.object({ formatVersion: z.literal(1), ...sceneFields })
const v2Schema = z.object({
  formatVersion: z.literal(SCENE_FORMAT_VERSION),
  generatorVersion: z.number().int().min(1),
  ...sceneFields,
})

function formatVersionOf(data: unknown): unknown {
  return typeof data === 'object' && data !== null && 'formatVersion' in data
    ? (data as { formatVersion: unknown }).formatVersion
    : undefined
}

/** Validates untrusted data as a Scene, upgrading v1. A newer formatVersion is reported before the shape is checked. */
export function parseScene(data: unknown): Scene {
  const version = formatVersionOf(data)
  if (typeof version === 'number' && version > SCENE_FORMAT_VERSION) {
    throw new SceneFileError('newer-version', `Scene format ${version} is newer than ${SCENE_FORMAT_VERSION}`)
  }
  if (version === 1) {
    const v1 = v1Schema.safeParse(data)
    if (!v1.success) throw new SceneFileError('invalid-scene', v1.error.message)
    return { ...v1.data, formatVersion: SCENE_FORMAT_VERSION, generatorVersion: GENERATOR_VERSION } as Scene
  }
  const result = v2Schema.safeParse(data)
  if (!result.success) throw new SceneFileError('invalid-scene', result.error.message)
  // Generator 1 made terrain only; generator 2 adds slope bands and scatter, so older scenes upgrade in place.
  return { ...result.data, generatorVersion: Math.max(result.data.generatorVersion, 2) } as Scene
}

/**
 * Validates layer blobs for a scene size. Wrong or missing lengths and non-finite heights are rejected;
 * out-of-range heights are clamped and biome samples renormalised to sum to 255.
 */
export function layersFromBuffers(size: SceneSize, heights: ArrayBuffer | undefined, biomes: ArrayBuffer | undefined): TerrainLayers {
  const layers = createFlatLayers(size)
  const h = layers.heights.data
  const b = layers.biomes.data
  if (!heights || heights.byteLength !== h.byteLength) throw new SceneFileError('invalid-layers', 'heightmap missing or wrong size')
  if (!biomes || biomes.byteLength !== b.byteLength) throw new SceneFileError('invalid-layers', 'biome map missing or wrong size')
  h.set(new Float32Array(heights))
  for (let i = 0; i < h.length; i++) {
    if (!Number.isFinite(h[i])) throw new SceneFileError('invalid-layers', 'heightmap has non-finite values')
    h[i] = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h[i]))
  }
  b.set(new Uint8Array(biomes))
  for (let i = 0; i < b.length; i += 4) {
    const sum = b[i] + b[i + 1] + b[i + 2] + b[i + 3]
    if (sum === 255) continue
    if (sum === 0) b.set([255, 0, 0, 0], i)
    else quantizeWeights([b[i] / sum, b[i + 1] / sum, b[i + 2] / sum, b[i + 3] / sum], b, i)
  }
  return layers
}

const bytesOf = (a: Float32Array | Uint8Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)

/** A copy of a zip entry's bytes as its own (aligned) ArrayBuffer. */
const ownBuffer = (bytes: Uint8Array | undefined) => (bytes ? bytes.slice().buffer : undefined)

export interface SceneFileContents {
  scene: Scene
  layers: TerrainLayers
}

export function writeSceneFile(scene: Scene, layers: TerrainLayers): Uint8Array {
  // Layer blobs are the typed arrays' bytes; every supported browser is little-endian.
  return zipSync(
    {
      [SCENE_JSON]: strToU8(JSON.stringify(scene, null, 2)),
      [HEIGHTMAP]: bytesOf(layers.heights.data),
      [BIOMES]: bytesOf(layers.biomes.data),
    },
    { level: 6 },
  )
}

export function readSceneFile(bytes: Uint8Array): SceneFileContents {
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
  const scene = parseScene(data)
  // v1 files predate layers: flat, all meadow.
  if (formatVersionOf(data) === 1) return { scene, layers: createFlatLayers(scene.size) }
  return { scene, layers: layersFromBuffers(scene.size, ownBuffer(files[HEIGHTMAP]), ownBuffer(files[BIOMES])) }
}
