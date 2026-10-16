import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Color, Matrix4, MeshBasicMaterial, Raycaster, Vector2, Vector3 } from 'three'
import { useEditorStore, type Selection } from '../editor/editorStore'
import { heightAt } from '../terrain/layers'
import type { Scene } from '../scene/scene'
import type { TerrainEditor } from '../terrain/terrainEditor'
import { gizmoLength } from '../tools/axisGizmo'
import type { Ray } from '../tools/caveInput'
import { handleAxes, sameHandle, type HandleRef } from '../tools/handles'
import { SelectInput } from '../tools/selectInput'
import type { SplineResult } from '../tools/splineInput'
import { AXES, AXIS_COLORS, createGizmo, createHandles, HOVERED, LIFT } from './FeatureRig'

const SPLINE_COLOR = new Color('#ffffff')
const CAVE_COLOR = new Color('#ffb36b')
const POND_COLOR = new Color('#7fd0ff')
const MAX_HANDLES = 400

const refOf = (s: Selection): HandleRef | null => (s === null ? null : s.kind === 'pond' ? { kind: 'pond', id: s.id } : s.point === null ? null : { kind: s.kind, id: s.id, point: s.point })
const selectionOf = (r: HandleRef | null): Selection => (r === null ? null : r.kind === 'pond' ? { kind: 'pond', id: r.id } : { kind: r.kind, id: r.id, point: r.point })

/**
 * The Select tool in the viewport: draws every handle of every path, river, cave and pond, and feeds pointer events
 * to a `SelectInput`, which picks, drags and deletes any of them. The selection is shared with the editor store.
 */
export function SelectRig({ terrain, scene }: { terrain: TerrainEditor; scene: Scene }) {
  const camera = useThree((s) => s.camera)
  const element = useThree((s) => s.gl.domElement) as HTMLCanvasElement
  const active = useEditorStore((s) => s.tool) === 'select'
  const [handles] = useState(createHandles)
  const [gizmo] = useState(createGizmo)
  const inputRef = useRef<SelectInput | null>(null)
  const pendingRay = useRef<Ray | null>(null)
  const changed = useRef(true)

  useEffect(
    () => () => {
      handles.geometry.dispose()
      ;(handles.material as MeshBasicMaterial).dispose()
      gizmo.group.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose())
      Object.values(gizmo.materials).forEach((m) => m.dispose())
    },
    [handles, gizmo],
  )

  useEffect(() => {
    changed.current = true
    if (!active) return
    const store = useEditorStore
    const reach = new Vector3()
    const input = new SelectInput(
      () => terrain.features,
      (x, z) => heightAt(terrain.ground.layers.heights, x, z) + LIFT,
      scene.size,
      (at) => gizmoLength(camera.position.distanceTo(reach.set(at.x, at.y, at.z))),
    )
    input.select(refOf(store.getState().selection))
    inputRef.current = input
    let dragging = false

    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const cast = (e: MouseEvent): Ray | null => {
      const r = element.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return { origin: raycaster.ray.origin.clone(), dir: raycaster.ray.direction.clone() }
    }
    const syncSelection = () => {
      const want = selectionOf(input.selected)
      const cur = store.getState().selection
      const same = want === null ? cur === null : cur !== null && sameHandle(refOf(cur), input.selected)
      if (!same) store.getState().setSelection(want)
    }
    const apply = (r: SplineResult | null) => {
      changed.current = true
      if (!r) return r
      if (r.preview) terrain.previewFeatures(r.preview)
      if (r.commit) terrain.commitFeatures(r.commit)
      syncSelection()
      return r
    }
    const flush = () => {
      const ray = pendingRay.current
      pendingRay.current = null
      if (ray) apply(input.pointerMove(ray))
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const ray = cast(e)
      if (!ray) return
      if (!apply(input.pointerDown(ray))) return
      dragging = true
      try {
        element.setPointerCapture?.(e.pointerId)
      } catch {
        // Best-effort; window listeners still see the drag.
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (dragging) {
        pendingRay.current = cast(e) ?? pendingRay.current
        return
      }
      if (e.target !== element) return
      const ray = cast(e)
      if (!ray) return
      input.pointerMove(ray)
      changed.current = true
      element.style.cursor = input.hovered !== null || input.hoveredAxis !== null ? 'pointer' : 'default'
    }
    /** Commits a drag in progress: on release, and before undo or a tool change so no preview is left over. */
    const endDrag = () => {
      if (!dragging) return
      dragging = false
      flush()
      apply(input.pointerUp())
    }

    const controller = new AbortController()
    const { signal } = controller
    element.addEventListener('pointerdown', onPointerDown, { signal })
    window.addEventListener('pointermove', onPointerMove, { signal })
    window.addEventListener('pointerup', endDrag, { signal })
    window.addEventListener('pointercancel', endDrag, { signal })

    const unsubscribe = store.subscribe((s, prev) => {
      if (s.selection !== prev.selection && !sameHandle(refOf(s.selection), input.selected)) input.select(refOf(s.selection))
      if (s.selection !== prev.selection || s.editVersion !== prev.editVersion) changed.current = true
    })
    store.getState().setFeatureKeys({
      key: (k) => apply(input.key(k)) !== null,
      cancelDraft: () => {
        endDrag()
        const had = input.cancel()
        changed.current = true
        return had
      },
    })

    return () => {
      endDrag()
      controller.abort()
      unsubscribe()
      element.style.cursor = ''
      if (store.getState().featureKeys) store.getState().setFeatureKeys(null)
      if (inputRef.current === input) inputRef.current = null
    }
  }, [active, terrain, scene.size, element, camera])

  useFrame(() => {
    const input = inputRef.current
    if (!input) return
    if (pendingRay.current) {
      const r = input.pointerMove(pendingRay.current)
      pendingRay.current = null
      if (r?.preview) terrain.previewFeatures(r.preview)
      changed.current = true
    }

    // Arrows on the selected handle, sized to the camera distance.
    const sel = input.selected
    const all = input.handles()
    const at = sel ? all.find((h) => sameHandle(h.ref, sel))?.position : undefined
    gizmo.group.visible = at !== undefined
    if (at && sel) {
      gizmo.group.position.set(at.x, at.y, at.z)
      gizmo.group.scale.setScalar(gizmoLength(camera.position.distanceTo(gizmo.group.position)))
      const axes = handleAxes(sel)
      for (const axis of AXES) {
        gizmo.arrows[axis].visible = axes.includes(axis)
        gizmo.materials[axis].color.set(axis === input.hoveredAxis ? HOVERED : AXIS_COLORS[axis])
      }
    }

    if (!changed.current) return
    changed.current = false
    const m = new Matrix4()
    const hovered = input.hovered
    let n = 0
    for (const h of all) {
      if (n >= MAX_HANDLES) break
      handles.setMatrixAt(n, m.makeTranslation(h.position.x, h.position.y, h.position.z))
      const lit = sameHandle(h.ref, sel) || sameHandle(h.ref, hovered)
      handles.setColorAt(n, lit ? HOVERED : h.ref.kind === 'cave' ? CAVE_COLOR : h.ref.kind === 'pond' ? POND_COLOR : SPLINE_COLOR)
      n++
    }
    handles.count = n
    handles.instanceMatrix.needsUpdate = true
    if (handles.instanceColor) handles.instanceColor.needsUpdate = true
  })

  if (!active) return null
  return (
    <>
      <primitive object={handles} />
      <primitive object={gizmo.group} />
    </>
  )
}
