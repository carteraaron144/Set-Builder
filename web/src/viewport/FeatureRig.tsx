import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
} from 'three'
import { useEditorStore } from '../editor/editorStore'
import type { SplinePoint } from '../features/features'
import { sampleSpline } from '../features/spline'
import { heightAt } from '../terrain/layers'
import type { Scene } from '../scene/scene'
import type { TerrainEditor } from '../terrain/terrainEditor'
import { PondInput } from '../tools/pondInput'
import { SplineInput, type SplineResult } from '../tools/splineInput'

const MAX_HANDLES = 400
const LIFT = 0.15 // metres above the ground
const HANDLE = new Color('#ffffff')
const HOVERED = new Color('#ffd34d')
const DRAFT = new Color('#7fd0ff')

function createHandles(): InstancedMesh {
  const mesh = new InstancedMesh(
    new SphereGeometry(0.45, 12, 8),
    new MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.95 }),
    MAX_HANDLES,
  )
  mesh.renderOrder = 10
  mesh.frustumCulled = false
  mesh.count = 0
  return mesh
}

function createLine(): Line {
  const line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#7fd0ff', depthTest: false, transparent: true }))
  line.renderOrder = 10
  line.frustumCulled = false
  line.visible = false
  return line
}

/**
 * Wires clicks on the carved ground to the Path, River and Water tools: drawing, selecting and dragging spline
 * points or pond levels, with handles drawn as spheres and the draft as a line.
 */
export function FeatureRig({ terrain, scene }: { terrain: TerrainEditor; scene: Scene }) {
  const camera = useThree((s) => s.camera)
  const element = useThree((s) => s.gl.domElement) as HTMLCanvasElement
  const tool = useEditorStore((s) => s.tool)
  const kind = tool === 'path' || tool === 'river' || tool === 'water' ? tool : null
  const [handles] = useState(createHandles)
  const [line] = useState(createLine)
  const inputRef = useRef<SplineInput | PondInput | null>(null)
  const hover = useRef<SplinePoint | null>(null)
  const pendingDrag = useRef<SplinePoint | null>(null)
  const pendingY = useRef<number | null>(null)
  const changed = useRef(true)

  useEffect(
    () => () => {
      handles.geometry.dispose()
      ;(handles.material as MeshBasicMaterial).dispose()
      line.geometry.dispose()
      ;(line.material as LineBasicMaterial).dispose()
    },
    [handles, line],
  )

  useEffect(() => {
    changed.current = true
    if (!kind) return
    const store = useEditorStore
    const input =
      kind === 'water'
        ? new PondInput(
            () => terrain.features,
            () => terrain.ground.layers.heights,
            () => terrain.ground.ponds,
            scene.size,
          )
        : new SplineInput(kind, () => terrain.features, scene.size, () => store.getState().pathStyle)
    const splines = input instanceof SplineInput ? input : null
    inputRef.current = input
    let dragging = false

    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const pick = (e: MouseEvent): SplinePoint | null => {
      const r = element.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = terrain.ground.raycast(raycaster.ray.origin, raycaster.ray.direction)
      return hit ? { x: hit.x, z: hit.z } : null
    }
    const apply = (r: SplineResult | null) => {
      changed.current = true
      if (!r) return r
      if (r.preview) terrain.previewFeatures(r.preview)
      if (r.commit) terrain.commitFeatures(r.commit)
      if (r.message) store.getState().setMessage({ kind: 'info', text: r.message })
      const id = input.selectedId
      const selKind = splines ? 'spline' : 'pond'
      const cur = store.getState().selection
      if ((cur?.kind === selKind ? cur.id : null) !== id) store.getState().setSelection(id ? { kind: selKind, id } : null)
      return r
    }
    const flushDrag = () => {
      const p = pendingDrag.current
      const y = pendingY.current
      pendingDrag.current = null
      pendingY.current = null
      if (p && splines) apply(splines.pointerMove(p))
      if (y !== null && !splines) apply((input as PondInput).pointerMove(y))
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const p = pick(e)
      if (!p) return
      const r = splines ? splines.pointerDown(p) : (input as PondInput).pointerDown(p, e.clientY)
      if (!apply(r) || r?.message) return
      dragging = true
      try {
        element.setPointerCapture?.(e.pointerId)
      } catch {
        // Best-effort; window listeners still see the drag.
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (dragging) {
        if (splines) pendingDrag.current = pick(e) ?? pendingDrag.current
        else pendingY.current = e.clientY
        return
      }
      if (e.target !== element || !splines) return
      const p = pick(e)
      hover.current = p
      changed.current = true
      if (p) splines.pointerMove(p)
      element.style.cursor = splines.hoveredHandle !== null ? 'pointer' : 'crosshair'
    }
    /** Commits a drag in progress: on release, and before undo or a tool change so no preview is left over. */
    const endDrag = () => {
      if (!dragging) return
      dragging = false
      flushDrag()
      apply(input.pointerUp())
    }
    const onPointerUp = endDrag
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !splines) return
      const p = pick(e)
      if (p) apply(splines.click(p, { alt: e.altKey }))
    }
    const onDoubleClick = (e: MouseEvent) => {
      e.preventDefault()
      const p = pick(e)
      if (p && splines) apply(splines.doubleClick(p))
    }
    const onLeave = () => {
      hover.current = null
      changed.current = true
    }

    const controller = new AbortController()
    const signal = controller.signal
    element.addEventListener('pointerdown', onPointerDown, { signal })
    element.addEventListener('click', onClick, { signal })
    element.addEventListener('dblclick', onDoubleClick, { signal })
    element.addEventListener('pointerleave', onLeave, { signal })
    window.addEventListener('pointermove', onPointerMove, { signal })
    window.addEventListener('pointerup', onPointerUp, { signal })
    window.addEventListener('pointercancel', onPointerUp, { signal })
    element.style.cursor = 'crosshair'

    const unsubscribe = store.subscribe((s, prev) => {
      if (s.selection === prev.selection) return
      const id = s.selection?.kind === (splines ? 'spline' : 'pond') ? s.selection!.id : null
      if (id !== input.selectedId) input.select(id)
      changed.current = true
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
    // Undo/redo can remove or move the selected spline: redraw its handles.
    const unsubscribeEdits = store.subscribe((s, prev) => {
      if (s.editVersion !== prev.editVersion) changed.current = true
    })

    return () => {
      endDrag()
      controller.abort()
      unsubscribe()
      unsubscribeEdits()
      element.style.cursor = ''
      if (store.getState().featureKeys) store.getState().setFeatureKeys(null)
      if (inputRef.current === input) inputRef.current = null
      hover.current = null
    }
  }, [kind, terrain, scene.size, element, camera])

  useFrame(() => {
    const input = inputRef.current
    if (input instanceof SplineInput && pendingDrag.current) {
      const p = pendingDrag.current
      pendingDrag.current = null
      const r = input.pointerMove(p)
      if (r?.preview) terrain.previewFeatures(r.preview)
      changed.current = true
    }
    if (input instanceof PondInput && pendingY.current !== null) {
      const r = input.pointerMove(pendingY.current)
      pendingY.current = null
      if (r?.preview) terrain.previewFeatures(r.preview)
      changed.current = true
    }
    if (!changed.current) return
    changed.current = false
    const heights = terrain.ground.layers.heights
    const y = (p: SplinePoint) => heightAt(heights, p.x, p.z) + LIFT

    const m = new Matrix4()
    let n = 0
    const put = (p: SplinePoint, c: Color) => {
      if (n >= MAX_HANDLES) return
      handles.setMatrixAt(n, m.makeTranslation(p.x, y(p), p.z))
      handles.setColorAt(n, c)
      n++
    }
    const done = () => {
      handles.count = n
      handles.instanceMatrix.needsUpdate = true
      if (handles.instanceColor) handles.instanceColor.needsUpdate = true
    }

    // Ponds: every seed, so empty ponds can be found; the selected one highlighted.
    if (input instanceof PondInput) {
      for (const p of terrain.features.ponds) put(p.seed, p.id === input.selectedId ? HOVERED : HANDLE)
      done()
      line.visible = false
      return
    }

    // Handles: the selected spline's points, then the draft's.
    const selected = input?.selectedId ? terrain.features.splines.find((s) => s.id === input.selectedId) : undefined
    const draft = input?.draft ?? []
    selected?.points.forEach((p, k) => put(p, k === input?.hoveredHandle ? HOVERED : HANDLE))
    draft.forEach((p) => put(p, DRAFT))
    done()

    // The draft as a curve, with the point under the pointer as its next point.
    const pts = draft.length > 0 && hover.current ? [...draft, hover.current] : draft
    line.visible = pts.length >= 2
    if (!line.visible) return
    const sm = sampleSpline(pts, 1)
    const positions = new Float32Array(sm.xs.length * 3)
    for (let k = 0; k < sm.xs.length; k++) {
      const p = { x: sm.xs[k], z: sm.zs[k] }
      positions.set([p.x, y(p), p.z], k * 3)
    }
    // The draft's length changes, so swap in a fresh geometry rather than resizing a buffer.
    line.geometry.dispose()
    line.geometry = new BufferGeometry()
    line.geometry.setAttribute('position', new BufferAttribute(positions, 3))
  })

  if (!kind) return null
  return (
    <>
      <primitive object={handles} />
      <primitive object={line} />
    </>
  )
}
