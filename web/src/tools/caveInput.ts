import {
  clampCaveRadius,
  clampChamber,
  FEATURE_LIMITS,
  FEATURES,
  type Cave,
  type CavePoint,
  type Features,
} from '../features/features'
import { MAX_HEIGHT, MIN_HEIGHT } from '../terrain/layers'
import { arrowHit, AXIS_DIR, axisParam, type Axis } from './axisGizmo'
import { HANDLE_RADIUS, type SplineKey, type SplineResult } from './splineInput'

interface Vec {
  x: number
  y: number
  z: number
}

/** A pick ray in world space; `dir` need not be normalised. */
export interface Ray {
  origin: Vec
  dir: Vec
}

/** Draft clicks this close to the previous point (a double-click's second click) are ignored; metres. */
const DUPLICATE = 0.5
const TOO_MANY_POINTS = `A cave can have at most ${FEATURE_LIMITS.maxCavePoints} points.`
const TOO_MANY_CAVES = `A scene can have at most ${FEATURE_LIMITS.maxCaves} caves.`

const clampY = (y: number) => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, y))

/** Distance from `p` to the ray (to its origin for points behind it). */
function rayDistance(r: Ray, p: Vec): number {
  const len = Math.hypot(r.dir.x, r.dir.y, r.dir.z)
  if (len === 0) return Infinity
  const dx = p.x - r.origin.x
  const dy = p.y - r.origin.y
  const dz = p.z - r.origin.z
  const t = Math.max(0, (dx * r.dir.x + dy * r.dir.y + dz * r.dir.z) / len)
  return Math.hypot(dx - (r.dir.x / len) * t, dy - (r.dir.y / len) * t, dz - (r.dir.z / len) * t)
}

/** Edits cave `id`, clamping its radius; `f` itself if there's no such cave. */
export function editCave(f: Features, id: string, change: Partial<Pick<Cave, 'radius'>>): Features {
  if (!f.caves.some((c) => c.id === id)) return f
  return {
    ...f,
    caves: f.caves.map((c) => (c.id === id ? { ...c, ...change, radius: clampCaveRadius(change.radius ?? c.radius) } : c)),
  }
}

/** Edits point `index` of cave `id`, clamping its height and chamber; `f` itself if there's no such point. */
export function editCavePoint(f: Features, id: string, index: number, change: Partial<CavePoint>): Features {
  const cave = f.caves.find((c) => c.id === id)
  if (!cave || index < 0 || index >= cave.points.length) return f
  const edit = (p: CavePoint): CavePoint => {
    const q = { ...p, ...change }
    return { ...q, y: clampY(q.y), chamber: clampChamber(q.chamber) }
  }
  return { ...f, caves: f.caves.map((c) => (c.id === id ? { ...c, points: c.points.map((p, k) => (k === index ? edit(p) : p)) } : c)) }
}

/**
 * Drawing and editing caves with the Cave tool. Pure, like `SplineInput`. The first click sets the entrance at
 * the ground hit; later clicks add points at their hit's x, z and the previous point's height. Points are
 * picked by ray (they lie underground) and drag in x, z at their own height.
 */
export class CaveInput {
  private readonly getFeatures: () => Features
  private readonly half: number
  private readonly gizmoLength: (at: Vec) => number
  private points: CavePoint[] | null = null
  private selected: string | null = null
  private point: number | null = null
  private hovered: number | null = null
  private hoveredArrow: Axis | null = null
  private drag: { index: number; y: number; moved: Features | null; axis?: { axis: Axis; start: Vec; from: number } } | null = null
  private swallowClick = false

  /** `gizmoLength` is the arrow length at a point, which the viewport scales with the camera distance. */
  constructor(getFeatures: () => Features, size: number, gizmoLength: (at: Vec) => number = () => 4) {
    this.getFeatures = getFeatures
    this.half = size / 2
    this.gizmoLength = gizmoLength
  }

  /** The arrow of the selected point's gizmo under the pointer. */
  get hoveredAxis(): Axis | null {
    return this.hoveredArrow
  }

  get draft(): CavePoint[] | null {
    return this.points
  }

  get selectedId(): string | null {
    return this.selectedCave()?.id ?? null
  }

  /** The selected cave's selected point index, for the panel. */
  get selectedPoint(): number | null {
    const c = this.selectedCave()
    return c && this.point !== null && this.point < c.points.length ? this.point : null
  }

  get hoveredHandle(): number | null {
    return this.hovered
  }

  select(id: string | null, point: number | null = null): void {
    this.selected = id
    this.point = id === null ? null : point
    this.hovered = null
    this.hoveredArrow = null
  }

  click(hit: Vec | null, ray: Ray): SplineResult | null {
    if (this.swallowClick) {
      this.swallowClick = false
      return null
    }
    if (this.points) {
      const p = hit && this.clamp(hit)
      if (!p) return null
      const last = this.points[this.points.length - 1]
      if (Math.hypot(p.x - last.x, p.z - last.z) < DUPLICATE) return {}
      if (this.points.length >= FEATURE_LIMITS.maxCavePoints) return { message: TOO_MANY_POINTS }
      this.points.push({ ...p, y: last.y })
      return {}
    }
    const handle = this.anyHandleAt(ray)
    if (handle) {
      this.select(handle.id, handle.index)
      return {}
    }
    const p = hit && this.clamp(hit)
    if (!p) return null
    this.select(null)
    this.points = [p]
    return {}
  }

  doubleClick(hit: Vec | null, ray: Ray): SplineResult | null {
    if (!this.points) return null
    if (this.points.length < FEATURE_LIMITS.maxCavePoints) this.click(hit, ray)
    return this.finish()
  }

  /** Grabs a handle of the selected cave under the ray. */
  pointerDown(ray: Ray): SplineResult | null {
    const c = this.selectedCave()
    if (this.points || !c) return null
    const grabbed = this.arrowAt(c, ray)
    if (grabbed) {
      const start = c.points[grabbed.index]
      const from = axisParam(ray, start, grabbed.axis)
      if (from !== null) {
        this.drag = { index: grabbed.index, y: start.y, moved: null, axis: { axis: grabbed.axis, start: { x: start.x, y: start.y, z: start.z }, from } }
        this.hoveredArrow = grabbed.axis
        return {}
      }
    }
    const index = this.handleAt(c, ray)
    if (index === null) return null
    this.drag = { index, y: c.points[index].y, moved: null }
    this.point = index
    this.hovered = index
    return {}
  }

  /** Mid-drag, moves the point to where the ray crosses its height; otherwise updates the hovered handle. */
  pointerMove(ray: Ray): SplineResult | null {
    const c = this.selectedCave()
    if (!c) return null
    const d = this.drag
    if (!d) {
      this.hovered = this.points ? null : this.handleAt(c, ray)
      this.hoveredArrow = this.points ? null : (this.arrowAt(c, ray)?.axis ?? null)
      return null
    }
    if (d.axis) return this.dragAlongAxis(c, d, d.axis, ray)
    if (Math.abs(ray.dir.y) < 1e-6) return null
    const t = (d.y - ray.origin.y) / ray.dir.y
    if (t <= 0) return null
    const p = this.clamp({ x: ray.origin.x + ray.dir.x * t, y: d.y, z: ray.origin.z + ray.dir.z * t })
    if (!p) return null
    const f = this.getFeatures()
    d.moved = {
      ...f,
      caves: f.caves.map((q) => (q.id === c.id ? { ...q, points: q.points.map((o, k) => (k === d.index ? { ...o, x: p.x, z: p.z } : o)) } : q)),
    }
    return { preview: d.moved }
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
    const c = this.selectedCave()
    if (!c || k === 'Enter') return null
    if (k === 'Escape') {
      this.select(null)
      return {}
    }
    const f = this.getFeatures()
    const i = this.hovered
    if (i !== null && i < c.points.length && c.points.length > 2) {
      this.hovered = null
      this.point = null
      const points = c.points.filter((_, k) => k !== i)
      return { commit: { ...f, caves: f.caves.map((q) => (q.id === c.id ? { ...q, points } : q)) } }
    }
    this.select(null)
    return { commit: { ...f, caves: f.caves.filter((q) => q.id !== c.id) } }
  }

  /** Drops the draft (and any drag); true if there was one. */
  cancel(): boolean {
    const had = this.points !== null
    this.points = null
    this.drag = null
    return had
  }

  private finish(): SplineResult {
    const points = this.points!
    this.points = null
    if (points.length < 2) return {}
    const f = this.getFeatures()
    if (f.caves.length >= FEATURE_LIMITS.maxCaves) return { message: TOO_MANY_CAVES }
    const cave: Cave = { id: crypto.randomUUID(), radius: FEATURES.cave.radius.default, points }
    this.select(cave.id)
    return { commit: { ...f, caves: [...f.caves, cave] } }
  }

  /** The arrow of the selected point's gizmo under the ray. */
  private arrowAt(c: Cave, ray: Ray): { index: number; axis: Axis } | null {
    const index = this.selectedPoint
    if (index === null) return null
    const p = c.points[index]
    const axis = arrowHit(ray, p, this.gizmoLength(p), ['x', 'y', 'z'])
    return axis ? { index, axis } : null
  }

  /** Mid-drag on an arrow: the point moves by how far the pointer has travelled along that axis. */
  private dragAlongAxis(c: Cave, d: NonNullable<CaveInput['drag']>, a: { axis: Axis; start: Vec; from: number }, ray: Ray): SplineResult | null {
    const s = axisParam(ray, a.start, a.axis)
    if (s === null) return null
    const dir = AXIS_DIR[a.axis]
    const delta = s - a.from
    const p = this.clamp({ x: a.start.x + dir.x * delta, y: a.start.y + dir.y * delta, z: a.start.z + dir.z * delta })
    if (!p) return null
    const f = this.getFeatures()
    d.moved = {
      ...f,
      caves: f.caves.map((q) => (q.id === c.id ? { ...q, points: q.points.map((o, k) => (k === d.index ? { ...o, x: p.x, y: p.y, z: p.z } : o)) } : q)),
    }
    return { preview: d.moved }
  }

  private selectedCave(): Cave | undefined {
    return this.selected === null ? undefined : this.getFeatures().caves.find((c) => c.id === this.selected)
  }

  private handleAt(c: Cave, ray: Ray): number | null {
    let best: number | null = null
    let bestDistance: number = HANDLE_RADIUS
    c.points.forEach((p, k) => {
      const d = rayDistance(ray, p)
      if (d <= bestDistance) {
        best = k
        bestDistance = d
      }
    })
    return best
  }

  /** The nearest point of any cave to the ray, within the handle radius; the selected cave wins ties. */
  private anyHandleAt(ray: Ray): { id: string; index: number } | null {
    const sel = this.selectedCave()
    if (sel) {
      const index = this.handleAt(sel, ray)
      if (index !== null) return { id: sel.id, index }
    }
    let best: { id: string; index: number } | null = null
    let bestDistance: number = HANDLE_RADIUS
    for (const c of this.getFeatures().caves)
      c.points.forEach((p, index) => {
        const d = rayDistance(ray, p)
        if (d <= bestDistance) {
          best = { id: c.id, index }
          bestDistance = d
        }
      })
    return best
  }

  /** The point clamped into the scene, as a tunnel point; null if it isn't finite. */
  private clamp(p: Vec): CavePoint | null {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null
    const h = this.half
    return { x: Math.min(h, Math.max(-h, p.x)), y: clampY(p.y), z: Math.min(h, Math.max(-h, p.z)), chamber: 0 }
  }
}
