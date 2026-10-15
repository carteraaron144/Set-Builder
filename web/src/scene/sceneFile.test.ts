import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { paint, sculpt } from '../terrain/brush'
import { createFlatLayers, type TerrainLayers } from '../terrain/layers'
import { createScene } from './scene'
import {
  layersFromBuffers,
  parseScene,
  readSceneFile,
  SceneFileError,
  writeSceneFile,
  type SceneFileErrorReason,
} from './sceneFile'

const scene = createScene({ size: 64, now: new Date('2026-10-15T12:00:00Z'), id: 'a', seed: 7, name: 'Forest' })

function shapedLayers(): TerrainLayers {
  const l = createFlatLayers(64)
  sculpt(l.heights, 'raise', { radius: 10, strength: 1, falloff: 0.5 }, { x: 5, z: -3, dt: 1, invert: false }, { flattenTo: 0, seed: 1 })
  paint(l.biomes, 'forest', { radius: 6, strength: 0.7, falloff: 0.5 }, { x: -10, z: 10, dt: 0.3, invert: false })
  return l
}

const bytesOf = (a: Float32Array | Uint8Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)

function zipWith(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, content] of Object.entries(files)) entries[name] = typeof content === 'string' ? strToU8(content) : content
  return zipSync(entries)
}

function v2Zip(overrides: Record<string, string | Uint8Array | undefined> = {}) {
  const l = createFlatLayers(64)
  const files: Record<string, string | Uint8Array | undefined> = {
    'scene.json': JSON.stringify(scene),
    'heightmap.f32': bytesOf(l.heights.data),
    'biomes.rgba8': l.biomes.data,
    ...overrides,
  }
  return zipWith(Object.fromEntries(Object.entries(files).filter(([, v]) => v !== undefined)) as Record<string, string | Uint8Array>)
}

function reasonOf(fn: () => unknown): SceneFileErrorReason | undefined {
  try {
    fn()
  } catch (e) {
    if (e instanceof SceneFileError) return e.reason
    throw e
  }
  return undefined
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v, i) => v === b[i])

describe('scene file', () => {
  it('round-trips a scene with its layers', () => {
    const layers = shapedLayers()
    const read = readSceneFile(writeSceneFile(scene, layers))
    expect(read.scene).toEqual(scene)
    expect(same(read.layers.heights.data, layers.heights.data)).toBe(true)
    expect(same(read.layers.biomes.data, layers.biomes.data)).toBe(true)
    expect(read.layers.heights.size).toBe(64)
  })

  it('opens a v1 file as flat meadow', () => {
    const { generatorVersion: _g, ...v1 } = { ...scene, formatVersion: 1 }
    const read = readSceneFile(zipWith({ 'scene.json': JSON.stringify(v1) }))
    expect(read.scene).toEqual({ ...scene, formatVersion: 2, generatorVersion: 1 })
    expect(same(read.layers.heights.data, createFlatLayers(64).heights.data)).toBe(true)
    expect(same(read.layers.biomes.data, createFlatLayers(64).biomes.data)).toBe(true)
  })

  it('rejects bytes that are not a zip', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 73 + 11) % 256
    expect(reasonOf(() => readSceneFile(bytes))).toBe('not-a-zip')
  })

  it('rejects a zip without scene.json', () => {
    expect(reasonOf(() => readSceneFile(zipWith({ 'other.txt': 'hi' })))).toBe('missing-scene-json')
  })

  it('rejects invalid JSON', () => {
    expect(reasonOf(() => readSceneFile(zipWith({ 'scene.json': '{' })))).toBe('invalid-json')
  })

  it.each([
    ['size 100', { ...scene, size: 100 }],
    ['missing id', (({ id: _id, ...rest }) => rest)(scene)],
    ['numeric name', { ...scene, name: 5 }],
  ])('rejects a wrong shape (%s)', (_label, data) => {
    expect(reasonOf(() => readSceneFile(v2Zip({ 'scene.json': JSON.stringify(data) })))).toBe('invalid-scene')
  })

  it('reports a newer format version before checking the shape', () => {
    expect(reasonOf(() => parseScene({ formatVersion: 3 }))).toBe('newer-version')
    expect(reasonOf(() => readSceneFile(v2Zip({ 'scene.json': JSON.stringify({ ...scene, formatVersion: 3 }) })))).toBe(
      'newer-version',
    )
  })

  it('rejects missing, wrong-sized or non-finite layer data', () => {
    expect(reasonOf(() => readSceneFile(v2Zip({ 'heightmap.f32': undefined })))).toBe('invalid-layers')
    expect(reasonOf(() => readSceneFile(v2Zip({ 'biomes.rgba8': new Uint8Array(10) })))).toBe('invalid-layers')
    const nan = createFlatLayers(64).heights.data
    nan[100] = NaN
    expect(reasonOf(() => readSceneFile(v2Zip({ 'heightmap.f32': bytesOf(nan) })))).toBe('invalid-layers')
  })

  it('clamps out-of-range heights and renormalises biome weights', () => {
    const h = createFlatLayers(64).heights.data
    h[5] = 100
    h[6] = -100
    const b = createFlatLayers(64).biomes.data
    b.set([10, 10, 0, 0], 0)
    b.set([0, 0, 0, 0], 4)
    const read = readSceneFile(v2Zip({ 'heightmap.f32': bytesOf(h), 'biomes.rgba8': b }))
    expect(read.layers.heights.data[5]).toBe(64)
    expect(read.layers.heights.data[6]).toBe(-32)
    const s0 = [...read.layers.biomes.data.subarray(0, 4)]
    expect(s0.reduce((a, c) => a + c, 0)).toBe(255)
    expect(s0[0]).toBeGreaterThanOrEqual(127)
    expect([...read.layers.biomes.data.subarray(4, 8)]).toEqual([255, 0, 0, 0])
  })

  it('builds layers from buffers or rejects them', () => {
    const l = createFlatLayers(64)
    expect(layersFromBuffers(64, l.heights.data.slice().buffer, l.biomes.data.slice().buffer).heights.resolution).toBe(129)
    expect(reasonOf(() => layersFromBuffers(64, undefined, l.biomes.data.slice().buffer))).toBe('invalid-layers')
  })

  it('SceneFileError is an Error with a reason', () => {
    const e = new SceneFileError('invalid-layers')
    expect(e).toBeInstanceOf(Error)
    expect(e.reason).toBe('invalid-layers')
  })
})
