import type { Scene, SceneSize } from '../scene/scene'
import { chunkCount } from '../terrain/chunks'
import type { TerrainEditor } from '../terrain/terrainEditor'
import { rulesFor, type ScatterRules } from './rules'
import type { AssetInfo, ChunkScatter, Instance } from './scatter'

export interface ScatterRequest {
  id: number
  chunks: number[]
  size: SceneSize
  seed: number
  rules: ScatterRules
  heights: Float32Array
  biomes: Uint8Array
  exclusion: Uint8Array | null
  assets: Record<string, AssetInfo>
}

export interface ScatterResponse {
  id: number
  results: ChunkScatter[]
}

/** Runs a request: Worker-backed in the app, in-process in tests. */
export type ScatterRunner = (req: ScatterRequest) => Promise<ScatterResponse>

/** The dirty chunks plus one ring of neighbours: acceptance and wall measuring both reach under 32 m. */
function withNeighbours(chunks: number[], size: SceneSize): number[] {
  const n = chunkCount(size)
  const out = new Set<number>()
  for (const c of chunks) {
    const cx = c % n
    const cz = Math.floor(c / n)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx
        const z = cz + dz
        if (x >= 0 && z >= 0 && x < n && z < n) out.add(z * n + x)
      }
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Keeps scatter in step with the terrain: takes the 'scatter' dirty channel each frame, keeps at most one request in
 * flight, and drops results for chunks dirtied after their request was sent (they are requested again).
 */
export class ScatterManager {
  private readonly terrain: TerrainEditor
  private readonly scene: Scene
  private readonly run: ScatterRunner
  private readonly assets: Record<string, AssetInfo>
  private readonly rules: ScatterRules
  private readonly onCapped?: (capped: boolean) => void
  private readonly results = new Map<number, ChunkScatter>()
  private readonly pending = new Set<number>()
  private inFlight: { id: number; chunks: Set<number>; dirtied: Set<number> } | null = null
  private nextId = 1
  private disposed = false
  private cappedNow = false
  private versionNow = 0

  constructor(
    terrain: TerrainEditor,
    scene: Scene,
    run: ScatterRunner,
    assets: Record<string, AssetInfo>,
    opts: { onCapped?: (capped: boolean) => void; rules?: ScatterRules } = {},
  ) {
    this.terrain = terrain
    this.scene = scene
    this.run = run
    this.assets = assets
    this.rules = opts.rules ?? rulesFor(scene.generatorVersion)
    this.onCapped = opts.onCapped
    const n = chunkCount(scene.size)
    for (let c = 0; c < n * n; c++) this.pending.add(c)
    terrain.takeDirtyChunks('scatter')
  }

  /** Bumps whenever results are applied. */
  get version(): number {
    return this.versionNow
  }

  get capped(): boolean {
    return this.cappedNow
  }

  /** Call once per frame. */
  pump(): void {
    if (this.disposed) return
    const dirty = this.terrain.takeDirtyChunks('scatter')
    if (dirty.length) {
      for (const c of withNeighbours(dirty, this.scene.size)) {
        this.pending.add(c)
        if (this.inFlight?.chunks.has(c)) this.inFlight.dirtied.add(c)
      }
    }
    if (this.inFlight || this.pending.size === 0) return
    const chunks = [...this.pending].sort((a, b) => a - b)
    this.pending.clear()
    const ground = this.terrain.ground
    const { heights, biomes } = ground.layers
    const req: ScatterRequest = {
      id: this.nextId++,
      chunks,
      size: this.scene.size,
      seed: this.scene.seed,
      rules: this.rules,
      heights: heights.data.slice(),
      biomes: biomes.data.slice(),
      exclusion: ground.exclusion?.slice() ?? null,
      assets: this.assets,
    }
    const flight = { id: req.id, chunks: new Set(chunks), dirtied: new Set<number>() }
    this.inFlight = flight
    this.run(req).then(
      (res) => this.apply(flight, res),
      (err: unknown) => {
        console.warn('Scatter request failed; retrying its chunks', err)
        if (this.inFlight !== flight) return
        this.inFlight = null
        for (const c of flight.chunks) this.pending.add(c)
      },
    )
  }

  /** All chunks' instances, grouped by rule index. */
  instancesByRule(): Instance[][] {
    const out: Instance[][] = this.rules.rules.map(() => [])
    for (const c of [...this.results.keys()].sort((a, b) => a - b)) for (const i of this.results.get(c)!.instances) out[i.rule].push(i)
    return out
  }

  get ruleList(): ScatterRules {
    return this.rules
  }

  dispose(): void {
    this.disposed = true
    this.inFlight = null
  }

  private apply(flight: { id: number; dirtied: Set<number> }, res: ScatterResponse): void {
    if (this.disposed || this.inFlight?.id !== flight.id) return
    this.inFlight = null
    for (const r of res.results) if (!flight.dirtied.has(r.chunk)) this.results.set(r.chunk, r)
    const capped = [...this.results.values()].some((r) => r.capped)
    if (capped !== this.cappedNow) {
      this.cappedNow = capped
      this.onCapped?.(capped)
    }
    this.versionNow++
  }
}
