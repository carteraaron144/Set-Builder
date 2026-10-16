import { FEATURE_LIMITS, type Features, type Pond, type SplinePoint } from '../features/features'
import { sampleIndex, type PondFill } from '../features/ponds'
import { heightAt, type Heightmap } from '../terrain/layers'
import { HANDLE_RADIUS, type SplineKey, type SplineResult } from './splineInput'

/** Metres of level per pixel of vertical drag (up raises). */
export const LEVEL_PER_PIXEL = 0.05
/** A pond's level stays within this of the ground at its seed; metres. */
export const LEVEL_RANGE = 10
const TOO_MANY_PONDS = `A scene can have at most ${FEATURE_LIMITS.maxPonds} ponds.`

/** The level range a pond can take: the ground height at its seed ± `LEVEL_RANGE`. */
export function levelRange(heights: Heightmap, pond: Pond): [number, number] {
  const base = heightAt(heights, pond.seed.x, pond.seed.z)
  return [base - LEVEL_RANGE, base + LEVEL_RANGE]
}

/**
 * Making and editing ponds with the Water tool. Pure, like `SplineInput`: a press on a pond's water or seed
 * selects it, a press elsewhere makes one, and a vertical drag after either sets its level.
 */
export class PondInput {
  private readonly getFeatures: () => Features
  private readonly getHeights: () => Heightmap
  private readonly getFills: () => PondFill[]
  private readonly half: number
  private selected: string | null = null
  private drag: { id: string; startY: number; startLevel: number; created: Features | null; moved: Features | null } | null =
    null

  constructor(getFeatures: () => Features, getHeights: () => Heightmap, getFills: () => PondFill[], size: number) {
    this.getFeatures = getFeatures
    this.getHeights = getHeights
    this.getFills = getFills
    this.half = size / 2
  }

  get selectedId(): string | null {
    return this.selected !== null && this.getFeatures().ponds.some((p) => p.id === this.selected) ? this.selected : null
  }

  select(id: string | null): void {
    this.selected = id
  }

  pointerDown(at: SplinePoint, screenY: number): SplineResult | null {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.z) || !Number.isFinite(screenY)) return null
    const h = this.half
    const p = { x: Math.min(h, Math.max(-h, at.x)), z: Math.min(h, Math.max(-h, at.z)) }
    const f = this.getFeatures()
    const hit = this.pondAt(p)
    if (hit) {
      this.select(hit.id)
      this.drag = { id: hit.id, startY: screenY, startLevel: hit.level, created: null, moved: null }
      return {}
    }
    if (f.ponds.length >= FEATURE_LIMITS.maxPonds) return { message: TOO_MANY_PONDS }
    const pond: Pond = { id: crypto.randomUUID(), seed: p, level: heightAt(this.getHeights(), p.x, p.z) + 1 }
    const created = { ...f, ponds: [...f.ponds, pond] }
    this.select(pond.id)
    this.drag = { id: pond.id, startY: screenY, startLevel: pond.level, created, moved: null }
    return { preview: created }
  }

  pointerMove(screenY: number): SplineResult | null {
    const d = this.drag
    if (!d || !Number.isFinite(screenY)) return null
    const f = this.getFeatures()
    const pond = f.ponds.find((p) => p.id === d.id)
    if (!pond) return null
    const [lo, hi] = levelRange(this.getHeights(), pond)
    const level = Math.min(hi, Math.max(lo, d.startLevel + (d.startY - screenY) * LEVEL_PER_PIXEL))
    d.moved = { ...f, ponds: f.ponds.map((p) => (p.id === d.id ? { ...p, level } : p)) }
    return { preview: d.moved }
  }

  pointerUp(): SplineResult | null {
    const d = this.drag
    if (!d) return null
    this.drag = null
    const commit = d.moved ?? d.created
    return commit ? { commit } : {}
  }

  key(k: SplineKey): SplineResult | null {
    const id = this.selectedId
    if (!id || k === 'Enter') return null
    this.select(null)
    if (k === 'Escape') return {}
    const f = this.getFeatures()
    return { commit: { ...f, ponds: f.ponds.filter((p) => p.id !== id) } }
  }

  /** Ponds have no draft to drop; always false. */
  cancel(): boolean {
    return false
  }

  /** The topmost pond whose water covers `p` or whose seed handle is under it. */
  private pondAt(p: SplinePoint): Pond | undefined {
    const ponds = this.getFeatures().ponds
    const fills = this.getFills()
    const i = sampleIndex(this.getHeights(), p)
    for (let k = ponds.length - 1; k >= 0; k--) {
      const q = ponds[k]
      if (fills[k]?.mask[i] || Math.hypot(p.x - q.seed.x, p.z - q.seed.z) <= HANDLE_RADIUS) return q
    }
    return undefined
  }
}
