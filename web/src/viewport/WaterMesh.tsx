import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { BufferAttribute, BufferGeometry, MeshStandardMaterial } from 'three'
import { buildWater, WATER_MATERIAL } from '../features/water'
import type { TerrainEditor } from '../terrain/terrainEditor'

/** River and pond water: one mesh each, rebuilt whenever the terrain's water version changes. */
export function WaterMesh({ terrain }: { terrain: TerrainEditor }) {
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        name: WATER_MATERIAL.name,
        color: WATER_MATERIAL.color,
        opacity: WATER_MATERIAL.opacity,
        transparent: true,
        depthWrite: false,
        flatShading: true,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  const [version, setVersion] = useState(terrain.waterVersion)
  useFrame(() => {
    if (terrain.waterVersion !== version) setVersion(terrain.waterVersion)
  })

  const meshes = useMemo(() => {
    void version
    return buildWater(terrain.ground).map((w) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(w.positions, 3))
      geometry.setIndex(new BufferAttribute(w.indices, 1))
      geometry.computeVertexNormals()
      geometry.computeBoundingSphere()
      return { name: w.name, geometry }
    })
  }, [terrain, version])
  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes])

  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.name} name={m.name} geometry={m.geometry} material={material} renderOrder={1} receiveShadow />
      ))}
    </group>
  )
}
