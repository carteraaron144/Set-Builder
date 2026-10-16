import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial } from 'three'
import type { GroundPoint } from '../camera/overheadCamera'
import { isBrushTool, useEditorStore } from '../editor/editorStore'
import { heightAt } from '../terrain/layers'
import type { TerrainEditor } from '../terrain/terrainEditor'

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

/** A ring of the brush radius draped on the terrain at the hover point, shown while a tool is selected. */
export function BrushCursor({ terrain, hover }: { terrain: TerrainEditor; hover: RefObject<GroundPoint | null> }) {
  // Built once and handed to r3f as a primitive (r3f's JSX <line> clashes with SVG's).
  const [ring] = useState(createRing)
  const ref = useRef<Line>(null)
  useEffect(
    () => () => {
      ring.geometry.dispose()
      ;(ring.material as LineBasicMaterial).dispose()
    },
    [ring],
  )

  useFrame(() => {
    const line = ref.current
    if (!line) return
    const { tool, brush } = useEditorStore.getState()
    const at = hover.current
    line.visible = isBrushTool(tool) && at !== null
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

  return <primitive ref={ref} object={ring} />
}
