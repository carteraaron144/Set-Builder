import type { SceneSize } from '../scene/scene'
import { buildChunkGeometry, type ChunkGeometry } from '../terrain/chunks'
import type { TerrainLayers } from '../terrain/layers'
import { DEFAULT_PALETTE } from '../terrain/palette'
import { buildCaveChunk, type CaveDistanceHolder } from './caveChunk'
import { profileCave, type CaveProfile } from './caves'
import type { Cave } from './features'
import { cavesReaching, type Ground } from './ground'

/** Everything needed to mesh chunks off the main thread: copies of the carved layers and the caves as drawn. */
export interface CaveMeshRequest {
  id: number
  chunks: number[]
  size: SceneSize
  heights: Float32Array
  biomes: Uint8Array
  surfaceKind: Uint8Array
  surfaceWeight: Uint8Array
  caves: Cave[]
}

export interface CaveMeshResult {
  chunk: number
  /** Whether caves reach the chunk, so it was meshed from the density field. */
  sdf: boolean
  geometry: ChunkGeometry
}

export interface CaveMeshResponse {
  id: number
  results: CaveMeshResult[]
}

export function caveMeshRequest(id: number, ground: Ground, chunks: number[]): CaveMeshRequest {
  const { heights, biomes } = ground.layers
  return {
    id,
    chunks,
    size: heights.size as SceneSize,
    heights: heights.data.slice(),
    biomes: biomes.data.slice(),
    surfaceKind: ground.surface.kind.slice(),
    surfaceWeight: ground.surface.weight.slice(),
    caves: ground.caves.map((c) => c.cave),
  }
}

// Profiles depend only on the cave and the scene size, so a worker keeps them between requests.
const profiles = new Map<string, CaveProfile>()

function profilesFor(size: SceneSize, caves: Cave[], layers: TerrainLayers): CaveProfile[] {
  const used = new Map<string, CaveProfile>()
  const out = caves.map((cave) => {
    const key = `${size}:${JSON.stringify(cave)}`
    const p = profiles.get(key) ?? profileCave(layers.heights, cave)
    used.set(key, p)
    return p
  })
  profiles.clear()
  for (const [k, p] of used) profiles.set(k, p)
  return out
}

// Cave distances per chunk, kept while the caves stay as they are. A chunk always meshes on the same worker, so
// the cache stays warm through a stroke.
let cacheKey = ''
const holders = new Map<number, CaveDistanceHolder>()

function holderFor(size: SceneSize, caves: Cave[], chunk: number): CaveDistanceHolder {
  const key = `${size}:${JSON.stringify(caves)}`
  if (key !== cacheKey) {
    cacheKey = key
    holders.clear()
  }
  let h = holders.get(chunk)
  if (!h) holders.set(chunk, (h = { cache: null }))
  return h
}

/** Meshes the requested chunks exactly as `Ground.chunkGeometry` would. */
export function meshChunks(req: CaveMeshRequest): CaveMeshResponse {
  const layers: TerrainLayers = {
    heights: { size: req.size, resolution: req.size * 2 + 1, data: req.heights },
    biomes: { size: req.size, resolution: req.size + 1, data: req.biomes },
  }
  const surface = { kind: req.surfaceKind, weight: req.surfaceWeight }
  const caves = profilesFor(req.size, req.caves, layers)
  const results = req.chunks.map((chunk): CaveMeshResult => {
    const reaching = cavesReaching(caves, chunk, req.size)
    const sdf = reaching.length > 0
    const geometry = sdf ? buildCaveChunk(layers, surface, reaching, chunk, DEFAULT_PALETTE, holderFor(req.size, req.caves, chunk)) : buildChunkGeometry(layers, chunk, DEFAULT_PALETTE, surface)
    return { chunk, sdf, geometry }
  })
  return { id: req.id, results }
}
