/**
 * Spaces out the expensive remeshes of density-field chunks: chunks queued while a wait is on are held and
 * released together once it ends, so a dragged brush remeshes a few times a second instead of every frame.
 * A `minInterval` of 0 turns the wait off. Otherwise it is at least `minInterval` ms, or `costFactor` times the last remesh's duration if that is longer.
 */
export class RemeshThrottle {
  private readonly pending = new Set<number>()
  private readyAt = 0

  constructor(
    public minInterval: number,
    private readonly costFactor = 2,
  ) {}

  add(chunks: Iterable<number>): void {
    for (const c of chunks) this.pending.add(c)
  }

  /** The queued chunks to remesh now, or none while the wait is on. */
  take(now: number): number[] {
    if (this.pending.size === 0 || now < this.readyAt) return []
    const out = Array.from(this.pending)
    this.pending.clear()
    return out
  }

  /** Call after remeshing what `take` returned: `end` is the time it finished and `cost` how long it took. */
  finished(end: number, cost: number): void {
    this.readyAt = this.minInterval === 0 ? end : end + Math.max(this.minInterval, cost * this.costFactor)
  }
}
