import type { SceneSize } from '../scene/scene'
import { SceneFileError } from '../scene/sceneFile'
import { HEIGHT_SPACING, MAX_HEIGHT, MIN_HEIGHT } from './layers'
import { BRICK, brickKey, MAX_BRICKS, unpackKey, VALUE_LIMIT, VOXEL_STEP, VolumeLayer } from './volume'

const VOXELS = BRICK ** 3
const BRICK_BYTES = 6 + 2 * VOXELS
const LIMIT = VALUE_LIMIT / VOXEL_STEP

/** Uint32 count, then per brick Int16 bx, by, bz, 512 A bytes and 512 K bytes (little-endian), in ascending key order. */
export function encodeVolume(v: VolumeLayer): Uint8Array {
  const keys = [...v.keys()].sort((a, b) => a - b)
  const out = new Uint8Array(4 + keys.length * BRICK_BYTES)
  const view = new DataView(out.buffer)
  view.setUint32(0, keys.length, true)
  keys.forEach((key, n) => {
    const at = 4 + n * BRICK_BYTES
    const [bx, by, bz] = unpackKey(key)
    view.setInt16(at, bx, true)
    view.setInt16(at + 2, by, true)
    view.setInt16(at + 4, bz, true)
    const brick = v.get(key)!
    out.set(new Uint8Array(brick.a.buffer, brick.a.byteOffset, VOXELS), at + 6)
    out.set(new Uint8Array(brick.k.buffer, brick.k.byteOffset, VOXELS), at + 6 + VOXELS)
  })
  return out
}

const invalid = (why: string) => new SceneFileError('invalid-layers', `volume: ${why}`)

/** Decodes bricks, rejecting anything malformed; bricks whose voxels are all default are dropped. */
export function decodeVolume(size: SceneSize, bytes: Uint8Array | undefined): VolumeLayer {
  const v = new VolumeLayer(size)
  if (!bytes) return v
  if (bytes.byteLength < 4) throw invalid('truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0, true)
  if (count > MAX_BRICKS) throw invalid('too many bricks')
  if (bytes.byteLength !== 4 + count * BRICK_BYTES) throw invalid('wrong length')
  const maxB = Math.floor((size * 2) / BRICK)
  const minY = Math.floor(MIN_HEIGHT / HEIGHT_SPACING / BRICK)
  const maxY = Math.floor(MAX_HEIGHT / HEIGHT_SPACING / BRICK)
  const seen = new Set<number>()
  for (let n = 0; n < count; n++) {
    const at = 4 + n * BRICK_BYTES
    const bx = view.getInt16(at, true)
    const by = view.getInt16(at + 2, true)
    const bz = view.getInt16(at + 4, true)
    if (bx < 0 || bx > maxB || bz < 0 || bz > maxB || by < minY || by > maxY) throw invalid('brick outside the scene')
    const key = brickKey(bx, by, bz)
    if (seen.has(key)) throw invalid('duplicate brick')
    seen.add(key)
    const a = Int8Array.from(bytes.subarray(at + 6, at + 6 + VOXELS), (b) => (b << 24) >> 24)
    const k = Int8Array.from(bytes.subarray(at + 6 + VOXELS, at + BRICK_BYTES), (b) => (b << 24) >> 24)
    for (let i = 0; i < VOXELS; i++) if (a[i] < -LIMIT || a[i] > LIMIT || k[i] < -LIMIT || k[i] > LIMIT) throw invalid('value out of range')
    v.put(key, { a, k })
  }
  return v
}
