import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import { useEditorStore } from '../editor/editorStore'
import { draftCaveGlow, draftGlowPoints, glowKey, GlowThrottle } from '../features/caveGlow'
import { sampleCave } from '../features/caves'
import type { CavePoint, SplinePoint } from '../features/features'
import { sampleSpline } from '../features/spline'
import { heightAt } from '../terrain/layers'
import type { Scene } from '../scene/scene'
import type { TerrainEditor } from '../terrain/terrainEditor'
import { gizmoLength, type Axis } from '../tools/axisGizmo'
import { CaveInput, type Ray } from '../tools/caveInput'
import { PondInput } from '../tools/pondInput'
import { SplineInput, type SplineResult } from '../tools/splineInput'
import { GLOW_COLOR, GLOW_OPACITY } from './CaveGlow'

const MAX_HANDLES = 400
export const LIFT = 0.15 // metres above the ground
export const HANDLE = new Color('#ffffff')
export const HOVERED = new Color('#ffd34d')
const DRAFT = new Color('#7fd0ff')
export const AXIS_COLORS: Record<Axis, string> = { x: '#e5534b', y: '#6cc24a', z: '#4c8bf5' }
export const AXES: Axis[] = ['x', 'y', 'z']

/** Three arrows along +x, +y and +z from the origin, unit length (scaled to fit the view), drawn over the ground. */
export function createGizmo(): { group: Group; materials: Record<Axis, MeshBasicMaterial>; arrows: Record<Axis, Group> } {
  const group = new Group()
  group.visible = false
  const materials = {} as Record<Axis, MeshBasicMaterial>
  const arrows = {} as Record<Axis, Group>
  for (const axis of AXES) {
    const material = new MeshBasicMaterial({ color: AXIS_COLORS[axis], depthTest: false, transparent: true })
    const arrow = new Group()
    // Built along +y, from a quarter of the way out (clear of the point's handle) to the tip.
    const shaft = new Mesh(new CylinderGeometry(0.02, 0.02, 0.6, 8), material)
    shaft.position.y = 0.55
    const tip = new Mesh(new ConeGeometry(0.06, 0.15, 12), material)
    tip.position.y = 0.925
    for (const m of [shaft, tip]) {
      m.renderOrder = 11
      m.frustumCulled = false
      arrow.add(m)
    }
    if (axis === 'x') arrow.rotation.z = -Math.PI / 2
    if (axis === 'z') arrow.rotation.x = Math.PI / 2
    group.add(arrow)
    materials[axis] = material
    arrows[axis] = arrow
  }
  return { group, materials, arrows }
}

export function createHandles(): InstancedMesh {
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

/** Every cave's centreline, drawn through the ground. */
function createCaveLines(): LineSegments {
  const lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: '#ffb36b', depthTest: false, transparent: true }))
  lines.renderOrder = 10
  lines.frustumCulled = false
  lines.visible = false
  return lines
}

/** The sky-blue glow of the cave being drawn, one mesh per chunk it reaches. */
function createDraftGlow(): { group: Group; material: MeshBasicMaterial } {
  const material = new MeshBasicMaterial({ color: GLOW_COLOR, transparent: true, opacity: GLOW_OPACITY, depthTest: false, depthWrite: false })
  return { group: new Group(), material }
}

/**
 * Wires clicks on the carved ground to the Path, River, Water and Cave tools: drawing, selecting and dragging
 * spline or cave points or pond levels, with handles drawn as spheres and the draft as a line. Cave handles and
 * centrelines sit at their own depth and draw through the ground.
 */
export function FeatureRig({ terrain, scene }: { terrain: TerrainEditor; scene: Scene }) {
  const camera = useThree((s) => s.camera)
  const element = useThree((s) => s.gl.domElement) as HTMLCanvasElement
  const tool = useEditorStore((s) => s.tool)
  const kind = tool === 'path' || tool === 'river' || tool === 'water' || tool === 'cave' ? tool : null
  const [handles] = useState(createHandles)
  const [line] = useState(createLine)
  const [caveLines] = useState(createCaveLines)
  const [gizmo] = useState(createGizmo)
  const [draftGlow] = useState(createDraftGlow)
  const glowThrottle = useRef(new GlowThrottle(30))
  const inputRef = useRef<SplineInput | PondInput | CaveInput | null>(null)
  const hover = useRef<SplinePoint | null>(null)
  const pendingDrag = useRef<SplinePoint | null>(null)
  const pendingSplineRay = useRef<Ray | null>(null)
  const pendingRay = useRef<Ray | null>(null)
  const pendingY = useRef<number | null>(null)
  const changed = useRef(true)

  useEffect(
    () => () => {
      handles.geometry.dispose()
      ;(handles.material as MeshBasicMaterial).dispose()
      line.geometry.dispose()
      ;(line.material as LineBasicMaterial).dispose()
      caveLines.geometry.dispose()
      ;(caveLines.material as LineBasicMaterial).dispose()
      gizmo.group.traverse((o) => (o as Mesh).geometry?.dispose())
      Object.values(gizmo.materials).forEach((m) => m.dispose())
      draftGlow.group.children.forEach((m) => (m as Mesh).geometry.dispose())
      draftGlow.material.dispose()
    },
    [handles, line, caveLines, gizmo, draftGlow],
  )

  useEffect(() => {
    changed.current = true
    if (!kind) return
    const store = useEditorStore
    const heightOf = (p: SplinePoint) => heightAt(terrain.ground.layers.heights, p.x, p.z) + LIFT
    const reach = new Vector3()
    const length = (at: { x: number; y: number; z: number }) => gizmoLength(camera.position.distanceTo(reach.set(at.x, at.y, at.z)))
    const input =
      kind === 'cave'
        ? new CaveInput(() => terrain.features, scene.size, length)
        : kind === 'water'
        ? new PondInput(
            () => terrain.features,
            () => terrain.ground.layers.heights,
            () => terrain.ground.ponds,
            scene.size,
          )
        : new SplineInput(kind, () => terrain.features, scene.size, () => store.getState().pathStyle, { y: heightOf, length })
    const splines = input instanceof SplineInput ? input : null
    const caves = input instanceof CaveInput ? input : null
    inputRef.current = input
    let dragging = false

    const raycaster = new Raycaster()
    const ndc = new Vector2()
    /** The pointer's ray, and where it meets the ground. */
    const cast = (e: MouseEvent): { ray: Ray; hit: { x: number; y: number; z: number } | null } | null => {
      const r = element.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const ray = { origin: raycaster.ray.origin.clone(), dir: raycaster.ray.direction.clone() }
      return { ray, hit: terrain.ground.raycast(ray.origin, ray.dir) }
    }
    const pick = (e: MouseEvent): SplinePoint | null => {
      const hit = cast(e)?.hit
      return hit ? { x: hit.x, z: hit.z } : null
    }
    const apply = (r: SplineResult | null) => {
      changed.current = true
      if (!r) return r
      if (r.preview) terrain.previewFeatures(r.preview)
      if (r.commit) terrain.commitFeatures(r.commit)
      if (r.message) store.getState().setMessage({ kind: 'info', text: r.message })
      const id = input.selectedId
      const cur = store.getState().selection
      if (caves) {
        const point = caves.selectedPoint
        if (cur?.kind !== 'cave' ? id !== null : cur.id !== id || cur.point !== point)
          store.getState().setSelection(id ? { kind: 'cave', id, point } : null)
        return r
      }
      if (splines) {
        const point = splines.selectedPoint
        if (cur?.kind !== 'spline' ? id !== null : cur.id !== id || cur.point !== point)
          store.getState().setSelection(id ? { kind: 'spline', id, point } : null)
        return r
      }
      if ((cur?.kind === 'pond' ? cur.id : null) !== id) store.getState().setSelection(id ? { kind: 'pond', id } : null)
      return r
    }
    const flushDrag = () => {
      const p = pendingDrag.current
      const y = pendingY.current
      const ray = pendingRay.current
      const splineRay = pendingSplineRay.current
      pendingDrag.current = null
      pendingY.current = null
      pendingRay.current = null
      pendingSplineRay.current = null
      if ((p || splineRay) && splines) apply(splines.pointerMove(p, splineRay ?? undefined))
      if (ray && caves) apply(caves.pointerMove(ray))
      if (y !== null && input instanceof PondInput) apply(input.pointerMove(y))
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      let r: SplineResult | null
      if (caves) {
        const c = cast(e)
        if (!c) return
        r = caves.pointerDown(c.ray)
      } else if (splines) {
        const c = cast(e)
        if (!c) return
        r = splines.pointerDown(c.hit ? { x: c.hit.x, z: c.hit.z } : null, c.ray)
      } else {
        const p = pick(e)
        if (!p) return
        r = (input as PondInput).pointerDown(p, e.clientY)
      }
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
        if (splines) {
          const c = cast(e)
          if (c?.hit) pendingDrag.current = { x: c.hit.x, z: c.hit.z }
          if (c) pendingSplineRay.current = c.ray
        }
        else if (caves) pendingRay.current = cast(e)?.ray ?? pendingRay.current
        else pendingY.current = e.clientY
        return
      }
      if (e.target !== element || input instanceof PondInput) return
      changed.current = true
      if (caves) {
        const c = cast(e)
        hover.current = c?.hit ? { x: c.hit.x, z: c.hit.z } : null
        if (c) caves.pointerMove(c.ray)
      } else {
        const c = cast(e)
        hover.current = c?.hit ? { x: c.hit.x, z: c.hit.z } : null
        if (c) splines?.pointerMove(hover.current, c.ray)
      }
      element.style.cursor = input.hoveredHandle !== null || input.hoveredAxis !== null ? 'pointer' : 'crosshair'
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
      if (e.button !== 0) return
      if (caves) {
        const c = cast(e)
        if (c) apply(caves.click(c.hit, c.ray))
        return
      }
      const p = splines && pick(e)
      if (p) apply(splines.click(p, { alt: e.altKey }))
    }
    const onDoubleClick = (e: MouseEvent) => {
      e.preventDefault()
      if (caves) {
        const c = cast(e)
        if (c) apply(caves.doubleClick(c.hit, c.ray))
        return
      }
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
      const sel = s.selection
      if (caves) {
        const id = sel?.kind === 'cave' ? sel.id : null
        const point = sel?.kind === 'cave' ? sel.point : null
        if (id !== caves.selectedId || point !== caves.selectedPoint) caves.select(id, point)
      } else if (splines) {
        const id = sel?.kind === 'spline' ? sel.id : null
        const point = sel?.kind === 'spline' ? sel.point : null
        if (id !== splines.selectedId || point !== splines.selectedPoint) splines.select(id, point)
      } else {
        const id = sel?.kind === 'pond' ? sel.id : null
        if (id !== input.selectedId) input.select(id)
      }
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

  /** Arrows on the selected point (a cave's or path's), sized to the camera distance; hidden otherwise. */
  const updateGizmo = () => {
    const input = inputRef.current
    let at: Vector3 | null = null
    let axes: Axis[] = []
    if (input instanceof CaveInput && input.selectedPoint !== null) {
      const p = terrain.features.caves.find((c) => c.id === input.selectedId)?.points[input.selectedPoint]
      if (p) at = new Vector3(p.x, p.y, p.z)
      axes = AXES
    } else if (input instanceof SplineInput && input.selectedPoint !== null) {
      const p = terrain.features.splines.find((s) => s.id === input.selectedId)?.points[input.selectedPoint]
      if (p) at = new Vector3(p.x, heightAt(terrain.ground.layers.heights, p.x, p.z) + LIFT, p.z)
      axes = ['x', 'z']
    }
    gizmo.group.visible = at !== null && !(input instanceof SplineInput && input.draft) && !(input instanceof CaveInput && input.draft)
    if (!at) return
    gizmo.group.position.copy(at)
    gizmo.group.scale.setScalar(gizmoLength(camera.position.distanceTo(at)))
    const hovered = input instanceof CaveInput || input instanceof SplineInput ? input.hoveredAxis : null
    for (const axis of AXES) {
      gizmo.arrows[axis].visible = axes.includes(axis)
      gizmo.materials[axis].color.set(axis === hovered ? HOVERED : AXIS_COLORS[axis])
    }
  }

  /** Meshes the cave being drawn, with the pointer's point as its end, at most every 30 ms (meshing is slow). */
  const updateDraftGlow = () => {
    const input = inputRef.current
    const draft = input instanceof CaveInput ? (input.draft ?? []) : []
    const points = draftGlowPoints(draft, hover.current)
    if (!glowThrottle.current.due(glowKey(points), performance.now())) return
    for (const m of [...draftGlow.group.children] as Mesh[]) {
      draftGlow.group.remove(m)
      m.geometry.dispose()
    }
    for (const g of draftCaveGlow(terrain.ground.layers.heights, points)) {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(g.positions, 3))
      geometry.setIndex(new BufferAttribute(g.indices, 1))
      const mesh = new Mesh(geometry, draftGlow.material)
      mesh.renderOrder = 10
      mesh.frustumCulled = false
      draftGlow.group.add(mesh)
    }
  }

  useFrame(() => {
    const input = inputRef.current
    if (input instanceof SplineInput && (pendingDrag.current || pendingSplineRay.current)) {
      const p = pendingDrag.current
      const ray = pendingSplineRay.current
      pendingDrag.current = null
      pendingSplineRay.current = null
      const r = input.pointerMove(p, ray ?? undefined)
      if (r?.preview) terrain.previewFeatures(r.preview)
      changed.current = true
    }
    if (input instanceof CaveInput && pendingRay.current) {
      const r = input.pointerMove(pendingRay.current)
      pendingRay.current = null
      if (r?.preview) terrain.previewFeatures(r.preview)
      changed.current = true
    }
    if (input instanceof PondInput && pendingY.current !== null) {
      const r = input.pointerMove(pendingY.current)
      pendingY.current = null
      if (r?.preview) terrain.previewFeatures(r.preview)
      changed.current = true
    }
    updateGizmo()
    updateDraftGlow()
    if (!changed.current) return
    changed.current = false
    const heights = terrain.ground.layers.heights
    const y = (p: SplinePoint) => heightAt(heights, p.x, p.z) + LIFT

    const m = new Matrix4()
    let n = 0
    const put = (p: SplinePoint | CavePoint, c: Color) => {
      if (n >= MAX_HANDLES) return
      handles.setMatrixAt(n, m.makeTranslation(p.x, 'y' in p ? p.y : y(p), p.z))
      handles.setColorAt(n, c)
      n++
    }
    const done = () => {
      handles.count = n
      handles.instanceMatrix.needsUpdate = true
      if (handles.instanceColor) handles.instanceColor.needsUpdate = true
    }

    caveLines.visible = false
    // Caves: every point at its depth (the selected point and hovered handle highlighted) and every centreline.
    if (input instanceof CaveInput) {
      const segments: number[] = []
      const strip = (pts: CavePoint[]) => {
        if (pts.length < 2) return
        const sm = sampleCave(pts, 1)
        for (let k = 1; k < sm.xs.length; k++)
          segments.push(sm.xs[k - 1], sm.ys[k - 1], sm.zs[k - 1], sm.xs[k], sm.ys[k], sm.zs[k])
      }
      for (const c of terrain.features.caves) {
        const selected = c.id === input.selectedId
        c.points.forEach((p, k) => put(p, selected && (k === input.selectedPoint || k === input.hoveredHandle) ? HOVERED : HANDLE))
        strip(c.points)
      }
      const draft = input.draft ?? []
      draft.forEach((p) => put(p, DRAFT))
      const last = draft[draft.length - 1]
      strip(last && hover.current ? [...draft, { ...hover.current, y: last.y, chamber: 0 }] : draft)
      done()
      line.visible = false
      caveLines.visible = segments.length > 0
      caveLines.geometry.dispose()
      caveLines.geometry = new BufferGeometry()
      caveLines.geometry.setAttribute('position', new BufferAttribute(Float32Array.from(segments), 3))
      return
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
      <primitive object={caveLines} />
      <primitive object={gizmo.group} />
      <primitive object={draftGlow.group} />
    </>
  )
}
