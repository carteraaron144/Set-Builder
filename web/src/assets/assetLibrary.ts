import { DoubleSide, Mesh, MeshStandardMaterial, type BufferGeometry, type Group } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MATERIAL_PALETTE } from '../scatter/rules'
import { assetInfoFrom, type AssetInfo } from '../scatter/scatter'
import { parsePackManifest, PALETTE_SLOTS, type PackAsset, type PackManifest, type PaletteSlot } from './packManifest'

export interface AssetPart {
  slot: PaletteSlot
  /** In asset space (metres, base at y = 0), node transforms applied. */
  geometry: BufferGeometry
}

export interface LoadedAsset {
  /** "<packId>/<assetId>" */
  key: string
  asset: PackAsset
  parts: AssetPart[]
}

export interface AssetLibrary {
  assets: Map<string, LoadedAsset>
  materials: Record<PaletteSlot, MeshStandardMaterial>
  packs: { packId: string; manifest: PackManifest }[]
  /** Human-readable load problems; empty when everything loaded. */
  problems: string[]
}

export interface AssetLibraryDeps {
  fetch: typeof fetch
  parseGlb(bytes: ArrayBuffer): Promise<Group>
}

function paletteMaterials(): Record<PaletteSlot, MeshStandardMaterial> {
  return Object.fromEntries(
    PALETTE_SLOTS.map((slot) => [
      slot,
      new MeshStandardMaterial({
        name: slot,
        color: MATERIAL_PALETTE[slot],
        flatShading: true,
        roughness: 1,
        metalness: 0,
        side: slot === 'grass' || slot === 'reed' ? DoubleSide : undefined,
      }),
    ]),
  ) as Record<PaletteSlot, MeshStandardMaterial>
}

/** Bakes node transforms and merges the model's meshes into one geometry per palette slot. */
function partsOf(key: string, root: Group): AssetPart[] {
  root.updateMatrixWorld(true)
  const bySlot = new Map<PaletteSlot, BufferGeometry[]>()
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return
    const name = (Array.isArray(o.material) ? o.material[0] : o.material)?.name ?? ''
    let slot = name as PaletteSlot
    if (!PALETTE_SLOTS.includes(slot)) {
      console.warn(`Asset ${key}: material "${name}" is not a palette slot; using stone`)
      slot = 'stone'
    }
    const g = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld)
    for (const attr of Object.keys(g.attributes)) if (attr !== 'position') g.deleteAttribute(attr)
    const flat = g.index ? g.toNonIndexed() : g
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), flat])
  })
  return [...bySlot].map(([slot, gs]) => ({ slot, geometry: gs.length === 1 ? gs[0] : mergeGeometries(gs)! }))
}

async function loadPack(deps: AssetLibraryDeps, packId: string, lib: AssetLibrary): Promise<void> {
  let manifest: PackManifest
  try {
    const res = await deps.fetch(`/packs/${packId}/pack.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    manifest = parsePackManifest(await res.json())
  } catch (e) {
    lib.problems.push(`Pack ${packId}: couldn't read pack.json (${(e as Error).message})`)
    return
  }
  lib.packs.push({ packId, manifest })
  await Promise.all(
    manifest.assets.map(async (asset) => {
      const key = `${packId}/${asset.id}`
      try {
        const res = await deps.fetch(`/packs/${packId}/${asset.file}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const parts = partsOf(key, await deps.parseGlb(await res.arrayBuffer()))
        if (!parts.length) throw new Error('no meshes')
        lib.assets.set(key, { key, asset, parts })
      } catch (e) {
        lib.problems.push(`Asset ${key}: couldn't load ${asset.file} (${(e as Error).message})`)
      }
    }),
  )
}

/** Lists the server's packs and loads every model. Failures are collected in `problems`, never thrown. */
export async function loadAssetLibrary(deps: AssetLibraryDeps): Promise<AssetLibrary> {
  const lib: AssetLibrary = { assets: new Map(), materials: paletteMaterials(), packs: [], problems: [] }
  let ids: string[]
  try {
    const res = await deps.fetch('/api/asset-packs')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    ids = ((await res.json()) as { id: string }[]).map((p) => p.id)
  } catch (e) {
    lib.problems.push(`Asset pack list unavailable (${(e as Error).message})`)
    return lib
  }
  await Promise.all(ids.map((id) => loadPack(deps, id, lib)))
  for (const p of lib.problems) console.warn(p)
  return lib
}

/** Scatter's view of the loaded assets (only ones that actually loaded). */
export function assetInfoOf(lib: AssetLibrary): Record<string, AssetInfo> {
  const all = assetInfoFrom(lib.packs)
  return Object.fromEntries(Object.entries(all).filter(([key]) => lib.assets.has(key)))
}
