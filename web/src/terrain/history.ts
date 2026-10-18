import { featuresBytes, type Features } from '../features/features'
import type { Rect } from './layers'
import type { Brick } from './volume'

/** The before and after of the rect one stroke changed, in one layer. */
export interface LayerPatch {
  layer: 'heights' | 'biomes'
  rect: Rect
  before: Float32Array | Uint8Array
  after: Float32Array | Uint8Array
}

/** A feature edit: the whole feature set before and after. */
export interface FeaturesPatch {
  kind: 'features'
  before: Features
  after: Features
}

/** The bricks a 3D stroke touched, before and after (null = absent, all default). */
export interface VolumePatch {
  kind: 'volume'
  before: Map<number, Brick | null>
  after: Map<number, Brick | null>
}

export type HistoryEntry = LayerPatch | FeaturesPatch | VolumePatch

export const isFeaturesPatch = (e: HistoryEntry): e is FeaturesPatch => 'kind' in e && e.kind === 'features'
export const isVolumePatch = (e: HistoryEntry): e is VolumePatch => 'kind' in e && e.kind === 'volume'

export const HISTORY_LIMITS = { maxStrokes: 100, maxBytes: 64 * 1024 * 1024 }

const BRICK_BYTES = 1024
const bricksIn = (m: Map<number, Brick | null>) => [...m.values()].filter(Boolean).length * BRICK_BYTES

const patchBytes = (p: HistoryEntry) =>
  isFeaturesPatch(p) ? featuresBytes(p.before) + featuresBytes(p.after) : isVolumePatch(p) ? bricksIn(p.before) + bricksIn(p.after) : p.before.byteLength + p.after.byteLength

/** Undo/redo stacks of stroke patches and feature edits, capped by count and memory (oldest dropped first). */
export class StrokeHistory {
  private readonly limits: { maxStrokes: number; maxBytes: number }
  private readonly done: HistoryEntry[] = []
  private readonly undone: HistoryEntry[] = []
  private total = 0

  constructor(limits = HISTORY_LIMITS) {
    this.limits = limits
  }

  get canUndo(): boolean {
    return this.done.length > 0
  }

  get canRedo(): boolean {
    return this.undone.length > 0
  }

  get bytes(): number {
    return this.total
  }

  push(p: HistoryEntry): void {
    for (const r of this.undone) this.total -= patchBytes(r)
    this.undone.length = 0
    this.done.push(p)
    this.total += patchBytes(p)
    while (this.done.length > this.limits.maxStrokes || (this.total > this.limits.maxBytes && this.done.length > 1)) {
      this.total -= patchBytes(this.done.shift()!)
    }
  }

  undo(): HistoryEntry | undefined {
    const p = this.done.pop()
    if (p) this.undone.push(p)
    return p
  }

  redo(): HistoryEntry | undefined {
    const p = this.undone.pop()
    if (p) this.done.push(p)
    return p
  }

  clear(): void {
    this.done.length = 0
    this.undone.length = 0
    this.total = 0
  }
}
