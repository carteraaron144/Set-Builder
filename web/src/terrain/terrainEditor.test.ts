import { describe, expect, it, vi } from 'vitest'
import { emptyFeatures, type Features, type Spline } from '../features/features'
import { chunksForHeightRect } from './chunks'
import { createFlatLayers, type TerrainLayers } from './layers'
import { TerrainEditor, type StrokeTool } from './terrainEditor'

const raise: StrokeTool = { tool: 'terrain', mode: 'raise' }
const brush = { radius: 4, strength: 1, falloff: 0 }

function editor(size: 64 | 256 = 256, layers: TerrainLayers = createFlatLayers(size), features: Features = emptyFeatures()) {
  const onChange = vi.fn()
  return { ed: new TerrainEditor(layers, 7, features, onChange), onChange }
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

describe('TerrainEditor dirty channels', () => {
  it('reports the same chunks to the mesh and scatter channels independently', () => {
    const { ed } = editor()
    stroke(ed)
    expect(ed.takeDirtyChunks('mesh')).toEqual([27, 28, 35, 36])
    expect(ed.takeDirtyChunks('mesh')).toEqual([])
    expect(ed.takeDirtyChunks('scatter')).toEqual([27, 28, 35, 36])
    expect(ed.takeDirtyChunks()).toEqual([])
  })
})

describe('TerrainEditor features', () => {
  const path = (dz = 0, id = 'a'): Spline => ({
    id,
    kind: 'path',
    style: 'dirt',
    width: 3,
    points: [
      { x: -20, z: dz },
      { x: 20, z: dz },
    ],
  })
  const river: Spline = { id: 'r', kind: 'river', style: 'dirt', width: 4, points: [{ x: -20, z: -20 }, { x: 20, z: -24 }] }
  const one = (...splines: Spline[]): Features => ({ splines, ponds: [] })
  const sampleAt = (x: number, z: number, size = 64) => (z + size / 2) * 2 * (size * 2 + 1) + (x + size / 2) * 2
  const sortedUnion = (...lists: number[][]) => [...new Set(lists.flat())].sort((a, b) => a - b)

  it('keeps a path flat across its width when the ground under it is raised', () => {
    const { ed } = editor(64, createFlatLayers(64), one(path()))
    ed.beginStroke(raise, { radius: 6, strength: 1, falloff: 0.5 }, { x: 2, z: 1 })
    for (let n = 0; n < 10; n++) ed.dab({ x: 2, z: 1 }, 0.1, false)
    ed.endStroke()
    const h = ed.ground.layers.heights.data
    for (let x = -4; x <= 8; x += 0.5) {
      const centre = h[sampleAt(x, 0)]
      for (const z of [-1, -0.5, 0.5, 1]) expect(h[sampleAt(x, z)]).toBeCloseTo(centre, 4)
    }
    expect(ed.ground.layers.heights.data[sampleAt(2, 6)]).toBeGreaterThan(0)
  })

  it('dirties only the stroke chunks for a stroke far from every spline', () => {
    const plain = editor(256)
    const featured = editor(256, createFlatLayers(256), one(path(-100)))
    for (const { ed } of [plain, featured]) {
      ed.takeDirtyChunks()
      stroke(ed, raise, 60, 60)
    }
    expect(featured.ed.takeDirtyChunks()).toEqual(plain.ed.takeDirtyChunks())
    expect(featured.ed.takeDirtyChunks('scatter')).toEqual(plain.ed.takeDirtyChunks('scatter'))
  })

  it('undoes and redoes sculpting, feature edits and painting on one stack', () => {
    const { ed, onChange } = editor(64)
    const snap = () => ({
      heights: ed.layers.heights.data.slice(),
      biomes: ed.layers.biomes.data.slice(),
      ground: ed.ground.layers.heights.data.slice(),
      features: JSON.stringify(ed.features),
    })
    const start = snap()
    stroke(ed, raise, 0, 0)
    ed.commitFeatures(one(path()))
    stroke(ed, { tool: 'paint', biome: 'swamp' }, 10, 10)
    const moved = (z: number) => one({ ...path(), points: [{ x: -20, z: 0 }, { x: 20, z }] })
    ed.previewFeatures(moved(2))
    ed.previewFeatures(moved(5))
    ed.commitFeatures(moved(8))
    expect(onChange).toHaveBeenCalledTimes(4)
    const end = snap()
    for (let n = 0; n < 4; n++) expect(ed.undo()).toBe(true)
    expect(ed.canUndo).toBe(false)
    expect(snap()).toEqual(start)
    for (let n = 0; n < 4; n++) expect(ed.redo()).toBe(true)
    expect(snap()).toEqual(end)
  })

  it('adds no history for previews', () => {
    const { ed, onChange } = editor(64)
    ed.previewFeatures(one(path()))
    ed.previewFeatures(one(path(3)))
    expect(ed.canUndo).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    expect(ed.features).toEqual(one(path(3)))
  })

  it('records nothing for a commit that changes nothing', () => {
    const { ed, onChange } = editor(64, createFlatLayers(64), one(path()))
    ed.commitFeatures(one(path()))
    expect(ed.canUndo).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('dirties the chunks of the old and new footprints, and no others', () => {
    const { ed } = editor(256, createFlatLayers(256), one(path(-60)))
    ed.takeDirtyChunks()
    ed.takeDirtyChunks('scatter')
    const before = ed.ground.profiles[0].footprint!
    ed.commitFeatures(one(path(60)))
    const after = ed.ground.profiles[0].footprint!
    const expected = sortedUnion(chunksForHeightRect(before, 256), chunksForHeightRect(after, 256))
    expect(ed.takeDirtyChunks()).toEqual(expected)
    expect(ed.takeDirtyChunks('scatter')).toEqual(expected)
  })

  it('bumps the water version for river and pond changes only', () => {
    const { ed } = editor(64)
    let v = ed.waterVersion
    ed.commitFeatures(one(path()))
    expect(ed.waterVersion).toBe(v)
    ed.commitFeatures(one(path(), river))
    expect(ed.waterVersion).toBeGreaterThan(v)
    v = ed.waterVersion
    ed.commitFeatures({ splines: [path(), river], ponds: [{ id: 'p', seed: { x: 10, z: 10 }, level: 1 }] })
    expect(ed.waterVersion).toBeGreaterThan(v)
  })

  it('counts feature edits toward the stroke cap', () => {
    const { ed } = editor(64)
    for (let n = 0; n < 101; n++) ed.commitFeatures(one(path(n % 2 ? 1 : 0, `p${n}`)))
    let undone = 0
    while (ed.undo()) undone++
    expect(undone).toBe(100)
    expect(ed.features).toEqual(one(path(0, 'p0')))
  })
})
