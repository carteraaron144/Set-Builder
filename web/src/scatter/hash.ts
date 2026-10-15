function mix(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}

/** Integer hash of (seed, a, b, c, salt) as a uint32. Arguments are truncated to 32-bit integers. */
export function hash4(seed: number, a: number, b: number, c: number, salt: number): number {
  let h = mix((seed ^ Math.imul(salt | 0, 0x27d4eb2d)) >>> 0)
  h = mix(h ^ Math.imul(a | 0, 0x85ebca6b))
  h = mix(h ^ Math.imul(b | 0, 0xc2b2ae35))
  h = mix(h ^ Math.imul(c | 0, 0x165667b1))
  return h
}

/** A uint32 hash as a number in [0, 1). */
export const unit = (h: number) => h / 4294967296
