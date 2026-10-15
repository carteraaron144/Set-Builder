import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { GroundPoint } from '../camera/overheadCamera'
import { BrushInput, type BrushInputOptions } from './brushInput'

let element: HTMLElement
let active: boolean
let ground: GroundPoint | null
let opts: {
  begin: Mock<BrushInputOptions['begin']>
  dab: Mock<BrushInputOptions['dab']>
  end: Mock<BrushInputOptions['end']>
  hover: Mock<BrushInputOptions['hover']>
}
let input: BrushInput

function pointer(type: string, target: EventTarget, init: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 10, clientY: 10, ...init }))
}

beforeEach(() => {
  element = document.createElement('canvas')
  document.body.appendChild(element)
  active = true
  ground = { x: 3, z: 4 }
  opts = { begin: vi.fn(), dab: vi.fn(), end: vi.fn(), hover: vi.fn() }
  input = new BrushInput({ element, active: () => active, pick: () => ground, ...opts })
})

afterEach(() => {
  input.dispose()
  element.remove()
})

describe('BrushInput', () => {
  it('does nothing without an active tool', () => {
    active = false
    pointer('pointerdown', element, { button: 0 })
    input.update(0.1)
    pointer('pointerup', window, { button: 0 })
    expect(opts.begin).not.toHaveBeenCalled()
    expect(opts.dab).not.toHaveBeenCalled()
    expect(opts.end).not.toHaveBeenCalled()
  })

  it('begins, dabs every update and ends a left-drag', () => {
    pointer('pointerdown', element, { button: 0 })
    expect(opts.begin).toHaveBeenCalledWith({ x: 3, z: 4 })
    input.update(0.1)
    expect(opts.dab).toHaveBeenLastCalledWith({ x: 3, z: 4 }, 0.1, false)
    pointer('pointermove', window, { buttons: 1, altKey: true, clientX: 20 })
    input.update(0.05)
    expect(opts.dab).toHaveBeenLastCalledWith({ x: 3, z: 4 }, 0.05, true)
    pointer('pointerup', window, { button: 0 })
    expect(opts.end).toHaveBeenCalledTimes(1)
    input.update(0.1)
    expect(opts.dab).toHaveBeenCalledTimes(2)
  })

  it('re-picks the ground on every update', () => {
    pointer('pointerdown', element, { button: 0 })
    ground = { x: 7, z: 7 }
    input.update(0.1)
    expect(opts.dab).toHaveBeenLastCalledWith({ x: 7, z: 7 }, 0.1, false)
  })

  it('tracks Alt from the keyboard during a drag', () => {
    pointer('pointerdown', element, { button: 0 })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }))
    input.update(0.1)
    expect(opts.dab).toHaveBeenLastCalledWith({ x: 3, z: 4 }, 0.1, true)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false }))
    input.update(0.1)
    expect(opts.dab).toHaveBeenLastCalledWith({ x: 3, z: 4 }, 0.1, false)
  })

  it('ignores middle and right buttons', () => {
    pointer('pointerdown', element, { button: 1 })
    pointer('pointerdown', element, { button: 2 })
    input.update(0.1)
    expect(opts.begin).not.toHaveBeenCalled()
    expect(opts.dab).not.toHaveBeenCalled()
  })

  it('ends the stroke when the window loses focus', () => {
    pointer('pointerdown', element, { button: 0 })
    window.dispatchEvent(new Event('blur'))
    expect(opts.end).toHaveBeenCalledTimes(1)
    input.update(0.1)
    expect(opts.dab).not.toHaveBeenCalled()
  })

  it('does not dab off the terrain', () => {
    pointer('pointerdown', element, { button: 0 })
    ground = null
    input.update(0.1)
    expect(opts.dab).not.toHaveBeenCalled()
  })

  it('reports hover moves and leaving the canvas', () => {
    pointer('pointermove', element, { clientX: 30 })
    expect(opts.hover).toHaveBeenLastCalledWith({ x: 3, z: 4 })
    pointer('pointerleave', element)
    expect(opts.hover).toHaveBeenLastCalledWith(null)
  })

  it('does nothing after dispose', () => {
    input.dispose()
    pointer('pointerdown', element, { button: 0 })
    pointer('pointermove', element)
    input.update(0.1)
    expect(opts.begin).not.toHaveBeenCalled()
    expect(opts.hover).not.toHaveBeenCalled()
  })
})
