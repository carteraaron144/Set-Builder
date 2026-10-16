import { describe, expect, it } from 'vitest'
import { emptyFeatures, type Features, type Pond } from '../features/features'
import { floodPond } from '../features/ponds'
import { createFlatLayers } from '../terrain/layers'
import type { SplineResult } from './splineInput'
import { PondInput } from './pondInput'

const SIZE = 64
const RES = SIZE * 2 + 1

/** A bowl 3 m deep with its rim at r = 10, flat at 3 m beyond. */
function bowl() {
  const h = createFlatLayers(SIZE).heights
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) {
      const r = Math.hypot(-SIZE / 2 + i * 0.5, -SIZE / 2 + j * 0.5)
      h.data[j * RES + i] = r <= 10 ? 3 * (r / 10) ** 2 : 3
    }
  return h
}

function setup(features: Features = emptyFeatures()) {
  let f = features
  const heights = bowl()
  const input = new PondInput(
    () => f,
    () => heights,
    () => f.ponds.map((p) => floodPond(heights, p)),
    SIZE,
  )
  const run = (r: SplineResult | null) => {
    if (r?.preview) f = r.preview
    if (r?.commit) f = r.commit
    return r
  }
  return { input, run, features: () => f }
}

const pond = (id: string, x: number, z: number, level: number): Pond => ({ id, seed: { x, z }, level })

describe('PondInput', () => {
  it('creates a pond 1 m above the ground on a click, committed on release', () => {
    const { input, run, features } = setup()
    const down = run(input.pointerDown({ x: 20, z: 20 }, 300))
    expect(down?.commit).toBeUndefined()
    const up = run(input.pointerUp())
    expect(up?.commit?.ponds).toHaveLength(1)
    const p = features().ponds[0]
    expect(p.seed).toEqual({ x: 20, z: 20 })
    expect(p.level).toBeCloseTo(4)
    expect(input.selectedId).toBe(p.id)
  })

  it('raises the level 2 m for a 40 px drag up, previewing as it goes and committing once', () => {
    const { input, run, features } = setup()
    run(input.pointerDown({ x: 0, z: 0 }, 300))
    const a = run(input.pointerMove(290))
    expect(a?.preview?.ponds[0].level).toBeCloseTo(1.5)
    expect(a?.commit).toBeUndefined()
    run(input.pointerMove(260))
    const up = run(input.pointerUp())
    expect(up?.commit?.ponds[0].level).toBeCloseTo(3)
    expect(features().ponds).toHaveLength(1)
  })

  it('selects a pond clicked inside its water instead of making a new one', () => {
    const { input, run, features } = setup({ splines: [], ponds: [pond('p', 0, 0, 2)] })
    run(input.pointerDown({ x: 4, z: 3 }, 300))
    expect(input.selectedId).toBe('p')
    const up = run(input.pointerUp())
    expect(up?.commit).toBeUndefined()
    expect(features().ponds).toHaveLength(1)
  })

  it('selects an empty pond by its seed handle', () => {
    const { input, run, features } = setup({ splines: [], ponds: [pond('p', 20, 20, 1)] })
    run(input.pointerDown({ x: 20.5, z: 20 }, 300))
    run(input.pointerUp())
    expect(input.selectedId).toBe('p')
    expect(features().ponds).toHaveLength(1)
  })

  it('refuses a 51st pond with a message', () => {
    const ponds = Array.from({ length: 50 }, (_, k) => pond(`p${k}`, -30 + (k % 10) * 2, 20 + Math.floor(k / 10) * 2, 0))
    const { input, run, features } = setup({ splines: [], ponds })
    const r = run(input.pointerDown({ x: 25, z: -25 }, 300))
    expect(r?.message).toBe('A scene can have at most 50 ponds.')
    run(input.pointerUp())
    expect(features().ponds).toHaveLength(50)
  })

  it('deletes the selected pond and deselects on Escape', () => {
    const { input, run, features } = setup({ splines: [], ponds: [pond('p', 0, 0, 2)] })
    run(input.pointerDown({ x: 0, z: 0 }, 300))
    run(input.pointerUp())
    expect(run(input.key('Escape'))).not.toBeNull()
    expect(input.selectedId).toBeNull()
    expect(input.key('Escape')).toBeNull()
    input.select('p')
    run(input.key('Delete'))
    expect(features().ponds).toEqual([])
    expect(input.selectedId).toBeNull()
  })
})
