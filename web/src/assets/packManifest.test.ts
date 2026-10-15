import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePackManifest } from './packManifest'

const committed = () => JSON.parse(readFileSync(resolve(__dirname, '../../../packs/setbuilder-basics/pack.json'), 'utf8'))
const valid = {
  name: 'P',
  version: '1',
  source: 's',
  licence: 'CC0-1.0',
  assets: [{ id: 'a', file: 'models/a.glb', kind: 'rock', footprint: 1, collision: 'none' }],
}

describe('parsePackManifest', () => {
  it('accepts the committed basics pack', () => {
    const m = parsePackManifest(committed())
    expect(m.licence).toBe('CC0-1.0')
    expect(m.assets).toHaveLength(11)
  })

  it('accepts a minimal valid manifest', () => {
    expect(parsePackManifest(valid).assets[0].id).toBe('a')
  })

  it.each([
    ['missing licence', { ...valid, licence: undefined }],
    ['unknown kind', { ...valid, assets: [{ ...valid.assets[0], kind: 'house' }] }],
    ['negative footprint', { ...valid, assets: [{ ...valid.assets[0], footprint: -1 }] }],
    ['path escape', { ...valid, assets: [{ ...valid.assets[0], file: '../x.glb' }] }],
  ])('rejects %s', (_label, data) => {
    expect(() => parsePackManifest(data)).toThrow()
  })
})
