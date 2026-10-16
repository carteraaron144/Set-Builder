import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { useEditorStore } from '../editor/editorStore'
import type { CaveProfile } from '../features/caves'
import { chunkCount } from '../terrain/chunks'
import type { TerrainEditor } from '../terrain/terrainEditor'

/** Sky blue, drawn over the terrain. */
const GLOW_COLOR = '#87ceeb'
const GLOW_OPACITY = 0.45

const sameCaves = (a: CaveProfile[], b: CaveProfile[]) => a.length === b.length && a.every((c, i) => c === b[i])

/**
 * While a stroke ignores caves, shows them as a sky-blue glow seen through the terrain, so you can sculpt around
 * them. The cave meshes are built once the option is on and again when the caves change.
 */
export function CaveGlow({ terrain }: { terrain: TerrainEditor }) {
  const group = useRef<Group>(null)
  const material = useMemo(
    () => new MeshBasicMaterial({ color: GLOW_COLOR, transparent: true, opacity: GLOW_OPACITY, depthTest: false, depthWrite: false }),
    [],
  )
  const built = useRef<CaveProfile[] | null>(null)

  const clear = () => {
    const g = group.current
    if (!g) return
    for (const m of [...g.children] as Mesh[]) {
      g.remove(m)
      m.geometry.dispose()
    }
    built.current = null
  }
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => clear, [terrain]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const g = group.current
    if (!g) return
    const settings = useEditorStore.getState()
    g.visible = terrain.stroking && settings.hideCavesWhileStroking
    if (!settings.hideCavesWhileStroking) return
    const { ground } = terrain
    if (built.current && sameCaves(built.current, ground.caves)) return
    clear()
    built.current = ground.caves
    const n = chunkCount(ground.layers.heights.size)
    for (let i = 0; i < n * n; i++) {
      const glow = ground.caveGlowGeometry(i)
      if (!glow) continue
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(glow.positions, 3))
      geometry.setIndex(new BufferAttribute(glow.indices, 1))
      const mesh = new Mesh(geometry, material)
      mesh.renderOrder = 10
      mesh.frustumCulled = false
      g.add(mesh)
    }
  })

  return <group ref={group} visible={false} />
}
