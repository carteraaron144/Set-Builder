import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { AssetLibrary, LoadedAsset } from '../assets/assetLibrary'
import type { Ground } from '../features/ground'
import { buildWater, WATER_MATERIAL } from '../features/water'
import type { Scene } from '../scene/scene'
import type { ScatterRules } from '../scatter/rules'
import type { Instance } from '../scatter/scatter'
import { buildChunkGeometry, CHUNK_SIZE, chunkCount, type ChunkGeometry } from '../terrain/chunks'
import type { TerrainLayers } from '../terrain/layers'
import { buildOverhangGeometry, withOverhang } from '../terrain/overhang'
import { DEFAULT_PALETTE } from '../terrain/palette'

export type ExportGrouping = 'element' | 'chunk' | 'merged'

export interface ExportOptions {
  grouping: ExportGrouping
  collision: boolean
  includeGrass: boolean
}

export const EXPORT_DEFAULTS: ExportOptions = { grouping: 'element', collision: true, includeGrass: false }

export interface ExportInput {
  scene: Scene
  layers: TerrainLayers
  /** The ground with paths, rivers and ponds; when given, the terrain is its carved layers and surface colours. */
  ground?: Ground
  instancesByRule: Instance[][]
  rules: ScatterRules
  library: AssetLibrary
  /** Hang grass lips over cliff tops in the terrain chunks (the settings menu's Grass overhangs). */
  overhangs?: boolean
}

const exportMaterial = (name: string, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}) =>
  new MeshStandardMaterial({ name, roughness: 1, metalness: 0, ...extra })

/** Positions (and colours) only: glTF importers compute flat normals when none are given. */
function stripped(g: BufferGeometry, keepColor = false): BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && !(keepColor && name === 'color')) g.deleteAttribute(name)
  return g
}

/** Index + white colour so it merges with the (indexed, coloured) terrain. */
function mergeable(g: BufferGeometry): BufferGeometry {
  const out = stripped(g.clone())
  const n = out.getAttribute('position').count
  if (!out.index) out.setIndex(Array.from({ length: n }, (_, i) => i))
  out.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3))
  return out
}

function terrainChunk(c: ChunkGeometry): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(c.positions, 3))
  g.setAttribute('color', new BufferAttribute(c.colors, 3))
  g.setIndex(new BufferAttribute(new Uint32Array(c.indices), 1))
  return g
}

/** A chunk caves reach collides as rendered: its surface has no heightmap to thin. */
function sdfCollision(c: ChunkGeometry): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(c.positions, 3))
  g.setIndex(new BufferAttribute(new Uint32Array(c.indices), 1))
  return g
}

/** Every second terrain vertex (1 m): 33 × 33 per chunk. */
function terrainCollision(layers: TerrainLayers, chunk: number): BufferGeometry {
  const full = buildChunkGeometry(layers, chunk, DEFAULT_PALETTE).positions
  const n = 33
  const pos = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) pos.set(full.subarray(((j * 2) * 65 + i * 2) * 3, ((j * 2) * 65 + i * 2) * 3 + 3), (j * n + i) * 3)
  const idx: number[] = []
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

/** Collision shape in asset space (base at y = 0), or null. */
function collisionShape(asset: LoadedAsset): BufferGeometry | null {
  const c = asset.asset.collision
  if (c === 'none') return null
  if ('box' in c) return stripped(new BoxGeometry(c.box[0], c.box[1], c.box[2]).translate(0, c.box[1] / 2, 0))
  return stripped(new CylinderGeometry(c.cylinder[0], c.cylinder[0], c.cylinder[1], 8).translate(0, c.cylinder[1] / 2, 0))
}

const matrixOf = (i: Instance) =>
  new Matrix4().compose(new Vector3(i.x, i.y, i.z), new Quaternion(...i.quat), new Vector3(...i.scale))

function chunkName(chunk: number, n: number) {
  return `${chunk % n}_${Math.floor(chunk / n)}`
}

/** River and pond water, one node each named as in `buildWater`, sharing the `water` material; no collision. */
function waterMeshes(ground: Ground): Mesh[] {
  const material = exportMaterial(WATER_MATERIAL.name, {
    color: WATER_MATERIAL.color,
    opacity: WATER_MATERIAL.opacity,
    transparent: true,
  })
  return buildWater(ground).map((w) => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(w.positions, 3))
    g.setIndex(new BufferAttribute(w.indices, 1))
    const m = new Mesh(g, material)
    m.name = w.name
    return m
  })
}

/** Builds the scene to export from data (not the render scene): terrain + scatter + water, grouped as requested. */
export function buildExportScene(input: ExportInput, o: ExportOptions): Group {
  const { scene, instancesByRule, rules, library, ground } = input
  const layers = ground?.layers ?? input.layers
  const surface = ground?.surface
  /** A chunk's render geometry, from the density field where caves reach, with any grass overhangs. */
  const chunkGeometry = (c: number) => {
    const g = ground ? ground.chunkGeometry(c, DEFAULT_PALETTE) : buildChunkGeometry(layers, c, DEFAULT_PALETTE, surface)
    return input.overhangs ? withOverhang(g, buildOverhangGeometry(layers, c, DEFAULT_PALETTE, surface)) : g
  }
  const chunkCollision = (c: number, render?: ChunkGeometry) =>
    ground?.isSdfChunk(c) ? sdfCollision(render ?? chunkGeometry(c)) : terrainCollision(layers, c)
  const water = ground ? waterMeshes(ground) : []
  const size = layers.heights.size
  const n = chunkCount(size)
  const chunkOf = (i: Instance) => {
    const cx = Math.min(n - 1, Math.max(0, Math.floor((i.x + size / 2) / CHUNK_SIZE)))
    const cz = Math.min(n - 1, Math.max(0, Math.floor((i.z + size / 2) / CHUNK_SIZE)))
    return cz * n + cx
  }
  const terrainMat = exportMaterial('terrain', { vertexColors: true })
  const collisionMat = exportMaterial('collision')
  const slotMat = new Map<string, Material>()
  const materialFor = (slot: string) => {
    let m = slotMat.get(slot)
    if (!m) {
      const src = library.materials[slot as keyof typeof library.materials]
      m = exportMaterial(slot, { color: src.color, side: src.side })
      slotMat.set(slot, m)
    }
    return m
  }

  // Elements to export, numbered per asset in rule order.
  const counters = new Map<string, number>()
  const elements: { name: string; asset: LoadedAsset; instance: Instance; chunk: number }[] = []
  rules.rules.forEach((rule, r) => {
    const asset = library.assets.get(rule.asset)
    if (!asset || (!o.includeGrass && (asset.asset.kind === 'grass' || asset.asset.kind === 'plant'))) return
    for (const instance of instancesByRule[r] ?? []) {
      const k = counters.get(asset.asset.id) ?? 0
      counters.set(asset.asset.id, k + 1)
      elements.push({ name: `${asset.asset.id}_${String(k).padStart(5, '0')}`, asset, instance, chunk: chunkOf(instance) })
    }
  })

  const root = new Group()
  root.name = scene.name
  const terrain = new Group()
  terrain.name = 'terrain'
  const scatter = new Group()
  scatter.name = 'scatter'
  root.add(terrain, scatter)

  const named = <T extends Object3D>(obj: T, name: string): T => {
    obj.name = name
    return obj
  }

  if (o.grouping === 'element') {
    for (let c = 0; c < n * n; c++) {
      const geometry = chunkGeometry(c)
      terrain.add(named(new Mesh(terrainChunk(geometry), terrainMat), `terrain_c${chunkName(c, n)}`))
      if (o.collision) {
        terrain.add(named(new Mesh(chunkCollision(c, geometry), collisionMat), `terrain_c${chunkName(c, n)}-col`))
      }
    }
    const shared = new Map<LoadedAsset, { parts: { slot: string; geometry: BufferGeometry }[]; col: BufferGeometry | null }>()
    for (const e of elements) {
      let s = shared.get(e.asset)
      if (!s) {
        s = { parts: e.asset.parts.map((p) => ({ slot: p.slot, geometry: stripped(p.geometry.clone()) })), col: o.collision ? collisionShape(e.asset) : null }
        shared.set(e.asset, s)
      }
      const node: Object3D =
        s.parts.length === 1
          ? new Mesh(s.parts[0].geometry, materialFor(s.parts[0].slot))
          : new Group().add(...s.parts.map((p) => named(new Mesh(p.geometry, materialFor(p.slot)), `${e.name}_${p.slot}`)))
      node.name = e.name
      node.position.set(e.instance.x, e.instance.y, e.instance.z)
      node.quaternion.set(...e.instance.quat)
      node.scale.set(...e.instance.scale)
      scatter.add(node)
      if (s.col) {
        const col = named(new Mesh(s.col, collisionMat), `${e.name}-col`)
        col.position.copy(node.position)
        col.quaternion.copy(node.quaternion)
        col.scale.copy(node.scale)
        scatter.add(col)
      }
    }
    if (water.length) root.add(...water)
    return root
  }

  // Merged groupings: one mesh (with one group per material) per chunk, or for the whole scene.
  const groups = o.grouping === 'chunk' ? Array.from({ length: n * n }, (_, c) => [c]) : [Array.from({ length: n * n }, (_, c) => c)]
  for (const chunks of groups) {
    const inGroup = new Set(chunks)
    const bySlot = new Map<string, BufferGeometry[]>()
    const cols: BufferGeometry[] = []
    for (const e of elements) {
      if (!inGroup.has(e.chunk)) continue
      const m = matrixOf(e.instance)
      for (const p of e.asset.parts) bySlot.set(p.slot, [...(bySlot.get(p.slot) ?? []), mergeable(p.geometry).applyMatrix4(m)])
      const col = o.collision ? collisionShape(e.asset) : null
      if (col) cols.push(col.applyMatrix4(m))
    }
    const terrainGeom = mergeGeometries(chunks.map((c) => terrainChunk(chunkGeometry(c))))!
    const parts = [terrainGeom, ...[...bySlot.values()].map((gs) => mergeGeometries(gs)!)]
    const materials = [terrainMat, ...[...bySlot.keys()].map(materialFor)]
    const name = o.grouping === 'chunk' ? `chunk_${chunkName(chunks[0], n)}` : 'scene'
    const target = root
    target.add(named(new Mesh(mergeGeometries(parts, true)!, materials), name))
    if (o.collision) {
      const all = [...chunks.map((c) => chunkCollision(c)), ...cols.map((g) => (g.index ? g : g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i))))]
      target.add(named(new Mesh(mergeGeometries(all)!, collisionMat), `${name}-col`))
    }
  }
  root.remove(terrain, scatter)
  if (water.length) root.add(...water)
  return root
}
