import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { paint, sculpt } from '../terrain/brush'
import { createFlatLayers, type TerrainLayers } from '../terrain/layers'
import { brickKey } from '../terrain/volume'
import { createScene, type Scene } from './scene'
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
    expect(read.scene).toEqual({ ...scene, formatVersion: 5, generatorVersion: 5 })
    expect(same(read.layers.heights.data, createFlatLayers(64).heights.data)).toBe(true)
    expect(same(read.layers.biomes.data, createFlatLayers(64).biomes.data)).toBe(true)
  })

  it('opens a v2 scene as v5 with no features', () => {
    const { features: _f, ...rest } = scene
    for (const generatorVersion of [1, 2]) {
      const read = readSceneFile(v2Zip({ 'scene.json': JSON.stringify({ ...rest, formatVersion: 2, generatorVersion }) }))
      expect(read.scene).toEqual({ ...scene, formatVersion: 5, generatorVersion: 5, features: { splines: [], ponds: [], caves: [] } })
    }
  })

  it('round-trips features', () => {
    const withFeatures: Scene = {
      ...scene,
      features: {
        splines: [
          { id: 's1', kind: 'path', style: 'cobble', width: 3, points: [{ x: -5, z: 0 }, { x: 0, z: 4 }, { x: 6, z: 2 }] },
          { id: 's2', kind: 'river', style: 'dirt', width: 4, points: [{ x: -30, z: -30 }, { x: 30, z: 30 }] },
        ],
        ponds: [{ id: 'w1', seed: { x: 3, z: -3 }, level: 1.25 }],
        caves: [{ id: 'c1', radius: 2.5, points: [{ x: 4, y: 1, z: 4, chamber: 0 }, { x: 10, y: -2, z: 8, chamber: 7 }] }],
      },
    }
    expect(readSceneFile(writeSceneFile(withFeatures, shapedLayers())).scene).toEqual(withFeatures)
  })

  it('opens a v3 scene as v5 with no caves', () => {
    const v3 = { ...scene, formatVersion: 3, generatorVersion: 3, features: { splines: [], ponds: [{ id: 'w', seed: { x: 0, z: 0 }, level: 1 }] } }
    expect(parseScene(v3)).toEqual({ ...scene, features: { splines: [], ponds: [{ id: 'w', seed: { x: 0, z: 0 }, level: 1 }], caves: [] } })
  })

  it('reports a newer scene format', () => {
    expect(reasonOf(() => parseScene({ ...scene, formatVersion: 6 }))).toBe('newer-version')
  })

  it('clamps feature widths on load', () => {
    const wide = { ...scene, features: { splines: [{ id: 's', kind: 'path', style: 'dirt', width: 20, points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] }], ponds: [] } }
    expect(parseScene(wide).features.splines[0].width).toBe(8)
  })

  it.each([
    ['a point outside the scene', { splines: [{ id: 's', kind: 'path', style: 'dirt', width: 2, points: [{ x: 33, z: 0 }, { x: 0, z: 0 }] }], ponds: [] }],
    ['a 1-point spline', { splines: [{ id: 's', kind: 'path', style: 'dirt', width: 2, points: [{ x: 0, z: 0 }] }], ponds: [] }],
    ['201 splines', { splines: Array.from({ length: 201 }, (_, i) => ({ id: `s${i}`, kind: 'path', style: 'dirt', width: 2, points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] })), ponds: [] }],
    ['missing features', undefined],
  ])('rejects a v3 scene with %s', (_label, features) => {
    expect(reasonOf(() => parseScene({ ...scene, features }))).toBe('invalid-scene')
  })

  it('reports a scene made by a newer generator instead of opening it', () => {
    expect(reasonOf(() => readSceneFile(v2Zip({ 'scene.json': JSON.stringify({ ...scene, generatorVersion: 6 }) })))).toBe('newer-version')
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
    expect(reasonOf(() => parseScene({ formatVersion: 6 }))).toBe('newer-version')
    expect(reasonOf(() => readSceneFile(v2Zip({ 'scene.json': JSON.stringify({ ...scene, formatVersion: 6 }) })))).toBe(
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

  it('round-trips bricks in a volumetric scene', () => {
    const vol = createScene({ size: 64, mapMode: 'volumetric', now: new Date('2026-10-15T12:00:00Z'), id: 'v', seed: 7 })
    const l = createFlatLayers(64)
    l.volume.put(brickKey(3, 1, 4), { a: new Int8Array(512).fill(20), k: new Int8Array(512).fill(-64) })
    l.volume.put(brickKey(0, -2, 9), { a: new Int8Array(512).fill(-64), k: new Int8Array(512).fill(5) })
    const read = readSceneFile(writeSceneFile(vol, l))
    expect(read.scene.mapMode).toBe('volumetric')
    expect(read.layers.volume.count).toBe(2)
    expect(read.layers.volume.get(brickKey(3, 1, 4))!.a[0]).toBe(20)
    expect(read.layers.volume.get(brickKey(0, -2, 9))!.k[511]).toBe(5)
  })

  it('opens a v4 scene as a heightmap scene with no bricks', () => {
    const { mapMode: _m, ...rest } = scene
    const read = readSceneFile(v2Zip({ 'scene.json': JSON.stringify({ ...rest, formatVersion: 4, generatorVersion: 4 }) }))
    expect(read.scene).toMatchObject({ formatVersion: 5, generatorVersion: 5, mapMode: 'heightmap' })
    expect(read.layers.volume.count).toBe(0)
  })

  it('rejects bricks in a heightmap scene, and a malformed volume entry', () => {
    const l = createFlatLayers(64)
    l.volume.put(brickKey(1, 1, 1), { a: new Int8Array(512).fill(3), k: new Int8Array(512).fill(-64) })
    expect(reasonOf(() => readSceneFile(writeSceneFile(scene, l)))).toBe('invalid-layers')
    expect(reasonOf(() => readSceneFile(v2Zip({ 'volume.i8': new Uint8Array(7) })))).toBe('invalid-layers')
  })

  it('ignores volume bricks and a volumetric mode in files older than format 5', () => {
    const l = createFlatLayers(64)
    l.volume.put(brickKey(1, 1, 1), { a: new Int8Array(512).fill(3), k: new Int8Array(512).fill(-64) })
    const volume = writeSceneFile(createScene({ size: 64, mapMode: 'volumetric' }), l)
    const bricks = new Uint8Array(4 + 1030)
    new DataView(bricks.buffer).setUint32(0, 1, true)
    bricks[4 + 2] = 1
    const { mapMode: _m, ...rest } = scene
    for (const formatVersion of [3, 4]) {
      const json = JSON.stringify({ ...rest, mapMode: 'volumetric', formatVersion, generatorVersion: formatVersion, features: { splines: [], ponds: [], caves: [] } })
      const read = readSceneFile(v2Zip({ 'scene.json': json, 'volume.i8': bricks }))
      expect(read.scene.mapMode).toBe('heightmap')
      expect(read.layers.volume.count).toBe(0)
    }
    expect(volume.length).toBeGreaterThan(0)
  })
})
