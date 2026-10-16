import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, MeshStandardMaterial } from 'three'
import { chunkCount, updateChunkGeometry, type ChunkGeometry } from '../terrain/chunks'
import { DEFAULT_PALETTE } from '../terrain/palette'
import type { TerrainEditor } from '../terrain/terrainEditor'
import { useEditorStore } from '../editor/editorStore'
import { RemeshThrottle } from './remeshThrottle'

interface Chunk {
  data: ChunkGeometry
  geometry: BufferGeometry
  /** Meshed from the density field: its vertex count changes, so it gets new buffers instead of updates. */
  sdf: boolean
}

function setBuffers(geometry: BufferGeometry, data: ChunkGeometry): void {
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3).setUsage(DynamicDrawUsage))
  geometry.setAttribute('color', new BufferAttribute(data.colors, 3).setUsage(DynamicDrawUsage))
  geometry.setIndex(new BufferAttribute(data.indices, 1))
  geometry.computeBoundingSphere()
}

/**
 * One flat-shaded mesh per 32 m chunk of the ground; dirty chunks are refreshed at most once per frame, in place
 * for heightmap chunks and, at the settings delay, with new buffers for chunks caves reach.
 */
export function TerrainMesh({ terrain }: { terrain: TerrainEditor }) {
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, flatShading: true }), [])
  useEffect(() => () => material.dispose(), [material])

  const chunks = useMemo<Chunk[]>(() => {
    // A fresh build covers everything, so drop changes queued before it.
    terrain.takeDirtyChunks('mesh')
    const n = chunkCount(terrain.layers.heights.size)
    const { ground } = terrain
    return Array.from({ length: n * n }, (_, i) => {
      const data = ground.chunkGeometry(i, DEFAULT_PALETTE)
      const geometry = new BufferGeometry()
      setBuffers(geometry, data)
      return { data, geometry, sdf: ground.isSdfChunk(i) }
    })
  }, [terrain])
  useEffect(() => () => chunks.forEach((c) => c.geometry.dispose()), [chunks])

  const throttle = useMemo(() => new RemeshThrottle(0), [terrain])

  useFrame(() => {
    const { ground } = terrain
    // The settings menu picks the wait; Off (0) remeshes every frame.
    throttle.minInterval = useEditorStore.getState().caveRemeshDelay
    for (const i of terrain.takeDirtyChunks('mesh')) {
      const c = chunks[i]
      if (!c) continue
      if (c.sdf || ground.isSdfChunk(i)) {
        // Density-field remeshes are slow, so they are queued and spaced out by the settings delay.
        throttle.add([i])
        continue
      }
      updateChunkGeometry(ground.layers, i, DEFAULT_PALETTE, c.data, ground.surface)
      c.geometry.getAttribute('position').needsUpdate = true
      c.geometry.getAttribute('color').needsUpdate = true
      c.geometry.computeBoundingSphere()
    }
    const start = performance.now()
    const due = throttle.take(start)
    for (const i of due) {
      const c = chunks[i]
      c.data = ground.chunkGeometry(i, DEFAULT_PALETTE)
      c.sdf = ground.isSdfChunk(i)
      setBuffers(c.geometry, c.data)
    }
    if (due.length > 0) {
      const end = performance.now()
      throttle.finished(end, end - start)
    }
  })

  return (
    <group>
      {chunks.map((c, i) => (
        <mesh key={i} geometry={c.geometry} material={material} castShadow receiveShadow />
      ))}
    </group>
  )
}
