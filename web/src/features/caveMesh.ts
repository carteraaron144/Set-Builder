import type { SceneSize } from '../scene/scene'
import { buildChunkGeometry, CHUNK_VERTS, chunkCount, type ChunkGeometry } from '../terrain/chunks'
import type { TerrainLayers } from '../terrain/layers'
import { VolumeLayer, type Brick } from '../terrain/volume'
import { DEFAULT_PALETTE } from '../terrain/palette'
import { buildSdfChunk, type CaveDistanceHolder } from './caveChunk'
import { cavesReaching, profileCave, type CaveProfile } from './caves'
import type { Cave } from './features'
import type { Ground } from './ground'

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
  /** Copies of the sculpted bricks, with their keys. */
  bricks: (Brick & { key: number })[]
}

export interface CaveMeshResult {
  chunk: number
  /** Whether caves or bricks reach the chunk, so it was meshed from the density field. */
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
    bricks: [...ground.layers.volume.keys()].map((key) => ({ key, ...ground.layers.volume.copy(key)! })),
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
    volume: new VolumeLayer(req.size),
  }
  for (const { key, a, k } of req.bricks) layers.volume.put(key, { a, k })
  const volumeChunks = new Set<number>()
  const n = chunkCount(req.size)
  const cells = CHUNK_VERTS - 1
  for (const f of layers.volume.footprints())
    for (let cz = Math.max(0, Math.ceil(f.z0 / cells) - 1); cz <= Math.min(n - 1, Math.floor(f.z1 / cells)); cz++)
      for (let cx = Math.max(0, Math.ceil(f.x0 / cells) - 1); cx <= Math.min(n - 1, Math.floor(f.x1 / cells)); cx++) volumeChunks.add(cz * n + cx)
  const surface = { kind: req.surfaceKind, weight: req.surfaceWeight }
  const caves = profilesFor(req.size, req.caves, layers)
  const results = req.chunks.map((chunk): CaveMeshResult => {
    const reaching = cavesReaching(caves, chunk, req.size)
    const sdf = reaching.length > 0 || volumeChunks.has(chunk)
    const geometry = sdf ? buildSdfChunk(layers, surface, reaching, chunk, DEFAULT_PALETTE, holderFor(req.size, req.caves, chunk)) : buildChunkGeometry(layers, chunk, DEFAULT_PALETTE, surface)
    return { chunk, sdf, geometry }
  })
  return { id: req.id, results }
}
