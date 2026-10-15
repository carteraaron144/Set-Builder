import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { DynamicDrawUsage, Group, InstancedMesh } from 'three'
import type { AssetLibrary } from '../assets/assetLibrary'
import { assetInfoOf } from '../assets/assetLibrary'
import { useEditorStore } from '../editor/editorStore'
import type { Scene } from '../scene/scene'
import { writeInstanceMatrices } from '../scatter/instanceMatrices'
import type { Instance } from '../scatter/scatter'
import { ScatterManager } from '../scatter/scatterManager'
import { createWorkerRunner } from '../scatter/workerRunner'
import type { TerrainEditor } from '../terrain/terrainEditor'

export const DENSITY_MESSAGE = 'Scatter is at its density limit in some areas.'

interface Slot {
  mesh: InstancedMesh
  capacity: number
}

/** One InstancedMesh per (asset, part); matrices are rewritten whenever the scatter manager applies new results. */
export function ScatterMesh({ terrain, scene, library }: { terrain: TerrainEditor; scene: Scene; library: AssetLibrary }) {
  const [root] = useState(() => new Group())
  const ref = useRef<Group>(null)
  const managerRef = useRef<ScatterManager | null>(null)
  const slots = useRef(new Map<string, Slot>())
  const applied = useRef(-1)
  const sceneRef = useRef(scene)
  useEffect(() => {
    sceneRef.current = scene
  }, [scene])
  const { id, seed, size, generatorVersion } = scene

  // Created in an effect so StrictMode's double mount gets a live manager and Worker.
  useEffect(() => {
    const runner = createWorkerRunner()
    const manager = new ScatterManager(terrain, { ...sceneRef.current, id, seed, size, generatorVersion }, runner.run, assetInfoOf(library), {
      onCapped: (capped) => {
        if (capped) useEditorStore.getState().setMessage({ kind: 'info', text: DENSITY_MESSAGE })
      },
    })
    managerRef.current = manager
    useEditorStore.getState().setScatterManager(manager)
    applied.current = -1
    const owned = slots.current
    return () => {
      manager.dispose()
      runner.dispose()
      if (managerRef.current === manager) managerRef.current = null
      if (useEditorStore.getState().scatterManager === manager) useEditorStore.getState().setScatterManager(null)
      for (const s of owned.values()) {
        s.mesh.removeFromParent()
        s.mesh.dispose()
      }
      owned.clear()
    }
  }, [terrain, library, id, seed, size, generatorVersion])

  useFrame(() => {
    const group = ref.current
    const manager = managerRef.current
    if (!group || !manager) return
    group.visible = useEditorStore.getState().scatterVisible
    manager.pump()
    if (manager.version === applied.current) return
    applied.current = manager.version

    const rules = manager.ruleList.rules
    const byRule = manager.instancesByRule()
    const byAsset = new Map<string, { instances: Instance[]; castShadow: boolean }>()
    rules.forEach((r, i) => {
      const entry = byAsset.get(r.asset) ?? { instances: [], castShadow: false }
      entry.instances.push(...byRule[i])
      entry.castShadow ||= r.castShadow
      byAsset.set(r.asset, entry)
    })

    for (const [key, { instances, castShadow }] of byAsset) {
      const asset = library.assets.get(key)
      if (!asset) continue
      let matrices: Float32Array | null = null
      for (const part of asset.parts) {
        const slotKey = `${key}|${part.slot}`
        let slot = slots.current.get(slotKey)
        if (!slot || slot.capacity < instances.length) {
          const capacity = Math.max(64, instances.length, (slot?.capacity ?? 0) * 2)
          if (slot) {
            slot.mesh.removeFromParent()
            slot.mesh.dispose()
          }
          const mesh = new InstancedMesh(part.geometry, library.materials[part.slot], capacity)
          mesh.instanceMatrix.setUsage(DynamicDrawUsage)
          mesh.castShadow = castShadow
          mesh.receiveShadow = true
          group.add(mesh)
          slot = { mesh, capacity }
          slots.current.set(slotKey, slot)
        }
        if (!matrices) {
          matrices = new Float32Array(instances.length * 16)
          writeInstanceMatrices(instances, matrices)
        }
        slot.mesh.instanceMatrix.array.set(matrices)
        slot.mesh.count = instances.length
        slot.mesh.instanceMatrix.needsUpdate = true
        slot.mesh.computeBoundingSphere()
      }
    }
  })

  return <primitive ref={ref} object={root} />
}
