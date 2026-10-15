import { z } from 'zod'

export type PaletteSlot = 'bark' | 'leaf' | 'pine' | 'stone' | 'grass' | 'reed'
export const PALETTE_SLOTS: readonly PaletteSlot[] = ['bark', 'leaf', 'pine', 'stone', 'grass', 'reed']
export type AssetKind = 'tree' | 'rock' | 'bush' | 'grass' | 'plant' | 'cliff'
export type Collision = 'none' | { box: [number, number, number] } | { cylinder: [number, number] }

export interface PackAsset {
  id: string
  file: string
  kind: AssetKind
  /** Radius in metres that later blocking rules keep clear of. */
  footprint: number
  collision: Collision
  /** Cliff pieces: the allowed scaled length in metres (models are 1 m long along +Y). */
  lengthRange?: [number, number]
}

export interface PackManifest {
  name: string
  version: string
  source: string
  licence: string
  assets: PackAsset[]
}

const positive = z.number().positive()
const nonBlank = z.string().trim().min(1)

const assetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  file: z
    .string()
    .min(1)
    .refine((f) => !f.startsWith('/') && !f.split('/').includes('..'), 'file must stay inside the pack'),
  kind: z.enum(['tree', 'rock', 'bush', 'grass', 'plant', 'cliff']),
  footprint: z.number().min(0),
  collision: z.union([
    z.literal('none'),
    z.object({ box: z.tuple([positive, positive, positive]) }),
    z.object({ cylinder: z.tuple([positive, positive]) }),
  ]),
  lengthRange: z.tuple([positive, positive]).optional(),
})

const manifestSchema = z.object({
  name: nonBlank,
  version: nonBlank,
  source: nonBlank,
  licence: nonBlank,
  assets: z.array(assetSchema),
})

/** Validates pack.json; throws an Error naming the problem. */
export function parsePackManifest(data: unknown): PackManifest {
  const result = manifestSchema.safeParse(data)
  if (!result.success) throw new Error(`Invalid pack.json: ${result.error.message}`)
  return result.data as PackManifest
}
