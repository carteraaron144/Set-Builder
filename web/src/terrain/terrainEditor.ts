import type { GroundPoint } from '../camera/overheadCamera'
import { paint, sculpt, type BrushSettings, type TerrainMode } from './brush'
import { chunksForBiomeRect, chunksForHeightRect } from './chunks'
import { StrokeHistory, type LayerPatch } from './history'
import { cropRect, heightAt, pasteRect, type BiomeId, type Rect, type TerrainLayers } from './layers'

export type StrokeTool = { tool: 'terrain'; mode: TerrainMode } | { tool: 'paint'; biome: BiomeId }
export type TerrainChange = 'stroke' | 'undo' | 'redo'

interface Stroke {
  tool: StrokeTool
  brush: BrushSettings
  flattenTo: number
  snapshot: Float32Array | Uint8Array
  rect: Rect | null
  /** Paint strokes blend in floats so slow (low-strength, high-refresh) painting still converges. */
  weights: Float32Array | null
  /** Undo was pressed mid-drag: ignore the rest of this drag. */
  cancelled: boolean
}

const union = (a: Rect | null, b: Rect): Rect =>
  a ? { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) } : b

function sameValues(a: Float32Array | Uint8Array, b: Float32Array | Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Owns the painted layers: applies strokes, records one undo patch per stroke, and tracks dirty chunks. */
export class TerrainEditor {
  readonly layers: TerrainLayers
  private readonly seed: number
  private readonly onChange: (c: TerrainChange) => void
  private readonly history = new StrokeHistory()
  private readonly dirty = new Set<number>()
  private stroke: Stroke | null = null

  constructor(layers: TerrainLayers, seed: number, onChange: (c: TerrainChange) => void) {
    this.layers = layers
    this.seed = seed
    this.onChange = onChange
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

  beginStroke(tool: StrokeTool, brush: BrushSettings, at: GroundPoint | null): void {
    if (this.stroke) this.endStroke()
    this.stroke = {
      tool,
      brush: { ...brush },
      flattenTo: at ? heightAt(this.layers.heights, at.x, at.z) : 0,
      snapshot: this.layerData(tool).slice(),
      rect: null,
      weights: tool.tool === 'paint' ? Float32Array.from(this.layers.biomes.data, (v) => v / 255) : null,
      cancelled: false,
    }
  }

  dab(at: GroundPoint, dt: number, invert: boolean): void {
    const s = this.stroke
    if (!s || s.cancelled) return
    const dab = { x: at.x, z: at.z, dt, invert }
    const rect =
      s.tool.tool === 'terrain'
        ? sculpt(this.layers.heights, s.tool.mode, s.brush, dab, { flattenTo: s.flattenTo, seed: this.seed })
        : paint(this.layers.biomes, s.tool.biome, s.brush, dab, s.weights ?? undefined)
    if (!rect) return
    s.rect = union(s.rect, rect)
    this.markDirty(s.tool.tool === 'terrain' ? 'heights' : 'biomes', rect)
  }

  endStroke(): void {
    const s = this.stroke
    this.stroke = null
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

  /** Mid-drag, ends the stroke first and ignores the rest of that drag. */
  undo(): boolean {
    if (this.stroke && !this.stroke.cancelled) {
      const tool = this.stroke.tool
      this.endStroke()
      this.stroke = { tool, brush: { radius: 0, strength: 0, falloff: 0 }, flattenTo: 0, snapshot: new Uint8Array(0), rect: null, weights: null, cancelled: true }
    }
    const p = this.history.undo()
    if (!p) return false
    this.apply(p, p.before)
    this.onChange('undo')
    return true
  }

  /** Ignored mid-stroke. */
  redo(): boolean {
    if (this.stroke) return false
    const p = this.history.redo()
    if (!p) return false
    this.apply(p, p.after)
    this.onChange('redo')
    return true
  }

  takeDirtyChunks(): number[] {
    const out = [...this.dirty].sort((a, b) => a - b)
    this.dirty.clear()
    return out
  }

  private layerData(tool: StrokeTool): Float32Array | Uint8Array {
    return tool.tool === 'terrain' ? this.layers.heights.data : this.layers.biomes.data
  }

  private apply(p: LayerPatch, values: Float32Array | Uint8Array): void {
    const layer = this.layers[p.layer]
    pasteRect(layer.data, layer.resolution, p.layer === 'heights' ? 1 : 4, p.rect, values)
    this.markDirty(p.layer, p.rect)
  }

  private markDirty(layer: 'heights' | 'biomes', rect: Rect): void {
    const size = this.layers.heights.size
    const chunks = layer === 'heights' ? chunksForHeightRect(rect, size) : chunksForBiomeRect(rect, size)
    for (const c of chunks) this.dirty.add(c)
  }
}
