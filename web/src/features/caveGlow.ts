import { chunkCount } from '../terrain/chunks'
import { HEIGHT_SPACING, type Heightmap } from '../terrain/layers'
import { meshSdfChunk } from '../terrain/sdfChunk'
import type { SceneSize } from '../scene/scene'
import { cavesReaching, profileCave, type CaveProfile } from './caves'
import { FEATURES, type CavePoint } from './features'

export interface GlowMesh {
  chunk: number
  positions: Float32Array
  indices: Uint32Array
}

/** The caves alone, meshed inside chunk `chunk` (for a see-through glow); null if none of `caves` reaches it. */
export function caveGlowChunk(caves: CaveProfile[], chunk: number, size: SceneSize): { positions: Float32Array; indices: Uint32Array } | null {
  const reaching = cavesReaching(caves, chunk, size)
  if (reaching.length === 0) return null
  const half = size / 2
  const y0 = Math.min(...reaching.map((c) => c.bounds.y0))
  const y1 = Math.max(...reaching.map((c) => c.bounds.y1))
  const inside = (i: number, j: number, y: number) => {
    let d = Infinity
    for (const c of reaching) d = Math.min(d, c.sdf(-half + i * HEIGHT_SPACING, y, -half + j * HEIGHT_SPACING))
    // Capped so far-off samples don't skew the interpolation on edges that cross the surface.
    return -Math.min(d, 50)
  }
  const { positions, indices } = meshSdfChunk(size, chunk, inside, y0 - 1, y1 + 1)
  return indices.length > 0 ? { positions, indices } : null
}

/** The glow of a cave being drawn: a tunnel of the default radius through the points dropped so far. */
export function draftCaveGlow(heights: Heightmap, points: CavePoint[]): GlowMesh[] {
  if (points.length === 0) return []
  const profile = profileCave(heights, { id: 'draft', radius: FEATURES.cave.radius.default, points })
  const n = chunkCount(heights.size)
  const out: GlowMesh[] = []
  for (let chunk = 0; chunk < n * n; chunk++) {
    const glow = caveGlowChunk([profile], chunk, heights.size)
    if (glow) out.push({ chunk, ...glow })
  }
  return out
}


/** The draft plus the point under the pointer (at the last point's depth, no chamber) as its next point; nothing without a draft. */
export function draftGlowPoints(draft: CavePoint[], hover: { x: number; z: number } | null): CavePoint[] {
  const last = draft[draft.length - 1]
  return last && hover ? [...draft, { x: hover.x, y: last.y, z: hover.z, chamber: 0 }] : draft
}

/** Lets a rebuild through only when its key changed and `interval` ms have passed since the last one let through. */
export class GlowThrottle {
  private readonly interval: number
  private key: string | null = null
  private at = -Infinity

  constructor(interval: number) {
    this.interval = interval
  }

  due(key: string, now: number): boolean {
    if (key === this.key || now - this.at < this.interval) return false
    this.key = key
    this.at = now
    return true
  }
}

/** Identifies a draft's shape, to a tenth of a metre, so tiny pointer moves don't rebuild the glow. */
export const glowKey = (points: CavePoint[]): string => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)},${p.chamber}`).join(';')
