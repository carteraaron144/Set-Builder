import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three'
import { useEditorStore } from '../editor/editorStore'
import type { TerrainEditor } from '../terrain/terrainEditor'
import { chunkGridPositions } from './chunkGridGeometry'

/** The 32 m chunk boundaries as lines draped on the ground, shown when the settings menu asks for them. */
export function ChunkGrid({ terrain }: { terrain: TerrainEditor }) {
  const lines = useMemo(() => {
    const material = new LineBasicMaterial({ color: '#ffd24a', depthTest: false, transparent: true, opacity: 0.8 })
    const geometry = new BufferGeometry()
    const positions = chunkGridPositions(terrain.ground.layers.heights)
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    const l = new LineSegments(geometry, material)
    l.renderOrder = 9
    l.frustumCulled = false
    l.visible = false
    return l
  }, [terrain])
  useEffect(
    () => () => {
      lines.geometry.dispose()
      ;(lines.material as LineBasicMaterial).dispose()
    },
    [lines],
  )

  useFrame(() => {
    const on = useEditorStore.getState().showChunkGrid
    lines.visible = on
    if (!on) return
    const attr = lines.geometry.getAttribute('position') as BufferAttribute
    chunkGridPositions(terrain.ground.layers.heights, attr.array as Float32Array)
    attr.needsUpdate = true
  })

  return <primitive object={lines} />
}
