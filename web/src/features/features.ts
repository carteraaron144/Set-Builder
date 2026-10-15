import { z } from 'zod'
import type { SceneSize } from '../scene/scene'
import data from './features.json'

/** Tuning for paths, rivers, ponds and water: widths and margins in metres, colours as sRGB hex. */
export const FEATURES = data

export const FEATURE_LIMITS = { maxSplines: 200, maxPoints: 200, maxPonds: 50 } as const

export type PathStyle = 'dirt' | 'cobble'
export type SplineKind = 'path' | 'river'

/** A point on the ground, in world metres. */
export interface SplinePoint {
  x: number
  z: number
}

/** A path or river: a curve through its points. `style` only matters for paths. */
export interface Spline {
  id: string
  kind: SplineKind
  style: PathStyle
  width: number
  points: SplinePoint[]
}

/** A pond floods from its seed up to its level (or its spill height, if lower). */
export interface Pond {
  id: string
  seed: SplinePoint
  level: number
}

/** The drawn features of a scene. Saved as inputs; everything they generate is derived. */
export interface Features {
  splines: Spline[]
  ponds: Pond[]
}

export function emptyFeatures(): Features {
  return { splines: [], ponds: [] }
}

export function widthRange(kind: SplineKind): [number, number] {
  const k = FEATURES[kind]
  return [k.minWidth, k.maxWidth]
}

export function defaultWidth(kind: SplineKind, style: PathStyle): number {
  return kind === 'path' ? FEATURES.path.styles[style].width : FEATURES.river.width
}

export function clampWidth(kind: SplineKind, width: number): number {
  const [lo, hi] = widthRange(kind)
  return Math.min(hi, Math.max(lo, width))
}

/** Validates untrusted features for a scene size: points inside the scene, limits respected, widths clamped. */
export function featuresSchema(size: SceneSize) {
  const half = size / 2
  const coord = z.number().min(-half).max(half)
  const point = z.object({ x: coord, z: coord })
  const spline = z
    .object({
      id: z.string().min(1),
      kind: z.enum(['path', 'river']),
      style: z.enum(['dirt', 'cobble']),
      width: z.number().finite(),
      points: z.array(point).min(2).max(FEATURE_LIMITS.maxPoints),
    })
    .transform((s) => ({ ...s, width: clampWidth(s.kind, s.width) }))
  const pond = z.object({ id: z.string().min(1), seed: point, level: z.number().finite() })
  return z.object({
    splines: z.array(spline).max(FEATURE_LIMITS.maxSplines),
    ponds: z.array(pond).max(FEATURE_LIMITS.maxPonds),
  })
}

/** Approximate memory cost of a features snapshot, for the undo budget. */
export function featuresBytes(f: Features): number {
  return JSON.stringify(f).length * 2
}
