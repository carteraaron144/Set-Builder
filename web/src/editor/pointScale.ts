import type { Features } from '../features/features'
import { scaleHandle, type HandleRef } from '../tools/handles'
import type { Selection } from './editorStore'

/**
 * The features with the selected point's radius (width, for splines) scaled by `factor`, starting from its own
 * value or its feature's; null when no point with a size is selected.
 */
export function scaleSelectedPoint(f: Features, selection: Selection, factor: number): Features | null {
  if (!selection || (selection.kind !== 'pond' && selection.point === null)) return null
  return scaleHandle(f, selection as HandleRef, factor)
}
