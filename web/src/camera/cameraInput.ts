import {
  orbit,
  pan,
  tilt,
  zoom,
  type CameraLimits,
  type CameraState,
  type GroundPoint,
} from './overheadCamera'

export interface CameraInputOptions {
  /** The canvas. Pointer, wheel and context-menu events are taken from it. */
  element: HTMLElement
  getState(): CameraState
  setState(s: CameraState): void
  limits(): CameraLimits
  /** Raycasts the client point against y = 0; null when it misses the ground. */
  pickGround(clientX: number, clientY: number): GroundPoint | null
}

// Tuning values from the M0 plan; adjust after playtesting.
const DEG = Math.PI / 180
const KEY_PAN_SPEED = 0.8 // × distance, metres per second
const KEY_ORBIT_SPEED = 90 * DEG // radians per second
const KEY_ZOOM_RATE = 1.5 // factor exp(∓rate × dt)
const KEY_TILT_SPEED = 45 * DEG // radians per second
const DRAG_PAN_PER_PIXEL = 1 / 800 // × distance, metres per pixel
const DRAG_ORBIT_PER_PIXEL = 0.3 * DEG
const DRAG_TILT_PER_PIXEL = 0.2 * DEG
const WHEEL_ZOOM_PER_100PX = 0.9
const EDGE_SCROLL_MARGIN = 8 // pixels

const FORWARD = new Set(['KeyW', 'ArrowUp'])
const BACK = new Set(['KeyS', 'ArrowDown'])
const LEFT = new Set(['KeyA', 'ArrowLeft'])
const RIGHT = new Set(['KeyD', 'ArrowRight'])
const HANDLED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'PageUp', 'PageDown'])

type DragMode = 'pan' | 'orbit'

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

function wheelPixels(e: WheelEvent, element: HTMLElement): number {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * 16
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * (element.clientHeight || 800)
  return e.deltaY
}

/** Skylines-style camera bindings: DOM events in, CameraState updates out. */
export class CameraInput {
  private readonly opts: CameraInputOptions
  private readonly held = new Set<string>()
  private drag: { mode: DragMode; x: number; y: number; pointerId: number } | null = null
  private hover: { x: number; y: number } | null = null
  private readonly controller = new AbortController()

  constructor(opts: CameraInputOptions) {
    this.opts = opts
    const signal = this.controller.signal
    const el = opts.element

    window.addEventListener('keydown', this.onKeyDown, { signal })
    window.addEventListener('keyup', this.onKeyUp, { signal })
    window.addEventListener('blur', this.releaseAll, { signal })
    document.addEventListener('visibilitychange', this.onVisibilityChange, { signal })

    el.addEventListener('pointerdown', this.onPointerDown, { signal })
    el.addEventListener('pointermove', this.onHover, { signal })
    el.addEventListener('pointerleave', this.onLeave, { signal })
    window.addEventListener('pointermove', this.onDragMove, { signal })
    window.addEventListener('pointerup', this.onPointerUp, { signal })
    window.addEventListener('pointercancel', this.onPointerUp, { signal })
    el.addEventListener('wheel', this.onWheel, { signal, passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal })
  }

  /** Applies held keys and edge scroll. Call once per frame. */
  update(dtSeconds: number): void {
    if (dtSeconds <= 0) return
    let s = this.opts.getState()
    const before = s
    const l = this.opts.limits()
    const has = (codes: Set<string>) => [...codes].some((c) => this.held.has(c))

    let right = (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0)
    let forward = (has(FORWARD) ? 1 : 0) - (has(BACK) ? 1 : 0)
    const edge = this.edgeDirection()
    right = Math.max(-1, Math.min(1, right + edge.right))
    forward = Math.max(-1, Math.min(1, forward + edge.forward))
    if (right !== 0 || forward !== 0) {
      const step = KEY_PAN_SPEED * s.distance * dtSeconds
      s = pan(s, right * step, forward * step, l)
    }

    const turn = (this.held.has('KeyQ') ? 1 : 0) - (this.held.has('KeyE') ? 1 : 0)
    if (turn !== 0) s = orbit(s, turn * KEY_ORBIT_SPEED * dtSeconds)

    const zoomDir = (this.held.has('KeyF') ? 1 : 0) - (this.held.has('KeyR') ? 1 : 0)
    if (zoomDir !== 0) s = zoom(s, Math.exp(zoomDir * KEY_ZOOM_RATE * dtSeconds), l)

    const tiltDir = (this.held.has('PageUp') ? 1 : 0) - (this.held.has('PageDown') ? 1 : 0)
    if (tiltDir !== 0) s = tilt(s, tiltDir * KEY_TILT_SPEED * dtSeconds, l)

    if (s !== before) this.opts.setState(s)
  }

  /** Removes every listener. */
  dispose(): void {
    this.controller.abort()
    this.releaseAll()
  }

  private edgeDirection(): { right: number; forward: number } {
    if (!this.hover || this.drag) return { right: 0, forward: 0 }
    const r = this.opts.element.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return { right: 0, forward: 0 }
    const { x, y } = this.hover
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return { right: 0, forward: 0 }
    const right = x >= r.right - EDGE_SCROLL_MARGIN ? 1 : x <= r.left + EDGE_SCROLL_MARGIN ? -1 : 0
    const forward = y <= r.top + EDGE_SCROLL_MARGIN ? 1 : y >= r.bottom - EDGE_SCROLL_MARGIN ? -1 : 0
    return { right, forward }
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!HANDLED.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return
    this.held.add(e.code)
    e.preventDefault()
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    // macOS sends no keyup for keys released while Cmd was down, so anything still held may be stale.
    if (e.key === 'Meta') this.held.clear()
    else this.held.delete(e.code)
  }

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.releaseAll()
  }

  private readonly releaseAll = () => {
    this.held.clear()
    this.drag = null
    this.hover = null
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    const mode: DragMode | null = e.button === 1 ? 'pan' : e.button === 2 ? 'orbit' : null
    if (!mode) return
    e.preventDefault()
    this.drag = { mode, x: e.clientX, y: e.clientY, pointerId: e.pointerId }
    try {
      this.opts.element.setPointerCapture?.(e.pointerId)
    } catch {
      // Capture is best-effort; window listeners still see the drag.
    }
  }

  private readonly onDragMove = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return
    const dx = e.clientX - this.drag.x
    const dy = e.clientY - this.drag.y
    this.drag.x = e.clientX
    this.drag.y = e.clientY
    if (dx === 0 && dy === 0) return
    const s = this.opts.getState()
    const l = this.opts.limits()
    if (this.drag.mode === 'pan') {
      const k = s.distance * DRAG_PAN_PER_PIXEL
      this.opts.setState(pan(s, -dx * k, dy * k, l))
    } else {
      this.opts.setState(tilt(orbit(s, -dx * DRAG_ORBIT_PER_PIXEL), dy * DRAG_TILT_PER_PIXEL, l))
    }
  }

  private readonly onPointerUp = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.pointerId) this.drag = null
  }

  private readonly onHover = (e: PointerEvent) => {
    this.hover = { x: e.clientX, y: e.clientY }
  }

  private readonly onLeave = () => {
    this.hover = null
  }

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const px = wheelPixels(e, this.opts.element)
    if (px === 0) return
    const factor = Math.pow(WHEEL_ZOOM_PER_100PX, -px / 100)
    const toward = this.opts.pickGround(e.clientX, e.clientY) ?? undefined
    this.opts.setState(zoom(this.opts.getState(), factor, this.opts.limits(), toward))
  }
}
