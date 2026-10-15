import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Color, DoubleSide, type Group } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import { MATERIAL_PALETTE } from '../scatter/rules'
import { assetInfoOf, loadAssetLibrary } from './assetLibrary'

const PACKS = resolve(__dirname, '../../../packs')
const listing = [{ id: 'setbuilder-basics', name: 'Set Builder Basics', version: '1.0.0', source: 'x', licence: 'CC0-1.0' }]

type Override = Record<string, Response | 'network-error'>

function stubFetch(over: Override = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const o = over[url]
    if (o === 'network-error') throw new TypeError('Failed to fetch')
    if (o) return o
    if (url === '/api/asset-packs') return new Response(JSON.stringify(listing))
    if (url.startsWith('/packs/')) {
      try {
        return new Response(readFileSync(resolve(PACKS, url.slice('/packs/'.length))))
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

const parseGlb = (bytes: ArrayBuffer): Promise<Group> => new GLTFLoader().parseAsync(bytes, '').then((g) => g.scene)

describe('loadAssetLibrary', () => {
  it('loads the basics pack with parts grouped by palette slot', async () => {
    const lib = await loadAssetLibrary({ fetch: stubFetch(), parseGlb })
    expect(lib.problems).toEqual([])
    expect(lib.assets.size).toBe(11)
    const pine = lib.assets.get('setbuilder-basics/pine')!
    expect(pine.parts.map((p) => p.slot).sort()).toEqual(['bark', 'pine'])
    pine.parts[0].geometry.computeBoundingBox()
    const all = pine.parts.map((p) => (p.geometry.computeBoundingBox(), p.geometry.boundingBox!))
    expect(Math.min(...all.map((b) => b.min.y))).toBeCloseTo(0, 4)
    expect(Math.max(...all.map((b) => b.max.y))).toBeGreaterThan(6)
    expect(assetInfoOf(lib)['setbuilder-basics/pillar-single'].lengthRange).toEqual([2, 18])
  })

  it('builds one flat-shaded material per slot from the palette', async () => {
    const lib = await loadAssetLibrary({ fetch: stubFetch(), parseGlb })
    const m = lib.materials.stone
    expect(m.flatShading).toBe(true)
    expect(m.roughness).toBe(1)
    expect(m.metalness).toBe(0)
    expect(m.color.getHex()).toBe(new Color(MATERIAL_PALETTE.stone).getHex())
    expect(lib.materials.grass.side).toBe(DoubleSide)
  })

  it.each([
    ['a server error', { '/api/asset-packs': new Response('boom', { status: 500 }) }],
    ['a network error', { '/api/asset-packs': 'network-error' as const }],
  ])('gives an empty library with a problem on %s', async (_label, over) => {
    const lib = await loadAssetLibrary({ fetch: stubFetch(over), parseGlb })
    expect(lib.assets.size).toBe(0)
    expect(lib.problems.length).toBeGreaterThan(0)
  })

  it('skips a malformed pack.json', async () => {
    const lib = await loadAssetLibrary({ fetch: stubFetch({ '/packs/setbuilder-basics/pack.json': new Response('{"name":') }), parseGlb })
    expect(lib.assets.size).toBe(0)
    expect(lib.problems.join()).toMatch(/setbuilder-basics/)
  })

  it('skips missing or corrupt models and keeps the rest', async () => {
    const lib = await loadAssetLibrary({
      fetch: stubFetch({
        '/packs/setbuilder-basics/models/pine.glb': new Response('nope', { status: 404 }),
        '/packs/setbuilder-basics/models/bush.glb': new Response(new Uint8Array([1, 2, 3, 4])),
      }),
      parseGlb,
    })
    expect(lib.assets.has('setbuilder-basics/pine')).toBe(false)
    expect(lib.assets.has('setbuilder-basics/bush')).toBe(false)
    expect(lib.assets.size).toBe(9)
    expect(lib.problems).toHaveLength(2)
  })

  it('maps an unknown material name to stone with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rockBytes = new Uint8Array(readFileSync(resolve(PACKS, 'setbuilder-basics/models/rock-small.glb'))).buffer
    const glb = await parseGlb(rockBytes)
    glb.traverse((o) => {
      const mesh = o as { material?: { name: string } }
      if (mesh.material) mesh.material.name = 'marble'
    })
    const lib = await loadAssetLibrary({ fetch: stubFetch(), parseGlb: async (b) => (b.byteLength === rockBytes.byteLength ? glb : parseGlb(b)) })
    expect(lib.assets.get('setbuilder-basics/rock-small')!.parts[0].slot).toBe('stone')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
