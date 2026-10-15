import { beforeAll, describe, expect, it } from 'vitest'
import type { AssetLibrary } from '../assets/assetLibrary'
import { assetInfoOf } from '../assets/assetLibrary'
import { createScene } from '../scene/scene'
import { rulesFor } from '../scatter/rules'
import { scatterChunk, type Instance } from '../scatter/scatter'
import { paint } from '../terrain/brush'
import { createFlatLayers } from '../terrain/layers'
import { loadBasicsLibrary } from '../test/basicsLibrary'
import { readGlbJson, writeGlb } from './exportGlb'
import { buildExportScene, EXPORT_DEFAULTS } from './exportScene'

let library: AssetLibrary
let bytes: Uint8Array

beforeAll(async () => {
  library = await loadBasicsLibrary()
  const scene = createScene({ size: 64, name: 'Glb Test', seed: 9 })
  const layers = createFlatLayers(64)
  paint(layers.biomes, 'rocky', { radius: 30, strength: 1, falloff: 0 }, { x: 0, z: 0, dt: 1, invert: false })
  const rules = rulesFor(2)
  const instancesByRule: Instance[][] = rules.rules.map(() => [])
  for (let c = 0; c < 4; c++) for (const i of scatterChunk({ layers, seed: 9, rules, exclusion: null }, c, assetInfoOf(library)).instances) instancesByRule[i.rule].push(i)
  bytes = await writeGlb(buildExportScene({ scene, layers, instancesByRule, rules, library }, EXPORT_DEFAULTS))
})

describe('writeGlb', () => {
  it('writes a glTF 2.0 binary', () => {
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF')
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true)).toBe(2)
    expect(readGlbJson(bytes).asset.version).toBe('2.0')
  })

  it('keeps names, -col nodes, colours and no normals', () => {
    const json = readGlbJson(bytes)
    const names = json.nodes.map((n) => n.name)
    expect(names).toContain('Glb Test')
    expect(names).toContain('terrain_c0_0')
    expect(names).toContain('terrain_c0_0-col')
    expect(names.some((n) => /^rock-large_\d{5}-col$/.test(n ?? ''))).toBe(true)
    for (const mesh of json.meshes) for (const p of mesh.primitives) expect(p.attributes.NORMAL).toBeUndefined()
    const terrainMesh = json.meshes[json.nodes.find((n) => n.name === 'terrain_c0_0')!.mesh!]
    expect(terrainMesh.primitives[0].attributes.COLOR_0).toBeDefined()
  })

  it('shares one mesh between the nodes of one asset', () => {
    const json = readGlbJson(bytes)
    const rocks = json.nodes.filter((n) => /^rock-large_\d{5}$/.test(n.name ?? ''))
    expect(rocks.length).toBeGreaterThan(1)
    expect(new Set(rocks.map((n) => n.mesh)).size).toBe(1)
  })
})
