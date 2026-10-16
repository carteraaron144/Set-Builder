import { clampWidth, type Features } from '../features/features'
import { snapToEnd } from '../features/spline'
import type { Axis } from './axisGizmo'
import { clampY, editCavePoint } from './caveInput'
import { editSplinePoint } from './splineInput'

interface Vec {
  x: number
  y: number
  z: number
}

/** One draggable point of a feature: a path or river point, a cave point or a pond's seed. */
export type HandleRef = { kind: 'spline' | 'cave'; id: string; point: number } | { kind: 'pond'; id: string; point?: null }

export interface Handle {
  ref: HandleRef
  /** World position of the handle: ground height for paths, rivers and ponds, its own depth for caves. */
  position: Vec
}

export const sameHandle = (a: HandleRef | null, b: HandleRef | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id && (a.point ?? null) === (b.point ?? null))

/** Every handle of every feature, in drawing order. */
export function listHandles(f: Features, groundY: (x: number, z: number) => number): Handle[] {
  const out: Handle[] = []
  for (const s of f.splines)
    s.points.forEach((p, point) => out.push({ ref: { kind: 'spline', id: s.id, point }, position: { x: p.x, y: groundY(p.x, p.z), z: p.z } }))
  for (const c of f.caves) c.points.forEach((p, point) => out.push({ ref: { kind: 'cave', id: c.id, point }, position: { x: p.x, y: p.y, z: p.z } }))
  for (const p of f.ponds) out.push({ ref: { kind: 'pond', id: p.id }, position: { x: p.seed.x, y: groundY(p.seed.x, p.seed.z), z: p.seed.z } })
  return out
}

/** The axes a handle can move along. */
export function handleAxes(ref: HandleRef): readonly Axis[] {
  return ref.kind === 'cave' ? ['x', 'y', 'z'] : ['x', 'z']
}

/** The features with the handle moved to `to` (clamped into the scene of half-size `half`); `f` itself if it can't be. */
export function moveHandle(f: Features, ref: HandleRef, to: Vec, half: number): Features {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || !Number.isFinite(to.z)) return f
  const x = Math.min(half, Math.max(-half, to.x))
  const z = Math.min(half, Math.max(-half, to.z))
  if (ref.kind === 'cave') return editCavePoint(f, ref.id, ref.point, { x, y: clampY(to.y), z })
  if (ref.kind === 'pond') {
    if (!f.ponds.some((p) => p.id === ref.id)) return f
    return { ...f, ponds: f.ponds.map((p) => (p.id === ref.id ? { ...p, seed: { x, z } } : p)) }
  }
  const s = f.splines.find((q) => q.id === ref.id)
  if (!s || ref.point < 0 || ref.point >= s.points.length) return f
  const isEnd = ref.point === 0 || ref.point === s.points.length - 1
  const at = isEnd ? snapToEnd({ x, z }, f.splines, s.kind, s.id) : { x, z }
  return editSplinePoint(f, s.id, ref.point, at)
}

type Owner = { id: string; points: unknown[] }

/** The features without the handle's point; a path, river or cave left with under two points goes entirely. */
export function removeHandle(f: Features, ref: HandleRef): Features {
  if (ref.kind === 'pond') return { ...f, ponds: f.ponds.filter((p) => p.id !== ref.id) }
  const key = ref.kind === 'cave' ? 'caves' : 'splines'
  const owners: Owner[] = f[key]
  const owner = owners.find((o) => o.id === ref.id)
  if (!owner || ref.point < 0 || ref.point >= owner.points.length) return f
  const next = owners
    .map((o) => (o.id === ref.id ? { ...o, points: o.points.filter((_, k) => k !== ref.point) } : o))
    .filter((o) => o.points.length >= 2)
  return { ...f, [key]: next }
}

/** The features with the handle's radius (width, for paths and rivers) scaled by `factor`; null if it has none. */
export function scaleHandle(f: Features, ref: HandleRef, factor: number): Features | null {
  if (ref.kind === 'cave') {
    const cave = f.caves.find((c) => c.id === ref.id)
    const point = cave?.points[ref.point]
    return cave && point ? editCavePoint(f, cave.id, ref.point, { radius: (point.radius ?? cave.radius) * factor }) : null
  }
  if (ref.kind === 'spline') {
    const spline = f.splines.find((s) => s.id === ref.id)
    const point = spline?.points[ref.point]
    return spline && point
      ? editSplinePoint(f, spline.id, ref.point, { width: clampWidth(spline.kind, (point.width ?? spline.width) * factor) })
      : null
  }
  return null
}
