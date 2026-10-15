import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePackManifest, PALETTE_SLOTS } from '../assets/packManifest'
import { MATERIAL_PALETTE, parseRules, rulesFor } from './rules'

const basics = parsePackManifest(JSON.parse(readFileSync(resolve(__dirname, '../../../packs/setbuilder-basics/pack.json'), 'utf8')))
const rules = rulesFor(2)

describe('scatter rules', () => {
  it('loads generator 2 rules with the instance budget', () => {
    expect(rules.maxInstances).toBe(100000)
    expect(rules.rules.length).toBeGreaterThan(10)
  })

  it('keeps every density under the one-per-cell ceiling', () => {
    for (const r of rules.rules) expect(r.density, r.asset).toBeLessThanOrEqual(2 / r.minSpacing ** 2)
  })

  it('references assets that exist in the basics pack', () => {
    const ids = new Set(basics.assets.map((a) => `setbuilder-basics/${a.id}`))
    for (const r of rules.rules) expect(ids.has(r.asset), r.asset).toBe(true)
  })

  it('has cliff face rules for every biome, ahead of all ground rules', () => {
    const firstGround = rules.rules.findIndex((r) => r.placement === 'ground')
    const faces = rules.rules.filter((r) => r.placement === 'face')
    expect(faces.length).toBeGreaterThan(0)
    for (const f of faces) expect(f.biome).toBe('any')
    expect(rules.rules.slice(0, firstGround).every((r) => r.placement === 'face')).toBe(true)
    expect(rules.rules.slice(firstGround).every((r) => r.placement === 'ground')).toBe(true)
  })

  it('throws for an unknown generator version', () => {
    expect(() => rulesFor(99)).toThrow()
  })

  const base = rules.rules.find((r) => r.placement === 'ground')!
  const face = rules.rules.find((r) => r.placement === 'face')!
  it.each([
    ['negative density', { ...base, density: -1 }],
    ['scale min > max', { ...base, scale: [2, 1] }],
    ['face rule without minSlopeDeg', { ...face, minSlopeDeg: undefined }],
    ['face rule without minWallHeight', { ...face, minWallHeight: undefined }],
    ['face rule without sinkDepth', { ...face, sinkDepth: undefined }],
    ['ground rule steeper than the face threshold', { ...base, maxSlopeDeg: 70 }],
  ])('rejects %s', (_label, bad) => {
    expect(() => parseRules({ maxInstances: 100, rules: [face, bad] })).toThrow()
  })

  it('has a colour for every palette slot', () => {
    for (const slot of PALETTE_SLOTS) expect(MATERIAL_PALETTE[slot]).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
