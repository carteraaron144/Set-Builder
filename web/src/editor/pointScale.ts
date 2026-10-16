import { clampWidth, type Features } from '../features/features'
import { editCavePoint } from '../tools/caveInput'
import { editSplinePoint } from '../tools/splineInput'
import type { Selection } from './editorStore'

/**
 * The features with the selected cave or spline point's radius (width, for splines) scaled by `factor`, starting
 * from its own value or its feature's; null when no point is selected.
 */
export function scaleSelectedPoint(f: Features, selection: Selection, factor: number): Features | null {
  if (selection?.kind === 'cave' && selection.point !== null) {
    const cave = f.caves.find((c) => c.id === selection.id)
    const point = cave?.points[selection.point]
    if (!cave || !point) return null
    return editCavePoint(f, cave.id, selection.point, { radius: (point.radius ?? cave.radius) * factor })
  }
  if (selection?.kind === 'spline' && selection.point !== null) {
    const spline = f.splines.find((s) => s.id === selection.id)
    const point = spline?.points[selection.point]
    if (!spline || !point) return null
    return editSplinePoint(f, spline.id, selection.point, { width: clampWidth(spline.kind, (point.width ?? spline.width) * factor) })
  }
  return null
}
