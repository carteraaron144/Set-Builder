import { describe, expect, it } from 'vitest'
import { emptyFeatures } from '../features/features'
import { HISTORY_LIMITS, StrokeHistory, type HistoryEntry, type LayerPatch } from './history'

const patch = (n: number, bytes = 8): LayerPatch => ({
  layer: 'heights',
  rect: { x0: n, z0: 0, x1: n, z1: 0 },
  before: new Uint8Array(bytes / 2),
  after: new Uint8Array(bytes / 2),
})

describe('StrokeHistory', () => {
  it('defaults to 100 strokes or 64 MiB', () => {
    expect(HISTORY_LIMITS).toEqual({ maxStrokes: 100, maxBytes: 64 * 1024 * 1024 })
  })

  it('keeps the newest strokes up to the stroke cap', () => {
    const h = new StrokeHistory({ maxStrokes: 3, maxBytes: 1e9 })
    for (let n = 0; n < 4; n++) h.push(patch(n))
    expect([h.undo(), h.undo(), h.undo()].map((p) => (p as LayerPatch | undefined)?.rect.x0)).toEqual([3, 2, 1])
    expect(h.undo()).toBeUndefined()
    expect(h.canUndo).toBe(false)
  })

  it('drops the oldest strokes to fit the byte cap, keeping at least one', () => {
    const h = new StrokeHistory({ maxStrokes: 100, maxBytes: 100 })
    for (let n = 0; n < 5; n++) h.push(patch(n, 40))
    expect(h.bytes).toBeLessThanOrEqual(100)
    expect([h.undo(), h.undo(), h.undo()].map((p) => (p as LayerPatch | undefined)?.rect.x0)).toEqual([4, 3, undefined])
    const big = new StrokeHistory({ maxStrokes: 100, maxBytes: 100 })
    big.push(patch(0, 40))
    big.push(patch(1, 400))
    expect((big.undo() as LayerPatch | undefined)?.rect.x0).toBe(1)
    expect(big.canUndo).toBe(false)
  })

  it('redoes what was undone, and a new push clears redo', () => {
    const h = new StrokeHistory()
    h.push(patch(1))
    h.push(patch(2))
    expect((h.undo() as LayerPatch | undefined)?.rect.x0).toBe(2)
    expect(h.canRedo).toBe(true)
    expect((h.redo() as LayerPatch | undefined)?.rect.x0).toBe(2)
    h.undo()
    h.push(patch(3))
    expect(h.canRedo).toBe(false)
    expect(h.redo()).toBeUndefined()
  })

  it('clears', () => {
    const h = new StrokeHistory()
    h.push(patch(1))
    h.clear()
    expect([h.canUndo, h.canRedo, h.bytes]).toEqual([false, false, 0])
  })

  it('counts feature entries toward both caps', () => {
    const features: HistoryEntry = { kind: 'features', before: emptyFeatures(), after: emptyFeatures() }
    const h = new StrokeHistory({ maxStrokes: 2, maxBytes: 1e9 })
    h.push(patch(1))
    h.push(features)
    h.push(features)
    expect([h.undo(), h.undo(), h.undo()]).toEqual([features, features, undefined])
    const bytes = JSON.stringify(emptyFeatures()).length * 2 * 2
    const capped = new StrokeHistory()
    capped.push(features)
    expect(capped.bytes).toBe(bytes)
  })
})
