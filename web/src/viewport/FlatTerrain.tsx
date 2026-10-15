import { useMemo } from 'react'
import { GridHelper } from 'three'
import type { SceneSize } from '../scene/scene'

const GRID_SPACING = 8 // metres

/** M0 terrain: a flat size × size plane at y = 0, centred on the origin, with a faint grid. */
export function FlatTerrain({ size }: { size: SceneSize }) {
  const grid = useMemo(() => {
    const g = new GridHelper(size, size / GRID_SPACING, '#3f5a2e', '#3f5a2e')
    g.position.y = 0.02
    const materials = Array.isArray(g.material) ? g.material : [g.material]
    for (const m of materials) {
      m.transparent = true
      m.opacity = 0.35
      m.depthWrite = false
    }
    return g
  }, [size])

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#6b8f4e" flatShading />
      </mesh>
      <primitive object={grid} />
    </group>
  )
}
