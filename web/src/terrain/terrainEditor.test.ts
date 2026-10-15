import { describe, expect, it, vi } from 'vitest'
import { createFlatLayers, type TerrainLayers } from './layers'
import { TerrainEditor, type StrokeTool } from './terrainEditor'

const raise: StrokeTool = { tool: 'terrain', mode: 'raise' }
const brush = { radius: 4, strength: 1, falloff: 0 }

function editor(size: 64 | 256 = 256, layers: TerrainLayers = createFlatLayers(size)) {
  const onChange = vi.fn()
  return { ed: new TerrainEditor(layers, 7, onChange), onChange }
}

function stroke(ed: TerrainEditor, t: StrokeTool = raise, x = 0, z = 0) {
  ed.beginStroke(t, brush, { x, z })
  ed.dab({ x, z }, 0.1, false)
  ed.endStroke()
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v, i) => v === b[i])

describe('TerrainEditor strokes and undo', () => {
  it('records a stroke and undoes and redoes it exactly', () => {
    const { ed, onChange } = editor()
    const before = ed.layers.heights.data.slice()
    stroke(ed)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('stroke')
    const after = ed.layers.heights.data.slice()
    expect(same(after, before)).toBe(false)
    expect(ed.canUndo).toBe(true)
    expect(ed.undo()).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith('undo')
    expect(same(ed.layers.heights.data, before)).toBe(true)
    expect(ed.redo()).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith('redo')
    expect(same(ed.layers.heights.data, after)).toBe(true)
  })

  it('records nothing for an empty or off-scene stroke', () => {
    const { ed, onChange } = editor()
    ed.beginStroke(raise, brush, null)
    ed.endStroke()
    ed.beginStroke(raise, brush, { x: 500, z: 0 })
    ed.dab({ x: 500, z: 0 }, 0.1, false)
    ed.endStroke()
    ed.beginStroke({ tool: 'terrain', mode: 'smooth' }, brush, { x: 0, z: 0 })
    ed.dab({ x: 0, z: 0 }, 0.1, false)
    ed.endStroke()
    expect(ed.canUndo).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports the chunks a change touched, once', () => {
    const { ed } = editor()
    stroke(ed)
    expect(ed.takeDirtyChunks()).toEqual([27, 28, 35, 36])
    expect(ed.takeDirtyChunks()).toEqual([])
    ed.undo()
    expect(ed.takeDirtyChunks()).toEqual([27, 28, 35, 36])
  })

  it('flattens to the height under the cursor at stroke start', () => {
    const { ed } = editor(64)
    stroke(ed)
    const peak = ed.layers.heights.data[64 * 129 + 64]
    ed.beginStroke({ tool: 'terrain', mode: 'flatten' }, { radius: 20, strength: 1, falloff: 0 }, { x: 0, z: 0 })
    ed.dab({ x: 0, z: 0 }, 10, false)
    ed.endStroke()
    expect(ed.layers.heights.data[64 * 129 + 70]).toBeCloseTo(peak)
  })

  it('undoes a paint stroke back to the original biome bytes', () => {
    const { ed } = editor()
    const before = ed.layers.biomes.data.slice()
    stroke(ed, { tool: 'paint', biome: 'swamp' }, 10, 10)
    expect(same(ed.layers.biomes.data, before)).toBe(false)
    ed.undo()
    expect(same(ed.layers.biomes.data, before)).toBe(true)
  })

  it('undo during a stroke restores the pre-stroke terrain and ignores the rest of the drag', () => {
    const { ed } = editor()
    const before = ed.layers.heights.data.slice()
    ed.beginStroke(raise, brush, { x: 0, z: 0 })
    ed.dab({ x: 0, z: 0 }, 0.1, false)
    expect(ed.strokeActive).toBe(true)
    expect(ed.undo()).toBe(true)
    expect(same(ed.layers.heights.data, before)).toBe(true)
    expect(ed.canRedo).toBe(true)
    ed.dab({ x: 0, z: 0 }, 0.1, false)
    expect(same(ed.layers.heights.data, before)).toBe(true)
    ed.endStroke()
    expect(ed.canUndo).toBe(false)
    expect(ed.redo()).toBe(true)
    expect(same(ed.layers.heights.data, before)).toBe(false)
  })

  it('ignores redo during a stroke', () => {
    const { ed } = editor()
    stroke(ed)
    ed.undo()
    ed.beginStroke(raise, brush, { x: 20, z: 20 })
    expect(ed.redo()).toBe(false)
    ed.endStroke()
  })

  it('keeps the newest 100 strokes; undoing all of them leaves the first stroke', () => {
    const { ed } = editor(64)
    stroke(ed, raise, -20, -20)
    const afterFirst = ed.layers.heights.data.slice()
    for (let n = 1; n < 101; n++) stroke(ed, raise, ((n * 7) % 50) - 25, ((n * 13) % 50) - 25)
    let undone = 0
    while (ed.undo()) undone++
    expect(undone).toBe(100)
    expect(same(ed.layers.heights.data, afterFirst)).toBe(true)
  })
})

describe('TerrainEditor paint convergence', () => {
  const centre = (ed: TerrainEditor) => [...ed.layers.biomes.data.subarray((32 * 65 + 32) * 4, (32 * 65 + 32) * 4 + 4)]

  function paintFor(seconds: number, hz: number, strength: number) {
    const { ed } = editor(64)
    ed.beginStroke({ tool: 'paint', biome: 'forest' }, { radius: 8, strength, falloff: 0.5 }, { x: 0, z: 0 })
    for (let n = 0; n < Math.round(seconds * hz); n++) ed.dab({ x: 0, z: 0 }, 1 / hz, false)
    ed.endStroke()
    return ed
  }

  it('reaches full coverage at low strength', () => {
    expect(centre(paintFor(60, 60, 0.1))).toEqual([0, 255, 0, 0])
  })

  it('does not depend on the frame rate', () => {
    const at60 = centre(paintFor(2, 60, 0.1))
    const at144 = centre(paintFor(2, 144, 0.1))
    expect(at60[1]).toBeGreaterThan(50)
    expect(Math.abs(at60[1] - at144[1])).toBeLessThanOrEqual(1)
  })

  it('moves soft-edge samples too', () => {
    const { ed } = editor(64)
    const before = ed.layers.biomes.data.slice()
    ed.beginStroke({ tool: 'paint', biome: 'forest' }, { radius: 8, strength: 0.5, falloff: 1 }, { x: 0, z: 0 })
    for (let n = 0; n < 600; n++) ed.dab({ x: 0, z: 0 }, 1 / 60, false)
    ed.endStroke()
    const at7m = (32 * 65 + 39) * 4
    expect(ed.layers.biomes.data[at7m + 1]).toBeGreaterThan(before[at7m + 1])
  })
})

describe('TerrainEditor terrace', () => {
  it('terraces at the scene corner, undoes exactly and rebuilds the corner chunk', () => {
    const layers = createFlatLayers(64)
    for (let i = 0; i < layers.heights.data.length; i++) layers.heights.data[i] = (i % 129) * 0.07
    const { ed } = editor(64, layers)
    const before = ed.layers.heights.data.slice()
    ed.takeDirtyChunks()
    ed.beginStroke({ tool: 'terrain', mode: 'terrace', terraceStep: 1.5 }, { radius: 8, strength: 1, falloff: 0 }, { x: -32, z: -32 })
    ed.dab({ x: -32, z: -32 }, 10, false)
    ed.endStroke()
    expect(same(ed.layers.heights.data, before)).toBe(false)
    expect(ed.layers.heights.data[16 * 129 + 0] % 1.5).toBeCloseTo(0)
    expect(ed.takeDirtyChunks()).toContain(0)
    ed.undo()
    expect(same(ed.layers.heights.data, before)).toBe(true)
  })

  it('keeps terraced heights through a save and reopen', async () => {
    const { writeSceneFile, readSceneFile } = await import('../scene/sceneFile')
    const { createScene } = await import('../scene/scene')
    const { ed } = editor(64)
    ed.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 12, strength: 1, falloff: 0.5 }, { x: 0, z: 0 })
    ed.dab({ x: 0, z: 0 }, 1, false)
    ed.endStroke()
    ed.beginStroke({ tool: 'terrain', mode: 'terrace', terraceStep: 1.5 }, { radius: 12, strength: 1, falloff: 0 }, { x: 0, z: 0 })
    ed.dab({ x: 0, z: 0 }, 10, false)
    ed.endStroke()
    const read = readSceneFile(writeSceneFile(createScene({ size: 64 }), ed.layers))
    expect(same(read.layers.heights.data, ed.layers.heights.data)).toBe(true)
  })
})
