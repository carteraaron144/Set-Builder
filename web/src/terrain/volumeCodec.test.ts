import { describe, expect, it } from 'vitest'
import { SceneFileError } from '../scene/sceneFile'
import { decodeVolume, encodeVolume } from './volumeCodec'
import { brickKey, MAX_BRICKS, VolumeLayer, type Brick } from './volume'

const brick = (fill: number): Brick => ({ a: new Int8Array(512).fill(fill), k: new Int8Array(512).fill(-64) })

function layer(...keys: [number, number, number][]): VolumeLayer {
  const v = new VolumeLayer(64)
  keys.forEach((k, n) => v.put(brickKey(...k), brick(n)))
  return v
}

const reason = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    return e instanceof SceneFileError ? e.reason : 'other'
  }
  return 'none'
}

/** One raw brick record at (bx, by, bz). */
function raw(bx: number, by: number, bz: number, value = 0): Uint8Array {
  const out = new Uint8Array(6 + 1024).fill(0)
  const view = new DataView(out.buffer)
  view.setInt16(0, bx, true)
  view.setInt16(2, by, true)
  view.setInt16(4, bz, true)
  out.fill(value & 255, 6)
  return out
}

function file(count: number, ...records: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(4 + records.length * 1030)
  new DataView(out.buffer).setUint32(0, count, true)
  records.forEach((r, n) => out.set(r, 4 + n * 1030))
  return out
}

describe('volume codec', () => {
  it('round-trips three bricks, in ascending key order', () => {
    const v = layer([5, 2, 7], [0, -3, 1], [16, 16, 0])
    const bytes = encodeVolume(v)
    expect(bytes.byteLength).toBe(4 + 3 * 1030)
    const d = decodeVolume(64, bytes)
    expect([...d.keys()].sort()).toEqual([...v.keys()].sort())
    for (const k of v.keys()) {
      expect(d.get(k)!.a).toEqual(v.get(k)!.a)
      expect(d.get(k)!.k).toEqual(v.get(k)!.k)
    }
    expect(encodeVolume(d)).toEqual(bytes)
  })

  it('treats a missing entry as no bricks', () => {
    expect(decodeVolume(64, undefined).count).toBe(0)
  })

  it('rejects a truncated buffer, an empty one and a wrong length', () => {
    const bytes = encodeVolume(layer([1, 1, 1]))
    expect(reason(() => decodeVolume(64, bytes.slice(0, bytes.length - 1)))).toBe('invalid-layers')
    expect(reason(() => decodeVolume(64, new Uint8Array(2)))).toBe('invalid-layers')
    expect(reason(() => decodeVolume(64, file(2, raw(1, 1, 1))))).toBe('invalid-layers')
  })

  it('rejects a duplicate key', () => {
    expect(reason(() => decodeVolume(64, file(2, raw(1, 1, 1), raw(1, 1, 1))))).toBe('invalid-layers')
  })

  it('rejects a count above the cap', () => {
    expect(reason(() => decodeVolume(64, file(MAX_BRICKS + 1)))).toBe('invalid-layers')
  })

  it('rejects bricks outside the scene square or height range', () => {
    for (const [x, y, z] of [[-1, 0, 0], [0, 0, -1], [17, 0, 0], [0, 0, 17], [0, -9, 0], [0, 17, 0]]) {
      expect(reason(() => decodeVolume(64, file(1, raw(x, y, z))))).toBe('invalid-layers')
    }
    expect(reason(() => decodeVolume(64, file(1, raw(16, 16, 16))))).toBe('none')
    expect(reason(() => decodeVolume(64, file(1, raw(0, -8, 0))))).toBe('none')
  })

  it('rejects values outside -64..64', () => {
    expect(reason(() => decodeVolume(64, file(1, raw(1, 1, 1, 65))))).toBe('invalid-layers')
    expect(reason(() => decodeVolume(64, file(1, raw(1, 1, 1, -65))))).toBe('invalid-layers')
  })

  it('drops all-default bricks', () => {
    expect(decodeVolume(64, file(1, raw(1, 1, 1, -64))).count).toBe(0)
  })
})
