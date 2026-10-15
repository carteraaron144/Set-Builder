import { useFrame } from '@react-three/fiber'
import { useRef, useState, type RefObject } from 'react'
import type { BufferAttribute, LineLoop } from 'three'
import type { GroundPoint } from '../camera/overheadCamera'
import { useEditorStore } from '../editor/editorStore'
import { heightAt } from '../terrain/layers'
import type { TerrainEditor } from '../terrain/terrainEditor'

const SEGMENTS = 64
const LIFT = 0.1 // metres above the ground

/** A ring of the brush radius draped on the terrain at the hover point, shown while a tool is selected. */
export function BrushCursor({ terrain, hover }: { terrain: TerrainEditor; hover: RefObject<GroundPoint | null> }) {
  const ring = useRef<LineLoop>(null)
  // Stable across renders: r3f rebuilds an attribute whose args change.
  const [initial] = useState(() => new Float32Array(SEGMENTS * 3))

  useFrame(() => {
    const line = ring.current
    if (!line) return
    const { tool, brush } = useEditorStore.getState()
    const at = hover.current
    line.visible = tool !== null && at !== null
    if (!line.visible || !at) return
    const positions = line.geometry.getAttribute('position') as BufferAttribute
    for (let k = 0; k < SEGMENTS; k++) {
      const a = (k / SEGMENTS) * Math.PI * 2
      const x = at.x + Math.cos(a) * brush.radius
      const z = at.z + Math.sin(a) * brush.radius
      positions.setXYZ(k, x, heightAt(terrain.layers.heights, x, z) + LIFT, z)
    }
    positions.needsUpdate = true
  })

  return (
    <lineLoop ref={ring} renderOrder={10} frustumCulled={false} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[initial, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.9} />
    </lineLoop>
  )
}
