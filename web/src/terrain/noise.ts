/** Lattice value in [-1, 1] for integer coordinates, from an integer hash of (seed, ix, iz). */
function lattice(seed: number, ix: number, iz: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ ix, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 13) ^ iz, 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x165667b1)
  h ^= h >>> 16
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

const fade = (t: number) => t * t * (3 - 2 * t)

function octave(seed: number, x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = fade(x - ix)
  const fz = fade(z - iz)
  const top = lattice(seed, ix, iz) * (1 - fx) + lattice(seed, ix + 1, iz) * fx
  const bottom = lattice(seed, ix, iz + 1) * (1 - fx) + lattice(seed, ix + 1, iz + 1) * fx
  return top * (1 - fz) + bottom * fz
}

/** Seeded 2-octave value noise in [-1, 1]: 8 m features plus 4 m features at half amplitude. */
export function valueNoise2(seed: number, x: number, z: number): number {
  return (octave(seed, x / 8, z / 8) + 0.5 * octave(seed + 1013, x / 4, z / 4)) / 1.5
}
