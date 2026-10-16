import { Mesh, type BufferGeometry, type Material, type Object3D } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AssetLibrary } from '../assets/assetLibrary'
import { assetInfoOf } from '../assets/assetLibrary'
import type { Features } from '../features/features'
import { Ground } from '../features/ground'
import { createScene } from '../scene/scene'
import { rulesFor } from '../scatter/rules'
import { scatterChunk, type Instance } from '../scatter/scatter'
import { paint, sculpt } from '../terrain/brush'
import { buildChunkGeometry } from '../terrain/chunks'
import { cloneLayers, createFlatLayers } from '../terrain/layers'
import { DEFAULT_PALETTE } from '../terrain/palette'
import { loadBasicsLibrary } from '../test/basicsLibrary'
import { buildExportScene, EXPORT_DEFAULTS, type ExportOptions } from './exportScene'

let library: AssetLibrary
const scene = createScene({ size: 64, name: 'Export Test', seed: 3 })
const layers = createFlatLayers(64)
const rules = rulesFor(2)
let instancesByRule: Instance[][]

beforeAll(async () => {
  library = await loadBasicsLibrary()
  paint(layers.biomes, 'forest', { radius: 14, strength: 1, falloff: 0 }, { x: -14, z: -14, dt: 1, invert: false })
  paint(layers.biomes, 'rocky', { radius: 10, strength: 1, falloff: 0 }, { x: 16, z: -16, dt: 1, invert: false })
  sculpt(layers.heights, 'raise', { radius: 6, strength: 1, falloff: 0 }, { x: 14, z: 16, dt: 1.2, invert: false }, { flattenTo: 0, seed: 1 })
  const assets = assetInfoOf(library)
  const inp = { layers, seed: scene.seed, rules, exclusion: null }
  instancesByRule = rules.rules.map(() => [])
  for (let c = 0; c < 4; c++) for (const i of scatterChunk(inp, c, assets).instances) instancesByRule[i.rule].push(i)
})

const build = (o: Partial<ExportOptions> = {}) => buildExportScene({ scene, layers, instancesByRule, rules, library }, { ...EXPORT_DEFAULTS, ...o })
const meshes = (o: Object3D) => {
  const out: Mesh[] = []
  o.traverse((c) => c instanceof Mesh && out.push(c))
  return out
}
const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3
const assetOf = (i: Instance) => rules.rules[i.rule].asset.split('/')[1]
const kindOf = (i: Instance) => library.assets.get(rules.rules[i.rule].asset)!.asset.kind
const exported = (includeGrass: boolean) => instancesByRule.flat().filter((i) => includeGrass || !['grass', 'plant'].includes(kindOf(i)))

describe('buildExportScene', () => {
  it('has the defaults from the plan', () => {
    expect(EXPORT_DEFAULTS).toEqual({ grouping: 'element', collision: true, includeGrass: false })
  })

  it('builds terrain chunks with colours and no normals', () => {
    const root = build()
    expect(root.name).toBe('Export Test')
    expect(root.children.map((c) => c.name)).toEqual(['terrain', 'scatter'])
    const terrain = root.getObjectByName('terrain')!
    const chunks = terrain.children.filter((c) => !c.name.endsWith('-col')).map((c) => c.name)
    expect(chunks).toEqual(['terrain_c0_0', 'terrain_c1_0', 'terrain_c0_1', 'terrain_c1_1'])
    const c3 = root.getObjectByName('terrain_c1_1') as Mesh
    expect([...c3.geometry.getAttribute('position').array]).toEqual([...buildChunkGeometry(layers, 3, DEFAULT_PALETTE).positions])
    expect(c3.geometry.getAttribute('color')).toBeDefined()
    for (const m of meshes(root)) expect(m.geometry.getAttribute('normal'), m.name).toBeUndefined()
  })

  it('exports one node per element sharing geometry, leaving grass out by default', () => {
    const root = build({ collision: false })
    const scatter = root.getObjectByName('scatter')!
    const nodes = scatter.children
    const expected = exported(false)
    expect(nodes).toHaveLength(expected.length)
    expect(nodes.some((n) => n.name.startsWith('grass-tuft') || n.name.startsWith('reeds'))).toBe(false)
    expect(nodes[0].name).toMatch(/^[a-z0-9-]+_\d{5}$/)
    const first = expected[0]
    expect(nodes[0].name).toBe(`${assetOf(first)}_00000`)
    expect(nodes[0].position.toArray()).toEqual([first.x, first.y, first.z])
    expect(nodes[0].quaternion.toArray().map((v) => +v.toFixed(6))).toEqual(first.quat.map((v) => +v.toFixed(6)))
    expect(nodes[0].scale.toArray().map((v) => +v.toFixed(6))).toEqual(first.scale.map((v) => +v.toFixed(6)))
    const pines = nodes.filter((n) => n.name.startsWith('pine_'))
    expect(pines.length).toBeGreaterThan(1)
    const geoms = new Set(pines.flatMap((p) => meshes(p).map((m) => m.geometry)))
    expect(geoms.size).toBe(library.assets.get('setbuilder-basics/pine')!.parts.length)
    expect(build({ collision: false, includeGrass: true }).getObjectByName('scatter')!.children).toHaveLength(exported(true).length)
  })

  it('merges per chunk with one group per material', () => {
    const root = build({ grouping: 'chunk', collision: false })
    const names = meshes(root).map((m) => m.name)
    expect(names).toEqual(['chunk_0_0', 'chunk_1_0', 'chunk_0_1', 'chunk_1_1'])
    const total = meshes(root).reduce((a, m) => a + tris(m.geometry), 0)
    const terrainTris = 4 * 64 * 64 * 2
    const elementTris = exported(false).reduce((a, i) => a + library.assets.get(rules.rules[i.rule].asset)!.parts.reduce((b, p) => b + tris(p.geometry), 0), 0)
    expect(total).toBe(terrainTris + elementTris)
    for (const m of meshes(root)) {
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.name)
      expect(new Set(mats).size).toBe(mats.length)
      expect(m.geometry.groups.length).toBe(mats.length)
    }
  })

  it('merges everything into one mesh', () => {
    const merged = build({ grouping: 'merged', collision: false })
    expect(meshes(merged).map((m) => m.name)).toEqual(['scene'])
    expect(merged.children.map((c) => c.name)).toEqual(['scene'])
    expect(build({ grouping: 'chunk', collision: false }).children.map((c) => c.name)).toEqual(['chunk_0_0', 'chunk_1_0', 'chunk_0_1', 'chunk_1_1'])
  })

  it('adds -col meshes: terrain at 1 m, trees as cylinders, rocks and pillars as boxes', () => {
    const root = build()
    const col = meshes(root).filter((m) => m.name.endsWith('-col'))
    const t = root.getObjectByName('terrain_c0_0-col') as Mesh
    expect(t.geometry.getAttribute('position').count).toBe(33 * 33)
    const pineCol = col.find((m) => m.name.startsWith('pine_'))!
    expect(tris(pineCol.geometry)).toBe(8 * 4)
    const rockCol = col.find((m) => m.name.startsWith('rock-'))!
    expect(tris(rockCol.geometry)).toBe(12)
    expect(col.some((m) => m.name.startsWith('bush_'))).toBe(false)
    for (const m of col) expect((m.material as { name: string }).name).toBe('collision')
    expect(meshes(build({ collision: false })).some((m) => m.name.endsWith('-col'))).toBe(false)
    expect(meshes(build({ grouping: 'chunk' })).filter((m) => m.name.endsWith('-col')).map((m) => m.name)).toEqual([
      'chunk_0_0-col', 'chunk_1_0-col', 'chunk_0_1-col', 'chunk_1_1-col',
    ])
    expect(meshes(build({ grouping: 'merged' })).map((m) => m.name)).toEqual(['scene', 'scene-col'])
  })

  it('names materials by role with roughness 1 and metalness 0', () => {
    const names = new Set<string>()
    for (const m of meshes(build({ includeGrass: true })))
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        names.add(mat.name)
        expect((mat as unknown as { roughness: number }).roughness).toBe(1)
        expect((mat as unknown as { metalness: number }).metalness).toBe(0)
      }
    expect([...names].sort()).toEqual(['bark', 'collision', 'grass', 'leaf', 'pine', 'stone', 'terrain'].sort())
  })
})

describe('buildExportScene with features', () => {
  const features: Features = {
    splines: [
      { id: 'p', kind: 'path', style: 'dirt', width: 2, points: [{ x: -25, z: -5 }, { x: 25, z: -5 }] },
      { id: 'r', kind: 'river', style: 'dirt', width: 3, points: [{ x: -25, z: 8 }, { x: 0, z: 8 }] },
    ],
    ponds: [{ id: 'w', seed: { x: -14, z: 16 }, level: -0.1 }],
    caves: [],
  }
  /** The shared layers with a dip for the pond. */
  const dipped = () => {
    const l = cloneLayers(layers)
    sculpt(l.heights, 'lower', { radius: 5, strength: 1, falloff: 0.5 }, { x: -14, z: 16, dt: 1, invert: false }, { flattenTo: 0, seed: 1 })
    return l
  }
  const ground = () => new Ground(dipped(), features)
  const buildWith = (o: Partial<ExportOptions> = {}) =>
    buildExportScene({ scene, layers, ground: ground(), instancesByRule, rules, library }, { ...EXPORT_DEFAULTS, ...o })

  it('exports each river and pond as a water node with no collision', () => {
    const root = buildWith()
    for (const name of ['River 1', 'Pond 1']) {
      const m = root.getObjectByName(name) as Mesh
      expect(m, name).toBeInstanceOf(Mesh)
      expect((m.material as Material).name).toBe('water')
      expect(root.getObjectByName(`${name}-col`)).toBeUndefined()
    }
    for (const grouping of ['chunk', 'merged'] as const) {
      const r = buildWith({ grouping })
      expect(r.getObjectByName('River 1'), grouping).toBeDefined()
      expect(r.getObjectByName('Pond 1'), grouping).toBeDefined()
    }
  })

  it('builds the terrain from the carved heights with the path surface colours', () => {
    const g = ground()
    const root = buildWith()
    const c0 = root.getObjectByName('terrain_c0_0') as Mesh
    const expected = buildChunkGeometry(g.layers, 0, DEFAULT_PALETTE, g.surface)
    expect([...c0.geometry.getAttribute('position').array]).toEqual([...expected.positions])
    expect([...c0.geometry.getAttribute('color').array]).toEqual([...expected.colors])
    expect([...expected.colors]).not.toEqual([...buildChunkGeometry(layers, 0, DEFAULT_PALETTE).colors])
  })
})


describe('buildExportScene with caves', () => {
  const features: Features = {
    splines: [],
    ponds: [],
    caves: [{ id: 'c', radius: 2, points: [{ x: -25, y: -3, z: -20, chamber: 0 }, { x: -10, y: -3, z: -20, chamber: 5 }] }],
  }

  it('exports an SDF chunk under its node name with its render mesh as -col; other chunks as before', () => {
    const ground = new Ground(cloneLayers(layers), features)
    expect(ground.isSdfChunk(0)).toBe(true)
    const root = buildExportScene({ scene, layers, ground, instancesByRule, rules, library }, EXPORT_DEFAULTS)
    const c0 = root.getObjectByName('terrain_c0_0') as Mesh
    const col0 = root.getObjectByName('terrain_c0_0-col') as Mesh
    const expected = ground.chunkGeometry(0)
    expect([...c0.geometry.getAttribute('position').array]).toEqual([...expected.positions])
    expect([...c0.geometry.getAttribute('color').array]).toEqual([...expected.colors])
    expect([...c0.geometry.index!.array]).toEqual([...expected.indices])
    expect([...col0.geometry.getAttribute('position').array]).toEqual([...expected.positions])
    expect([...col0.geometry.index!.array]).toEqual([...expected.indices])
    const col1 = root.getObjectByName('terrain_c1_0-col') as Mesh
    expect(col1.geometry.getAttribute('position').count).toBe(33 * 33)
    // Grouped exports merge the SDF chunk with heightmap chunks.
    const merged = buildExportScene({ scene, layers, ground, instancesByRule, rules, library }, { ...EXPORT_DEFAULTS, grouping: 'merged' })
    const sceneCol = merged.getObjectByName('scene-col') as Mesh
    expect(sceneCol.geometry.getAttribute('position').count).toBeGreaterThan(3 * 33 * 33 + expected.positions.length / 3 - 1)
  })
})
