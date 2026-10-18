import { z } from 'zod'
import { PALETTE_SLOTS, type PaletteSlot } from '../assets/packManifest'
import type { BiomeId } from '../terrain/layers'
import materials from './materials.json'
import rulesV2 from './rules.json'

export interface ScatterRule {
  /** "<packId>/<assetId>" */
  asset: string
  placement: 'ground' | 'face'
  /** Face rules use 'any': cliffs aren't a biome. */
  biome: BiomeId | 'any'
  /** Instances per m² at full biome weight. */
  density: number
  minSpacing: number
  scale: [number, number]
  maxTiltDeg: number
  maxSlopeDeg: number
  minHeight: number
  maxHeight: number
  /** Later ground rules keep clear of this rule's footprints. */
  blocking: boolean
  castShadow: boolean
  minSlopeDeg?: number
  minWallHeight?: number
  sinkDepth?: number
}

/** Rule order is priority order: face rules first, then trees, rocks, bushes, grass. */
export interface ScatterRules {
  maxInstances: number
  rules: ScatterRule[]
}

const range = z.tuple([z.number().positive(), z.number().positive()]).refine(([a, b]) => a <= b, 'scale min > max')

const ruleSchema = z
  .object({
    asset: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
    placement: z.enum(['ground', 'face']),
    biome: z.enum(['meadow', 'forest', 'rocky', 'swamp', 'any']),
    density: z.number().min(0),
    minSpacing: z.number().positive(),
    scale: range,
    maxTiltDeg: z.number().min(0).max(90),
    maxSlopeDeg: z.number().min(0).max(90),
    minHeight: z.number(),
    maxHeight: z.number(),
    blocking: z.boolean(),
    castShadow: z.boolean(),
    minSlopeDeg: z.number().min(0).max(90).optional(),
    minWallHeight: z.number().positive().optional(),
    sinkDepth: z.number().min(0).optional(),
  })
  .refine(
    (r) => r.placement === 'ground' || (r.minSlopeDeg !== undefined && r.minWallHeight !== undefined && r.sinkDepth !== undefined),
    'face rules need minSlopeDeg, minWallHeight and sinkDepth',
  )

const rulesSchema = z
  .object({ maxInstances: z.number().int().positive(), rules: z.array(ruleSchema) })
  .refine(({ rules }) => {
    const faceMin = Math.min(...rules.filter((r) => r.placement === 'face').map((r) => r.minSlopeDeg!))
    return rules.every((r) => r.placement === 'face' || r.maxSlopeDeg <= faceMin)
  }, 'a ground rule reaches slopes that face rules cover')

export function parseRules(data: unknown): ScatterRules {
  const result = rulesSchema.safeParse(data)
  if (!result.success) throw new Error(`Invalid scatter rules: ${result.error.message}`)
  return result.data as ScatterRules
}

const BY_GENERATOR: Record<number, unknown> = { 2: rulesV2, 3: rulesV2, 4: rulesV2, 5: rulesV2 }

/** The rules a generator version was made with, so rule changes never silently alter saved scenes. */
export function rulesFor(generatorVersion: number): ScatterRules {
  const data = BY_GENERATOR[generatorVersion]
  if (!data) throw new Error(`No scatter rules for generator version ${generatorVersion}`)
  return parseRules(data)
}

/** sRGB hex colour per palette slot. */
export const MATERIAL_PALETTE: Record<PaletteSlot, string> = Object.fromEntries(
  PALETTE_SLOTS.map((s) => [s, (materials as Record<string, string>)[s]]),
) as Record<PaletteSlot, string>
