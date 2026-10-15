import data from './biomes.json'
import { BIOME_IDS } from './layers'

export type RGB = [number, number, number]

/** Linear-RGB terrain colours; slopes in radians. */
export interface TerrainPalette {
  biomes: [RGB, RGB, RGB, RGB]
  rock: RGB
  slopeStart: number
  slopeFull: number
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** '#rrggbb' (sRGB) to linear RGB, which is what three expects in vertex colours. */
export function hexToLinear(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)]
}

export function paletteFrom(json: typeof data): TerrainPalette {
  const deg = Math.PI / 180
  return {
    biomes: BIOME_IDS.map((id) => hexToLinear(json.biomes[id])) as TerrainPalette['biomes'],
    rock: hexToLinear(json.rock.color),
    slopeStart: json.rock.slopeStartDeg * deg,
    slopeFull: json.rock.slopeFullDeg * deg,
  }
}

export const DEFAULT_PALETTE: TerrainPalette = paletteFrom(data)

/** sRGB hex colours for UI swatches. */
export const BIOME_SWATCHES: Readonly<Record<string, string>> = data.biomes
