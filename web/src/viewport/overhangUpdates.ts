/**
 * Chunks whose grass overhangs need building this frame: none while they are off, every chunk the frame they are
 * switched on (they were not kept up to date while off), and otherwise the chunks that changed.
 */
export function overhangsToBuild(on: boolean, wasOn: boolean, dirty: readonly number[], chunkCount: number): number[] {
  if (!on) return []
  if (!wasOn) return Array.from({ length: chunkCount }, (_, i) => i)
  return [...dirty]
}
