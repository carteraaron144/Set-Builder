import type { GroundPoint } from '../camera/overheadCamera'

/** A pointer hit on the ground; 3D brushes also carry the height. */
export type BrushPoint = GroundPoint & { y?: number }

export interface BrushInputOptions {
  /** The canvas. */
  element: HTMLElement
  /** A brush tool is selected. */
  active(): boolean
  pick(clientX: number, clientY: number): BrushPoint | null
  begin(at: BrushPoint | null): void
  dab(at: BrushPoint, dt: number, altKey: boolean): void
  end(): void
  /** The ground under the pointer, for the brush cursor; null when off the terrain or canvas. */
  hover(at: BrushPoint | null): void
}

/** Left-drag on the canvas → begin / per-frame dab / end. Alt is tracked from pointer and key events. */
export class BrushInput {
  private readonly opts: BrushInputOptions
  private readonly controller = new AbortController()
  private pressed: { pointerId: number; x: number; y: number } | null = null
  private alt = false

  constructor(opts: BrushInputOptions) {
    this.opts = opts
    const signal = this.controller.signal
    const el = opts.element
    el.addEventListener('pointerdown', this.onPointerDown, { signal })
    el.addEventListener('pointermove', this.onHover, { signal })
    el.addEventListener('pointerleave', () => opts.hover(null), { signal })
    window.addEventListener('pointermove', this.onDragMove, { signal })
    window.addEventListener('pointerup', this.onPointerUp, { signal })
    window.addEventListener('pointercancel', this.onPointerUp, { signal })
    window.addEventListener('blur', this.finish, { signal })
    window.addEventListener('keydown', this.onKey, { signal })
    window.addEventListener('keyup', this.onKey, { signal })
  }

  /** Applies one dab at the ground under the pointer (re-picked: the ground moves under a raising brush). */
  update(dt: number): void {
    if (!this.pressed || dt <= 0) return
    const at = this.opts.pick(this.pressed.x, this.pressed.y)
    if (at) this.opts.dab(at, dt, this.alt)
  }

  dispose(): void {
    this.finish()
    this.controller.abort()
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.opts.active()) return
    e.preventDefault()
    this.pressed = { pointerId: e.pointerId, x: e.clientX, y: e.clientY }
    this.alt = e.altKey
    try {
      this.opts.element.setPointerCapture?.(e.pointerId)
    } catch {
      // Best-effort; window listeners still see the drag.
    }
    this.opts.begin(this.opts.pick(e.clientX, e.clientY))
  }

  private readonly onDragMove = (e: PointerEvent) => {
    if (!this.pressed || e.pointerId !== this.pressed.pointerId) return
    this.pressed.x = e.clientX
    this.pressed.y = e.clientY
    this.alt = e.altKey
  }

  private readonly onHover = (e: PointerEvent) => {
    this.opts.hover(this.opts.pick(e.clientX, e.clientY))
  }

  private readonly onPointerUp = (e: PointerEvent) => {
    if (this.pressed && e.pointerId === this.pressed.pointerId) this.finish()
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Alt') this.alt = e.type === 'keydown'
  }

  private readonly finish = () => {
    if (!this.pressed) return
    this.pressed = null
    this.opts.end()
  }
}
