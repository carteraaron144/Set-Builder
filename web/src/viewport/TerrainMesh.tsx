import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, MeshStandardMaterial } from 'three'
import { buildChunkGeometry, chunkCount, updateChunkGeometry, type ChunkGeometry } from '../terrain/chunks'
import { DEFAULT_PALETTE } from '../terrain/palette'
import type { TerrainEditor } from '../terrain/terrainEditor'

interface Chunk {
  data: ChunkGeometry
  geometry: BufferGeometry
}

/** One flat-shaded mesh per 32 m chunk of the carved ground; dirty chunks are refreshed in place, at most once per frame. */
export function TerrainMesh({ terrain }: { terrain: TerrainEditor }) {
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, flatShading: true }), [])
  useEffect(() => () => material.dispose(), [material])

  const chunks = useMemo<Chunk[]>(() => {
    // A fresh build covers everything, so drop changes queued before it.
    terrain.takeDirtyChunks('mesh')
    const n = chunkCount(terrain.layers.heights.size)
    const { layers, surface } = terrain.ground
    return Array.from({ length: n * n }, (_, i) => {
      const data = buildChunkGeometry(layers, i, DEFAULT_PALETTE, surface)
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(data.positions, 3).setUsage(DynamicDrawUsage))
      geometry.setAttribute('color', new BufferAttribute(data.colors, 3).setUsage(DynamicDrawUsage))
      geometry.setIndex(new BufferAttribute(data.indices, 1))
      geometry.computeBoundingSphere()
      return { data, geometry }
    })
  }, [terrain])
  useEffect(() => () => chunks.forEach((c) => c.geometry.dispose()), [chunks])

  useFrame(() => {
    for (const i of terrain.takeDirtyChunks('mesh')) {
      const c = chunks[i]
      if (!c) continue
      updateChunkGeometry(terrain.ground.layers, i, DEFAULT_PALETTE, c.data, terrain.ground.surface)
      c.geometry.getAttribute('position').needsUpdate = true
      c.geometry.getAttribute('color').needsUpdate = true
      c.geometry.computeBoundingSphere()
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
