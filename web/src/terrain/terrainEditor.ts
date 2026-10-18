import type { GroundPoint } from '../camera/overheadCamera'
import type { Features } from '../features/features'
import { Ground } from '../features/ground'
import { paint, sculpt, type BrushSettings, type TerrainMode } from './brush'
import { chunksForBiomeRect, chunksForHeightRect } from './chunks'
import { is3dMode, sculpt3d } from './brush3d'
import { isFeaturesPatch, isVolumePatch, StrokeHistory, type HistoryEntry, type VolumePatch } from './history'
import type { Vec3 } from './pick'
import { brickFootprint, type Brick } from './volume'
import { cropRect, heightAt, pasteRect, type BiomeId, type Rect, type TerrainLayers } from './layers'

export type StrokeTool = { tool: 'terrain'; mode: TerrainMode; terraceStep?: number } | { tool: 'paint'; biome: BiomeId }
export type TerrainChange = 'stroke' | 'undo' | 'redo'

interface Stroke {
  tool: StrokeTool
  brush: BrushSettings
  flattenTo: number
  snapshot: Float32Array | Uint8Array
  rect: Rect | null
  /** Paint strokes blend in floats so slow (low-strength, high-refresh) painting still converges. */
  weights: Float32Array | null
  /** 3D strokes: a copy of each brick as it was before the stroke first touched it (null = absent). */
  bricksBefore: Map<number, Brick | null> | null
  /** Undo was pressed mid-drag: ignore the rest of this drag. */
  cancelled: boolean
}

const union = (a: Rect | null, b: Rect): Rect =>
  a ? { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) } : b

function sameValues(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameBrick(a: Brick | null, b: Brick | null): boolean {
  if (!a || !b) return a === b
  return sameValues(a.a, b.a) && sameValues(a.k, b.k)
}

/**
 * Owns the painted layers and the features drawn on them: applies strokes and feature edits, records one undo
 * entry per stroke or edit, keeps the carved ground current and tracks dirty chunks.
 */
export class TerrainEditor {
  readonly layers: TerrainLayers
  readonly ground: Ground
  private readonly seed: number
  private readonly onChange: (c: TerrainChange) => void
  private readonly history = new StrokeHistory()
  /** Dirty chunks per consumer: the terrain mesh and scatter each drain their own set. */
  private readonly dirty = { mesh: new Set<number>(), scatter: new Set<number>() }
  private stroke: Stroke | null = null
  private current: Features
  /** The features as of the last commit (or undo/redo): the `before` of the next feature edit. */
  private committed: Features

  constructor(layers: TerrainLayers, seed: number, features: Features, onChange: (c: TerrainChange) => void) {
    this.layers = layers
    this.seed = seed
    this.onChange = onChange
    this.current = this.committed = structuredClone(features)
    this.ground = new Ground(layers, this.current)
  }

  get features(): Features {
    return this.current
  }

  /** Bumped whenever river or pond water may have changed. */
  get waterVersion(): number {
    return this.ground.waterVersion
  }

  /** Records one undo entry from the last committed features to `next`; nothing if they are equal. */
  commitFeatures(next: Features): void {
    const after = structuredClone(next)
    const before = this.committed
    this.setFeatures(after)
    this.committed = after
    if (JSON.stringify(before) === JSON.stringify(after)) return
    this.history.push({ kind: 'features', before, after })
    this.onChange('stroke')
  }

  /** Shows `next` without recording it, while a drag is in progress; finish with `commitFeatures`. */
  previewFeatures(next: Features): void {
    this.setFeatures(structuredClone(next))
  }

  get strokeActive(): boolean {
    return this.stroke !== null
  }

  get canUndo(): boolean {
    return this.history.canUndo
  }

  get canRedo(): boolean {
    return this.history.canRedo
  }

  /** True from the start of a stroke until it ends (or is cancelled by undo and the drag finishes). */
  get stroking(): boolean {
    return this.stroke !== null
  }

  beginStroke(tool: StrokeTool, brush: BrushSettings, at: GroundPoint | null): void {
    if (this.stroke) this.endStroke()
    const is3d = tool.tool === 'terrain' && is3dMode(tool.mode)
    this.stroke = {
      tool,
      brush: { ...brush },
      flattenTo: at ? heightAt(this.layers.heights, at.x, at.z) : 0,
      snapshot: is3d ? new Float32Array(0) : this.layerData(tool).slice(),
      rect: null,
      bricksBefore: is3d ? new Map() : null,
      weights: tool.tool === 'paint' ? Float32Array.from(this.layers.biomes.data, (v) => v / 255) : null,
      cancelled: false,
    }
  }

  dab(at: GroundPoint, dt: number, invert: boolean): void {
    const s = this.stroke
    if (!s || s.cancelled || s.bricksBefore) return
    const dab = { x: at.x, z: at.z, dt, invert }
    const rect =
      s.tool.tool === 'terrain'
        ? sculpt(this.layers.heights, s.tool.mode, s.brush, dab, {
            flattenTo: s.flattenTo,
            seed: this.seed,
            terraceStep: s.tool.terraceStep,
          })
        : paint(this.layers.biomes, s.tool.biome, s.brush, dab, s.weights ?? undefined)
    if (!rect) return
    s.rect = union(s.rect, rect)
    this.markDirty(s.tool.tool === 'terrain' ? 'heights' : 'biomes', rect)
  }

  /** One 3D dab at a world point. 'limit' means the scene is out of bricks; whatever the stroke changed so far still counts. */
  dab3(at: Vec3, dt: number, invert: boolean): 'ok' | 'limit' {
    const s = this.stroke
    if (!s || s.cancelled || !s.bricksBefore || s.tool.tool !== 'terrain' || !is3dMode(s.tool.mode)) return 'ok'
    const before = s.bricksBefore
    const volume = this.layers.volume
    const touched = sculpt3d(
      volume,
      s.tool.mode,
      s.brush,
      { ...at, dt, invert },
      (x, y, z) => this.ground.density(x, y, z),
      (key) => {
        if (!before.has(key)) before.set(key, volume.copy(key))
      },
    )
    if (touched === 'limit') return 'limit'
    this.markVolumeDirty(touched)
    return 'ok'
  }

  endStroke(): void {
    const s = this.stroke
    this.stroke = null
    if (s && !s.cancelled && s.bricksBefore) return this.endVolumeStroke(s.bricksBefore)
    if (!s || s.cancelled || !s.rect) return
    const layer = s.tool.tool === 'terrain' ? 'heights' : 'biomes'
    const res = this.layers[layer].resolution
    const channels = layer === 'heights' ? 1 : 4
    const before = cropRect(s.snapshot, res, channels, s.rect)
    const after = cropRect(this.layers[layer].data, res, channels, s.rect)
    if (sameValues(before, after)) return
    this.history.push({ layer, rect: s.rect, before, after })
    this.onChange('stroke')
  }

  private endVolumeStroke(before: Map<number, Brick | null>): void {
    if (before.size === 0) return
    const after = new Map<number, Brick | null>()
    let changed = false
    for (const [key, was] of before) {
      const now = this.layers.volume.copy(key)
      after.set(key, now)
      if (!sameBrick(was, now)) changed = true
    }
    if (!changed) return
    this.history.push({ kind: 'volume', before, after })
    this.onChange('stroke')
  }

  /** Mid-drag, ends the stroke first and ignores the rest of that drag. */
  undo(): boolean {
    if (this.stroke && !this.stroke.cancelled) {
      const tool = this.stroke.tool
      this.endStroke()
      this.stroke = { tool, brush: { radius: 0, strength: 0, falloff: 0 }, flattenTo: 0, snapshot: new Uint8Array(0), rect: null, weights: null, bricksBefore: null, cancelled: true }
    }
    const p = this.history.undo()
    if (!p) return false
    this.apply(p, 'before')
    this.onChange('undo')
    return true
  }

  /** Ignored mid-stroke. */
  redo(): boolean {
    if (this.stroke) return false
    const p = this.history.redo()
    if (!p) return false
    this.apply(p, 'after')
    this.onChange('redo')
    return true
  }

  takeDirtyChunks(channel: 'mesh' | 'scatter' = 'mesh'): number[] {
    const set = this.dirty[channel]
    const out = [...set].sort((a, b) => a - b)
    set.clear()
    return out
  }

  private layerData(tool: StrokeTool): Float32Array | Uint8Array {
    return tool.tool === 'terrain' ? this.layers.heights.data : this.layers.biomes.data
  }

  private apply(p: HistoryEntry, side: 'before' | 'after'): void {
    if (isFeaturesPatch(p)) {
      this.setFeatures(p[side])
      this.committed = p[side]
      return
    }
    if (isVolumePatch(p)) return this.applyVolume(p, side)
    const layer = this.layers[p.layer]
    pasteRect(layer.data, layer.resolution, p.layer === 'heights' ? 1 : 4, p.rect, p[side])
    this.markDirty(p.layer, p.rect)
  }

  private applyVolume(p: VolumePatch, side: 'before' | 'after'): void {
    for (const [key, brick] of p[side]) this.layers.volume.put(key, brick && { a: brick.a.slice(), k: brick.k.slice() })
    this.markVolumeDirty([...p[side].keys()])
  }

  /** Refreshes which chunks are SDF chunks and dirties every chunk the given bricks' footprints touch. */
  private markVolumeDirty(keys: number[]): void {
    this.ground.refreshVolume()
    const size = this.layers.heights.size
    for (const key of keys) this.markChunks(chunksForHeightRect(brickFootprint(key), size))
    // Sculpted rock can wall water in or out.
    if (this.current.ponds.length > 0) for (const r of this.ground.rebuild(this.current, null)) this.markChunks(chunksForHeightRect(r, size))
  }

  private setFeatures(next: Features): void {
    this.current = next
    for (const r of this.ground.rebuild(next, null)) this.markChunks(chunksForHeightRect(r, this.layers.heights.size))
  }

  private markDirty(layer: 'heights' | 'biomes', rect: Rect): void {
    const size = this.layers.heights.size
    if (layer === 'biomes') return this.markChunks(chunksForBiomeRect(rect, size))
    for (const r of this.ground.rebuild(this.current, rect)) this.markChunks(chunksForHeightRect(r, size))
  }

  private markChunks(chunks: number[]): void {
    for (const c of chunks) {
      this.dirty.mesh.add(c)
      this.dirty.scatter.add(c)
    }
  }
}
