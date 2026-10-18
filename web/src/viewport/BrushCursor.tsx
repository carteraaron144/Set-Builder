import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial } from 'three'
import { isBrushTool, useEditorStore } from '../editor/editorStore'
import { is3dMode } from '../terrain/brush3d'
import { heightAt } from '../terrain/layers'
import type { TerrainEditor } from '../terrain/terrainEditor'
import type { BrushPoint } from '../tools/brushInput'

const SEGMENTS = 64
// three's WebGPU/WebGL2 renderer doesn't support LineLoop, so the ring is a Line whose last point repeats the first.
const POINTS = SEGMENTS + 1
const LIFT = 0.1 // metres above the ground

function createRing(): Line {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(POINTS * 3), 3))
  const line = new Line(geometry, new LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.9 }))
  line.renderOrder = 10
  line.frustumCulled = false
  line.visible = false
  return line
}

/** Latitude rings of the 3D brush sphere, as fractions of the radius above the centre. */
const LATITUDES = [-0.5, 0, 0.5]

/** A ring of the brush radius draped on the terrain at the hover point (a wireframe sphere for the 3D modes), shown while a tool is selected. */
export function BrushCursor({ terrain, hover }: { terrain: TerrainEditor; hover: RefObject<BrushPoint | null> }) {
  // Built once and handed to r3f as a primitive (r3f's JSX <line> clashes with SVG's).
  const [ring] = useState(createRing)
  const [sphere] = useState(() => LATITUDES.map(createRing))
  const ref = useRef<Line>(null)
  useEffect(
    () => () => {
      ring.geometry.dispose()
      ;(ring.material as LineBasicMaterial).dispose()
      for (const l of sphere) {
        l.geometry.dispose()
        ;(l.material as LineBasicMaterial).dispose()
      }
    },
    [ring, sphere],
  )

  useFrame(() => {
    const line = ref.current
    if (!line) return
    const { tool, brush, terrainMode } = useEditorStore.getState()
    const at = hover.current
    const solid = tool === 'terrain' && is3dMode(terrainMode)
    sphere.forEach((l, n) => {
      l.visible = solid && at !== null
      if (!l.visible || !at) return
      const lift = LATITUDES[n] * brush.radius
      const r = Math.sqrt(brush.radius ** 2 - lift ** 2)
      const p = l.geometry.getAttribute('position') as BufferAttribute
      for (let k = 0; k < POINTS; k++) {
        const a = (k / SEGMENTS) * Math.PI * 2
        p.setXYZ(k, at.x + Math.cos(a) * r, (at.y ?? 0) + lift, at.z + Math.sin(a) * r)
      }
      p.needsUpdate = true
    })
    line.visible = isBrushTool(tool) && at !== null && !solid
    if (!line.visible || !at) return
    const positions = line.geometry.getAttribute('position') as BufferAttribute
    for (let k = 0; k < POINTS; k++) {
      const a = (k / SEGMENTS) * Math.PI * 2
      const x = at.x + Math.cos(a) * brush.radius
      const z = at.z + Math.sin(a) * brush.radius
      positions.setXYZ(k, x, heightAt(terrain.layers.heights, x, z) + LIFT, z)
    }
    positions.needsUpdate = true
  })

  return (
    <>
      <primitive ref={ref} object={ring} />
      {sphere.map((l, n) => (
        <primitive key={n} object={l} />
      ))}
    </>
  )
}
