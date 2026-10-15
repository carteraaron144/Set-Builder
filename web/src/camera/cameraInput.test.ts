import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CameraInput } from './cameraInput'
import { cameraLimits, defaultCameraState, orbit, pan, tilt, zoom, type CameraState, type GroundPoint } from './overheadCamera'

const deg = (d: number) => (d * Math.PI) / 180
const limits = cameraLimits(128)

let element: HTMLElement
let state: CameraState
let start: CameraState
let ground: GroundPoint | null
let input: CameraInput

function key(type: 'keydown' | 'keyup', code: string, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }))
}

function pointer(type: string, target: EventTarget, init: PointerEventInit) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }))
}

function expectState(actual: CameraState, expected: CameraState) {
  expect(actual.target.x).toBeCloseTo(expected.target.x)
  expect(actual.target.z).toBeCloseTo(expected.target.z)
  expect(actual.yaw).toBeCloseTo(expected.yaw)
  expect(actual.pitch).toBeCloseTo(expected.pitch)
  expect(actual.distance).toBeCloseTo(expected.distance)
}

beforeEach(() => {
  element = document.createElement('canvas')
  document.body.appendChild(element)
  state = defaultCameraState(128)
  start = state
  ground = { x: 10, z: 0 }
  input = new CameraInput({
    element,
    getState: () => state,
    setState: (s) => {
      state = s
    },
    limits: () => limits,
    pickGround: () => ground,
  })
})

afterEach(() => {
  input.dispose()
  element.remove()
})

describe('CameraInput keyboard', () => {
  it.each(['KeyW', 'ArrowUp'])('%s pans forward at 0.8 × distance per second', (code) => {
    key('keydown', code)
    input.update(0.5)
    expectState(state, pan(start, 0, 0.8 * start.distance * 0.5, limits))
  })

  it('stops panning after keyup', () => {
    key('keydown', 'KeyD')
    key('keyup', 'KeyD')
    input.update(1)
    expectState(state, start)
  })

  it('Q orbits 90° per second', () => {
    key('keydown', 'KeyQ')
    input.update(1)
    expectState(state, orbit(start, deg(90)))
  })

  it('PageUp tilts 45° per second, clamped', () => {
    key('keydown', 'PageUp')
    input.update(1)
    expectState(state, tilt(start, deg(45), limits))
    expect(state.pitch).toBeCloseTo(deg(85))
  })

  it('R zooms in by exp(-1.5 × dt)', () => {
    key('keydown', 'KeyR')
    input.update(0.2)
    expectState(state, zoom(start, Math.exp(-1.5 * 0.2), limits))
  })

  it('ignores keys typed into an input', () => {
    const field = document.createElement('input')
    document.body.appendChild(field)
    key('keydown', 'KeyW', field)
    input.update(1)
    expectState(state, start)
    field.remove()
  })

  it('ignores keys pressed with Ctrl or Cmd held', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', metaKey: true }))
    input.update(1)
    expectState(state, start)
  })

  it('releases held keys after a Cmd chord (macOS sends no keyup for keys released while Cmd is down)', () => {
    key('keydown', 'KeyW')
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'MetaLeft', key: 'Meta', metaKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', metaKey: true }))
    // KeyW is released while Cmd is held: no keyup arrives.
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'MetaLeft', key: 'Meta' }))
    input.update(1)
    expectState(state, start)
  })

  it('releases held keys when the window loses focus', () => {
    key('keydown', 'KeyW')
    window.dispatchEvent(new Event('blur'))
    input.update(1)
    expectState(state, start)
  })

  it('does nothing after dispose', () => {
    input.dispose()
    key('keydown', 'KeyW')
    input.update(1)
    expectState(state, start)
  })
})

describe('CameraInput pointer', () => {
  it('wheel up zooms by 0.9 toward the ground point under the cursor', () => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 50, clientY: 50, bubbles: true, cancelable: true }))
    expectState(state, zoom(start, 0.9, limits, { x: 10, z: 0 }))
  })

  it('wheel zooms around the target when the cursor is off the ground', () => {
    ground = null
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    expectState(state, zoom(start, 1 / 0.9, limits))
  })

  it('right-drag of 100 px to the right orbits by -30°', () => {
    pointer('pointerdown', element, { button: 2, clientX: 100, clientY: 100 })
    pointer('pointermove', window, { buttons: 2, clientX: 200, clientY: 100 })
    pointer('pointerup', window, { button: 2, clientX: 200, clientY: 100 })
    expectState(state, orbit(start, -deg(30)))
  })

  it('right-drag vertically tilts 0.2° per pixel', () => {
    pointer('pointerdown', element, { button: 2, clientX: 100, clientY: 100 })
    pointer('pointermove', window, { buttons: 2, clientX: 100, clientY: 50 })
    pointer('pointerup', window, { button: 2 })
    expectState(state, tilt(start, deg(-10), limits))
  })

  it('middle-drag pans distance / 800 metres per pixel, the ground following the cursor', () => {
    pointer('pointerdown', element, { button: 1, clientX: 100, clientY: 100 })
    pointer('pointermove', window, { buttons: 4, clientX: 180, clientY: 100 })
    pointer('pointerup', window, { button: 1 })
    expectState(state, pan(start, -80 * (start.distance / 800), 0, limits))
  })

  it('stops dragging after pointerup', () => {
    pointer('pointerdown', element, { button: 2, clientX: 100, clientY: 100 })
    pointer('pointerup', window, { button: 2 })
    pointer('pointermove', window, { clientX: 300, clientY: 100 })
    expectState(state, start)
  })

  it('edge-scrolls at keyboard pan speed when the pointer is within 8 px of an edge', () => {
    element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    pointer('pointermove', element, { clientX: 795, clientY: 3 })
    input.update(0.5)
    const step = 0.8 * start.distance * 0.5
    expectState(state, pan(start, step, step, limits))
  })

  it('stops edge-scrolling when the pointer leaves the canvas', () => {
    element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    pointer('pointermove', element, { clientX: 795, clientY: 300 })
    pointer('pointerleave', element, { clientX: 900, clientY: 300 })
    input.update(1)
    expectState(state, start)
  })

  it('suppresses the context menu on the canvas', () => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    element.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })
})
