import type { Features } from '../features/features'
import { arrowHit, AXIS_DIR, axisParam, type Axis } from './axisGizmo'
import { rayDistance, type Ray } from './caveInput'
import { handleAxes, listHandles, moveHandle, removeHandle, sameHandle, type Handle, type HandleRef } from './handles'
import { HANDLE_RADIUS, type SplineKey, type SplineResult } from './splineInput'

interface Vec {
  x: number
  y: number
  z: number
}

type Drag = { ref: HandleRef; start: Vec; moved: Features | null; axis?: { axis: Axis; from: number } }

/**
 * The Select tool: every handle of every feature (path and river points, cave points, pond seeds) can be picked,
 * moved and deleted, through the generic handle functions rather than any feature type's own tool. Pure, like
 * the other inputs: a press on a handle selects it and drags it in its horizontal plane (or along an arrow of the
 * selected handle's gizmo), and the drag previews until the release commits it.
 */
export class SelectInput {
  private readonly getFeatures: () => Features
  private readonly groundY: (x: number, z: number) => number
  private readonly half: number
  private readonly gizmoLength: (at: Vec) => number
  private picked: HandleRef | null = null
  private over: HandleRef | null = null
  private overArrow: Axis | null = null
  private drag: Drag | null = null

  /** `groundY` is the handle height of paths, rivers and ponds; `gizmoLength` the arrow length at a point. */
  constructor(getFeatures: () => Features, groundY: (x: number, z: number) => number, size: number, gizmoLength: (at: Vec) => number = () => 4) {
    this.getFeatures = getFeatures
    this.groundY = groundY
    this.half = size / 2
    this.gizmoLength = gizmoLength
  }

  /** Every handle, for drawing. */
  handles(): Handle[] {
    return listHandles(this.getFeatures(), this.groundY)
  }

  /** The selected handle; null once its feature or point is gone. */
  get selected(): HandleRef | null {
    return this.find(this.picked)
  }

  get hovered(): HandleRef | null {
    return this.find(this.over)
  }

  /** The arrow of the selected handle's gizmo under the pointer. */
  get hoveredAxis(): Axis | null {
    return this.overArrow
  }

  select(ref: HandleRef | null): void {
    this.picked = ref
    this.drag = null
    this.over = null
    this.overArrow = null
  }

  /** Grabs the selected handle's arrow, or a handle, or (over nothing) deselects. */
  pointerDown(ray: Ray): SplineResult | null {
    const sel = this.handle(this.picked)
    const arrow = sel && this.arrowAt(sel, ray)
    if (sel && arrow) {
      const from = axisParam(ray, sel.position, arrow)
      if (from !== null) {
        this.drag = { ref: sel.ref, start: { ...sel.position }, moved: null, axis: { axis: arrow, from } }
        this.overArrow = arrow
        return {}
      }
    }
    const hit = this.handleAt(ray)
    if (!hit) {
      this.select(null)
      return {}
    }
    this.picked = hit.ref
    this.drag = { ref: hit.ref, start: { ...hit.position }, moved: null }
    this.over = hit.ref
    return {}
  }

  /** Mid-drag, previews the moved handle; otherwise updates what is hovered. */
  pointerMove(ray: Ray): SplineResult | null {
    const d = this.drag
    if (!d) {
      this.over = this.handleAt(ray)?.ref ?? null
      const sel = this.handle(this.picked)
      this.overArrow = (sel && this.arrowAt(sel, ray)) ?? null
      return null
    }
    const to = d.axis ? this.alongAxis(d, d.axis, ray) : this.inPlane(d, ray)
    if (!to) return null
    // A move sets absolute positions, so it never compounds on the previews it follows.
    d.moved = moveHandle(this.getFeatures(), d.ref, to, this.half)
    return { preview: d.moved }
  }

  pointerUp(): SplineResult | null {
    const d = this.drag
    if (!d) return null
    this.drag = null
    this.overArrow = null
    return d.moved ? { commit: d.moved } : {}
  }

  key(k: SplineKey): SplineResult | null {
    const sel = this.handle(this.picked)
    if (!sel || k === 'Enter') return null
    this.select(null)
    if (k === 'Escape') return {}
    return { commit: removeHandle(this.getFeatures(), sel.ref) }
  }

  /** Drops a drag in progress; true if there was one. */
  cancel(): boolean {
    const had = this.drag !== null
    this.drag = null
    return had
  }

  private find(ref: HandleRef | null): HandleRef | null {
    return this.handle(ref)?.ref ?? null
  }

  /** The current handle for `ref`, or null if its feature or point is gone. */
  private handle(ref: HandleRef | null): Handle | null {
    return ref ? (listHandles(this.getFeatures(), this.groundY).find((h) => sameHandle(h.ref, ref)) ?? null) : null
  }

  private arrowAt(h: Handle, ray: Ray): Axis | null {
    return arrowHit(ray, h.position, this.gizmoLength(h.position), handleAxes(h.ref))
  }

  /** The nearest handle to the ray within the handle radius; the selected one wins ties. */
  private handleAt(ray: Ray): Handle | null {
    let best: Handle | null = null
    let bestDistance: number = HANDLE_RADIUS
    for (const h of listHandles(this.getFeatures(), this.groundY)) {
      const d = rayDistance(ray, h.position)
      if (d < bestDistance || (d === bestDistance && sameHandle(h.ref, this.picked))) {
        best = h
        bestDistance = d
      }
    }
    return best
  }

  /** Where the ray crosses the horizontal plane through the handle's start. */
  private inPlane(d: Drag, ray: Ray): Vec | null {
    if (Math.abs(ray.dir.y) < 1e-6) return null
    const t = (d.start.y - ray.origin.y) / ray.dir.y
    if (t <= 0) return null
    return { x: ray.origin.x + ray.dir.x * t, y: d.start.y, z: ray.origin.z + ray.dir.z * t }
  }

  /** The start moved by how far the pointer has travelled along the axis. */
  private alongAxis(d: Drag, a: { axis: Axis; from: number }, ray: Ray): Vec | null {
    const s = axisParam(ray, d.start, a.axis)
    if (s === null) return null
    const dir = AXIS_DIR[a.axis]
    const delta = s - a.from
    return { x: d.start.x + dir.x * delta, y: d.start.y + dir.y * delta, z: d.start.z + dir.z * delta }
  }
}
