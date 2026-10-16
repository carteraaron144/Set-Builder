import {
  defaultWidth,
  FEATURE_LIMITS,
  type Features,
  type PathStyle,
  type Spline,
  type SplineKind,
  type SplinePoint,
} from '../features/features'
import { nearestOnSamples, sampleSpline, snapToEnd } from '../features/spline'
import { arrowHit, AXIS_DIR, axisParam, type Axis } from './axisGizmo'

/** A pick ray in world space; `dir` need not be normalised. */
export interface PickRay {
  origin: { x: number; y: number; z: number }
  dir: { x: number; y: number; z: number }
}

/** Where a selected point's arrows sit: its handle's height, and how long they are there. */
export interface SplineGizmo {
  y(p: SplinePoint): number
  length(at: { x: number; y: number; z: number }): number
}

const DEFAULT_GIZMO: SplineGizmo = { y: () => 0, length: () => 4 }
const SPLINE_AXES: readonly Axis[] = ['x', 'z']

export type SplineKey = 'Enter' | 'Escape' | 'Backspace' | 'Delete'

/** What an event asks the editor to do: show `preview` (mid-drag), record `commit`, or show `message`. */
export interface SplineResult {
  preview?: Features
  commit?: Features
  message?: string
}

/** A click on a handle grabs it; metres. */
export const HANDLE_RADIUS = 1
/** Draft clicks this close to the previous point (a double-click's second click) are ignored; metres. */
const DUPLICATE = 0.5
const TOO_MANY_POINTS = `A spline can have at most ${FEATURE_LIMITS.maxPoints} points.`
const TOO_MANY_SPLINES = `A scene can have at most ${FEATURE_LIMITS.maxSplines} paths and rivers.`

const dist = (a: SplinePoint, b: SplinePoint) => Math.hypot(a.x - b.x, a.z - b.z)

/**
 * Drawing and editing paths or rivers of one kind. Pure: it never touches the editor, it returns what to preview
 * or commit. Every result is `null` when the event did nothing (so the caller can pass it on, e.g. Escape).
 */
export class SplineInput {
  private readonly kind: SplineKind
  private readonly getFeatures: () => Features
  private readonly half: number
  private readonly getStyle: () => PathStyle
  private points: SplinePoint[] | null = null
  private selected: string | null = null
  private hovered: number | null = null
  private point: number | null = null
  private hoveredArrow: Axis | null = null
  private readonly gizmo: SplineGizmo
  private drag: { index: number; moved: Features | null; axis?: { axis: Axis; start: SplinePoint; from: number } } | null = null
  private swallowClick = false

  constructor(kind: SplineKind, getFeatures: () => Features, size: number, getStyle: () => PathStyle = () => 'dirt', gizmo: SplineGizmo = DEFAULT_GIZMO) {
    this.gizmo = gizmo
    this.kind = kind
    this.getFeatures = getFeatures
    this.half = size / 2
    this.getStyle = getStyle
  }

  /** The points drawn so far, or null when not drawing. */
  get draft(): SplinePoint[] | null {
    return this.points
  }

  get selectedId(): string | null {
    return this.selectedSpline()?.id ?? null
  }

  /** The handle (point index of the selected spline) under the pointer. */
  get hoveredHandle(): number | null {
    return this.hovered
  }

  /** The selected path's selected point, which shows arrows. */
  get selectedPoint(): number | null {
    const s = this.selectedSpline()
    return s && this.point !== null && this.point < s.points.length ? this.point : null
  }

  /** The arrow of the selected point's gizmo under the pointer (the x and z axes). */
  get hoveredAxis(): Axis | null {
    return this.hoveredArrow
  }

  select(id: string | null): void {
    this.selected = id
    this.point = null
    this.hovered = null
    this.hoveredArrow = null
  }

  click(at: SplinePoint, opts: { alt: boolean }): SplineResult | null {
    if (this.swallowClick) {
      this.swallowClick = false
      return null
    }
    const p = this.clamp(at)
    if (!p) return null
    if (this.points) {
      const last = this.points[this.points.length - 1]
      if (dist(p, last) < DUPLICATE) return {}
      if (this.points.length >= FEATURE_LIMITS.maxPoints) return { message: TOO_MANY_POINTS }
      this.points.push(p)
      return {}
    }
    const sel = this.selectedSpline()
    if (opts.alt && sel) {
      const r = this.insert(sel, p)
      if (r) return r
    }
    const splines = this.getFeatures().splines
    const snapped = snapToEnd(p, splines, this.kind)
    if (snapped === p) {
      const hit = this.splineAt(p)
      if (hit) {
        this.select(hit.id)
        return {}
      }
    }
    this.select(null)
    this.points = [snapped]
    return {}
  }

  doubleClick(at: SplinePoint): SplineResult | null {
    if (!this.points) return null
    const p = this.clamp(at)
    const last = this.points[this.points.length - 1]
    if (p && dist(p, last) >= DUPLICATE && this.points.length < FEATURE_LIMITS.maxPoints) this.points.push(p)
    return this.finish()
  }

  /** Grabs an arrow of the selected point, or a handle of the selected path. `ray` is needed for the arrows. */
  pointerDown(at: SplinePoint | null, ray?: PickRay): SplineResult | null {
    const sel = this.selectedSpline()
    if (this.points || !sel) return null
    const grabbed = ray && this.arrowAt(sel, ray)
    if (grabbed) {
      const start = sel.points[grabbed.index]
      const from = axisParam(ray, this.origin(start), grabbed.axis)
      if (from !== null) {
        this.drag = { index: grabbed.index, moved: null, axis: { axis: grabbed.axis, start, from } }
        this.hoveredArrow = grabbed.axis
        return {}
      }
    }
    const p = at && this.clamp(at)
    if (!p) return null
    const index = this.handleAt(sel, p)
    if (index === null) return null
    this.drag = { index, moved: null }
    this.point = index
    this.hovered = index
    return {}
  }

  pointerMove(at: SplinePoint | null, ray?: PickRay): SplineResult | null {
    const sel = this.selectedSpline()
    if (!sel) return null
    const axis = this.drag?.axis
    if (this.drag && axis) {
      const s = ray ? axisParam(ray, this.origin(axis.start), axis.axis) : null
      if (s === null) return null
      const d = AXIS_DIR[axis.axis]
      const delta = s - axis.from
      return this.moveTo(sel, this.drag, this.clamp({ x: axis.start.x + d.x * delta, z: axis.start.z + d.z * delta }))
    }
    if (!this.drag) {
      this.hoveredArrow = this.points || !ray ? null : (this.arrowAt(sel, ray)?.axis ?? null)
      const p = at && this.clamp(at)
      this.hovered = this.points || !p ? null : this.handleAt(sel, p)
      return null
    }
    return this.moveTo(sel, this.drag, at && this.clamp(at))
  }

  pointerUp(): SplineResult | null {
    const d = this.drag
    if (!d) return null
    this.drag = null
    this.hoveredArrow = null
    this.swallowClick = true
    return d.moved ? { commit: d.moved } : {}
  }

  key(k: SplineKey): SplineResult | null {
    if (this.points) {
      if (k === 'Enter') return this.finish()
      if (k === 'Escape') {
        this.points = null
        return {}
      }
      this.points.pop()
      if (this.points.length === 0) this.points = null
      return {}
    }
    const sel = this.selectedSpline()
    if (!sel || k === 'Enter') return null
    if (k === 'Escape') {
      if (this.point !== null) this.point = null
      else this.select(null)
      return {}
    }
    const i = this.hovered
    if (i !== null && i < sel.points.length && sel.points.length > 2) {
      this.hovered = null
      return { commit: this.replace(sel.id, (s) => ({ ...s, points: s.points.filter((_, k) => k !== i) })) }
    }
    const f = this.getFeatures()
    this.select(null)
    return { commit: { ...f, splines: f.splines.filter((s) => s.id !== sel.id) } }
  }

  /** Drops the draft (and any drag); true if there was one. */
  cancel(): boolean {
    const had = this.points !== null
    this.points = null
    this.drag = null
    return had
  }

  private finish(): SplineResult {
    const pts = this.points!
    this.points = null
    if (pts.length < 2) return {}
    const f = this.getFeatures()
    if (f.splines.length >= FEATURE_LIMITS.maxSplines) return { message: TOO_MANY_SPLINES }
    const end = snapToEnd(pts[pts.length - 1], f.splines, this.kind)
    const points = [...pts.slice(0, -1), end]
    if (dist(points[points.length - 1], points[points.length - 2]) < 1e-9) points.pop()
    if (points.length < 2) return {}
    const style = this.getStyle()
    const spline: Spline = { id: crypto.randomUUID(), kind: this.kind, style, width: defaultWidth(this.kind, style), points }
    return { commit: { ...f, splines: [...f.splines, spline] } }
  }

  private insert(sel: Spline, p: SplinePoint): SplineResult | null {
    const sm = sampleSpline(sel.points)
    const near = nearestOnSamples(sm, p.x, p.z)
    if (near.distance > sel.width / 2 + 1) return null
    if (sel.points.length >= FEATURE_LIMITS.maxPoints) return { message: TOO_MANY_POINTS }
    // Every point lies on the curve: insert after the last one at or before the click along it.
    let after = 0
    for (let k = 1; k < sel.points.length - 1; k++)
      if (nearestOnSamples(sm, sel.points[k].x, sel.points[k].z).s <= near.s) after = k
    const points = [...sel.points.slice(0, after + 1), p, ...sel.points.slice(after + 1)]
    return { commit: this.replace(sel.id, (s) => ({ ...s, points })) }
  }

  /** World position of a path point's handle, where its arrows start. */
  private origin(p: SplinePoint) {
    return { x: p.x, y: this.gizmo.y(p), z: p.z }
  }

  private arrowAt(sel: Spline, ray: PickRay): { index: number; axis: Axis } | null {
    const index = this.selectedPoint
    if (index === null) return null
    const o = this.origin(sel.points[index])
    const axis = arrowHit(ray, o, this.gizmo.length(o), SPLINE_AXES)
    return axis ? { index, axis } : null
  }

  /** Previews point `drag.index` of `sel` at `p` (snapping the ends of the path to others'). */
  private moveTo(sel: Spline, drag: NonNullable<SplineInput['drag']>, p: SplinePoint | null): SplineResult | null {
    if (!p) return null
    const i = drag.index
    const isEnd = i === 0 || i === sel.points.length - 1
    const moved = isEnd ? snapToEnd(p, this.getFeatures().splines, this.kind, sel.id) : p
    const next = this.replace(sel.id, (s) => ({ ...s, points: s.points.map((q, k) => (k === i ? moved : q)) }))
    drag.moved = next
    return { preview: next }
  }

  private selectedSpline(): Spline | undefined {
    return this.selected === null ? undefined : this.getFeatures().splines.find((s) => s.id === this.selected)
  }

  /** The nearest spline of this kind within `width/2 + 1` m of `p`. */
  private splineAt(p: SplinePoint): Spline | undefined {
    let best: Spline | undefined
    let bestDistance = Infinity
    for (const s of this.getFeatures().splines) {
      if (s.kind !== this.kind) continue
      const d = nearestOnSamples(sampleSpline(s.points), p.x, p.z).distance
      if (d <= s.width / 2 + 1 && d < bestDistance) {
        best = s
        bestDistance = d
      }
    }
    return best
  }

  private handleAt(s: Spline, p: SplinePoint): number | null {
    let best: number | null = null
    let bestDistance: number = HANDLE_RADIUS
    s.points.forEach((q, k) => {
      const d = dist(p, q)
      if (d <= bestDistance) {
        best = k
        bestDistance = d
      }
    })
    return best
  }

  private replace(id: string, edit: (s: Spline) => Spline): Features {
    const f = this.getFeatures()
    return { ...f, splines: f.splines.map((s) => (s.id === id ? edit(s) : s)) }
  }

  /** The point clamped into the scene; null if it isn't finite. */
  private clamp(p: SplinePoint): SplinePoint | null {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null
    const h = this.half
    return { x: Math.min(h, Math.max(-h, p.x)), z: Math.min(h, Math.max(-h, p.z)) }
  }
}
