import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createScene } from './scene'
import { parseScene, readSceneFile, SceneFileError, writeSceneFile, type SceneFileErrorReason } from './sceneFile'

const scene = createScene({ size: 128, now: new Date('2026-10-15T12:00:00Z'), id: 'a', seed: 7, name: 'Forest' })

function zipWith(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text)
  return zipSync(entries)
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

describe('scene file', () => {
  it('round-trips a scene', () => {
    expect(readSceneFile(writeSceneFile(scene))).toEqual(scene)
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
    expect(reasonOf(() => readSceneFile(zipWith({ 'scene.json': JSON.stringify(data) })))).toBe('invalid-scene')
  })

  it('reports a newer format version before checking the shape', () => {
    expect(reasonOf(() => parseScene({ formatVersion: 2 }))).toBe('newer-version')
    expect(reasonOf(() => readSceneFile(zipWith({ 'scene.json': JSON.stringify({ ...scene, formatVersion: 2 }) })))).toBe(
      'newer-version',
    )
  })

  it('SceneFileError is an Error with a reason', () => {
    const e = new SceneFileError('invalid-json')
    expect(e).toBeInstanceOf(Error)
    expect(e.reason).toBe('invalid-json')
  })
})
