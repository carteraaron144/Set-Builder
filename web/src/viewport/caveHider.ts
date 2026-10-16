/**
 * Lets a stroke ignore the caves under it: dirty chunks are drawn as plain heightmap while the stroke lasts, and
 * the chunks that caves reach are remeshed with their caves, all at once, when it ends.
 */
export class CaveHider {
  private readonly hidden = new Set<number>()

  /**
   * Sorts this frame's dirty chunks. While `hiding`, all of them are drawn without caves (`hide`); otherwise
   * the chunks hidden earlier are due a full remesh (`flush`) and the rest go the usual way (`normal`).
   */
  split(hiding: boolean, dirty: number[], hasCave: (chunk: number) => boolean): { hide: number[]; flush: number[]; normal: number[] } {
    if (hiding) {
      for (const c of dirty) if (hasCave(c)) this.hidden.add(c)
      return { hide: dirty, flush: [], normal: [] }
    }
    const flush = Array.from(this.hidden)
    this.hidden.clear()
    const flushed = new Set(flush)
    return { hide: [], flush, normal: dirty.filter((c) => !flushed.has(c)) }
  }
}
