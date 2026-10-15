import { describe, expect, it } from 'vitest'
import { createScene } from '../scene/scene'
import { createFlatLayers } from '../terrain/layers'
import { createEditorStore } from './editorStore'

function strokeOn(store: ReturnType<typeof createEditorStore>) {
  const { terrain } = store.getState()
  terrain.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 4, strength: 1, falloff: 0 }, { x: 0, z: 0 })
  terrain.dab({ x: 0, z: 0 }, 0.1, false)
  terrain.endStroke()
}

describe('editor store terrain state', () => {
  it('starts a replaced scene with flat layers of its size and no history', () => {
    const store = createEditorStore()
    strokeOn(store)
    store.getState().replaceScene(createScene({ size: 64 }))
    const s = store.getState()
    expect(s.terrain.layers.heights.resolution).toBe(129)
    expect(s.terrain.layers.heights.data.every((v) => v === 0)).toBe(true)
    expect([s.canUndo, s.canRedo, s.dirty]).toEqual([false, false, false])
  })

  it('uses the layers it is given', () => {
    const store = createEditorStore()
    const layers = createFlatLayers(256)
    store.getState().replaceScene(createScene({ size: 256 }), layers)
    expect(store.getState().terrain.layers).toBe(layers)
  })

  it('marks strokes, undo and redo as unsaved edits', () => {
    const store = createEditorStore()
    strokeOn(store)
    expect(store.getState()).toMatchObject({ dirty: true, editVersion: 1, canUndo: true, canRedo: false })
    store.getState().markSaved()
    store.getState().undo()
    expect(store.getState()).toMatchObject({ dirty: true, editVersion: 2, canUndo: false, canRedo: true })
    store.getState().redo()
    expect(store.getState()).toMatchObject({ editVersion: 3, canUndo: true, canRedo: false })
  })

  it('ignores changes from a replaced scene\'s terrain', () => {
    const store = createEditorStore()
    const old = store.getState().terrain
    store.getState().replaceScene(createScene({ size: 64 }))
    old.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 4, strength: 1, falloff: 0 }, { x: 0, z: 0 })
    old.dab({ x: 0, z: 0 }, 0.1, false)
    old.endStroke()
    expect(store.getState()).toMatchObject({ dirty: false, editVersion: 0 })
  })

  it('holds tool and brush settings, clamped', () => {
    const store = createEditorStore()
    const s = () => store.getState()
    expect([s().tool, s().terrainMode, s().biome, s().invertToggle]).toEqual([null, 'raise', 'forest', false])
    expect(s().brush).toEqual({ radius: 8, strength: 0.5, falloff: 0.5 })
    s().setTool('paint')
    s().setTerrainMode('flatten')
    s().setBiome('swamp')
    s().setInvertToggle(true)
    expect([s().tool, s().terrainMode, s().biome, s().invertToggle]).toEqual(['paint', 'flatten', 'swamp', true])
    s().setBrush({ radius: 500, strength: -1, falloff: 2 })
    expect(s().brush).toEqual({ radius: 50, strength: 0, falloff: 1 })
    s().resizeBrush(0.001)
    expect(s().brush.radius).toBe(1)
    s().setBrush({ radius: 10 })
    s().resizeBrush(1.25)
    expect(s().brush.radius).toBeCloseTo(12.5)
  })
})
