import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createEditorStore } from './editorStore'
import { installEditorShortcuts, type ShortcutHandlers } from './shortcuts'

let h: { [K in keyof ShortcutHandlers]: Mock<ShortcutHandlers[K]> }
let uninstall: () => void

function press(init: KeyboardEventInit, target: EventTarget = window) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

beforeEach(() => {
  h = {
    save: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    resizeBrush: vi.fn<(f: number) => void>(),
    deselectTool: vi.fn(),
    featureKey: vi.fn<ShortcutHandlers['featureKey']>(() => false),
  }
  uninstall = installEditorShortcuts(window, h)
})

afterEach(() => uninstall())

describe('editor shortcuts', () => {
  it('undoes with Cmd+Z or Ctrl+Z', () => {
    expect(press({ key: 'z', metaKey: true }).defaultPrevented).toBe(true)
    press({ key: 'z', ctrlKey: true })
    expect(h.undo).toHaveBeenCalledTimes(2)
    expect(h.redo).not.toHaveBeenCalled()
  })

  it('redoes with Cmd+Shift+Z or Ctrl+Y', () => {
    press({ key: 'Z', metaKey: true, shiftKey: true })
    press({ key: 'y', ctrlKey: true })
    expect(h.redo).toHaveBeenCalledTimes(2)
    expect(h.undo).not.toHaveBeenCalled()
  })

  it('resizes the brush with [ and ]', () => {
    press({ key: '[' })
    press({ key: ']' })
    expect(h.resizeBrush.mock.calls).toEqual([[0.8], [1.25]])
  })

  it('deselects the tool with Escape', () => {
    press({ key: 'Escape' })
    expect(h.deselectTool).toHaveBeenCalledTimes(1)
  })

  it('offers Enter, Escape, Backspace and Delete to the feature tool first', () => {
    h.featureKey.mockReturnValue(true)
    for (const key of ['Enter', 'Escape', 'Backspace', 'Delete']) expect(press({ key }).defaultPrevented).toBe(true)
    expect(h.featureKey.mock.calls).toEqual([['Enter'], ['Escape'], ['Backspace'], ['Delete']])
    expect(h.deselectTool).not.toHaveBeenCalled()
  })

  it('deselects the tool on an Escape the feature tool did not use, and leaves other unused keys alone', () => {
    expect(press({ key: 'Escape' }).defaultPrevented).toBe(false)
    expect(press({ key: 'Enter' }).defaultPrevented).toBe(false)
    expect(h.deselectTool).toHaveBeenCalledTimes(1)
  })

  it('does not offer feature keys from a text field or with a modifier', () => {
    const field = document.createElement('input')
    document.body.appendChild(field)
    press({ key: 'Backspace' }, field)
    press({ key: 'Delete', metaKey: true })
    expect(h.featureKey).not.toHaveBeenCalled()
    field.remove()
  })

  it('saves with Cmd+S, even in a text field', () => {
    expect(press({ key: 's', metaKey: true }).defaultPrevented).toBe(true)
    const field = document.createElement('input')
    document.body.appendChild(field)
    press({ key: 's', ctrlKey: true }, field)
    expect(h.save).toHaveBeenCalledTimes(2)
    field.remove()
  })

  it('leaves every other key to a focused text field', () => {
    const field = document.createElement('input')
    document.body.appendChild(field)
    for (const init of [
      { key: 'z', metaKey: true },
      { key: 'Z', metaKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
      { key: '[' },
      { key: ']' },
      { key: 'Escape' },
    ]) {
      expect(press(init, field).defaultPrevented).toBe(false)
    }
    expect([h.undo, h.redo, h.resizeBrush, h.deselectTool].every((f) => f.mock.calls.length === 0)).toBe(true)
    field.remove()
  })

  it('stops after uninstalling', () => {
    uninstall()
    press({ key: 'z', metaKey: true })
    press({ key: '[' })
    expect(h.undo).not.toHaveBeenCalled()
    expect(h.resizeBrush).not.toHaveBeenCalled()
    uninstall = () => {}
  })

  it('undoes a stroke mid-drag and redoes it afterwards (real store)', () => {
    uninstall()
    const store = createEditorStore()
    uninstall = installEditorShortcuts(window, {
      save: () => {},
      undo: () => store.getState().undo(),
      redo: () => store.getState().redo(),
      resizeBrush: () => {},
      deselectTool: () => {},
      featureKey: () => false,
    })
    const { terrain } = store.getState()
    const before = terrain.layers.heights.data.slice()
    const same = () => terrain.layers.heights.data.every((v, i) => v === before[i])
    terrain.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 4, strength: 1, falloff: 0 }, { x: 0, z: 0 })
    terrain.dab({ x: 0, z: 0 }, 0.1, false)
    press({ key: 'z', ctrlKey: true })
    expect(same()).toBe(true)
    terrain.dab({ x: 0, z: 0 }, 0.1, false)
    expect(same()).toBe(true)
    press({ key: 'Z', ctrlKey: true, shiftKey: true })
    expect(same()).toBe(true)
    terrain.endStroke()
    press({ key: 'Z', ctrlKey: true, shiftKey: true })
    expect(same()).toBe(false)
  })
})

describe('editor shortcuts with brush panel controls focused', () => {
  beforeEach(() => {
    h = {
    save: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    resizeBrush: vi.fn<(f: number) => void>(),
    deselectTool: vi.fn(),
    featureKey: vi.fn<ShortcutHandlers['featureKey']>(() => false),
  }
    uninstall = installEditorShortcuts(window, h)
  })
  afterEach(() => uninstall())

  it.each(['range', 'radio', 'checkbox'])('still works when a %s input has focus', (type) => {
    const control = document.createElement('input')
    control.type = type
    document.body.appendChild(control)
    press({ key: 'z', metaKey: true }, control)
    press({ key: ']' }, control)
    press({ key: 'Escape' }, control)
    expect(h.undo).toHaveBeenCalledTimes(1)
    expect(h.resizeBrush).toHaveBeenCalledWith(1.25)
    expect(h.deselectTool).toHaveBeenCalledTimes(1)
    control.remove()
  })
})
