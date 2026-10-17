import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshStandardMaterial } from 'three'
import { chunkCount, updateChunkGeometry, type ChunkGeometry } from '../terrain/chunks'
import type { Ground } from '../features/ground'
import { buildOverhangGeometry } from '../terrain/overhang'
import { DEFAULT_PALETTE } from '../terrain/palette'
import type { TerrainEditor } from '../terrain/terrainEditor'
import { useEditorStore } from '../editor/editorStore'
import { CaveHider } from './caveHider'
import { overhangsToBuild } from './overhangUpdates'
import { RemeshThrottle } from './remeshThrottle'
import { caveMeshRequest } from '../features/caveMesh'
import { CaveMeshManager } from './caveMeshManager'
import { createCaveMeshRunner } from './caveMeshRunner'

interface Chunk {
  data: ChunkGeometry
  geometry: BufferGeometry
  /** Meshed from the density field: its vertex count changes, so it gets new buffers instead of updates. */
  sdf: boolean
  /** Grass overhangs along cliff tops, rebuilt whenever the chunk changes while the setting is on. */
  lip: BufferGeometry
  /** Whether the lip has any triangles; an empty one stays hidden rather than uploading empty buffers. */
  hasLip: boolean
}

function setBuffers(geometry: BufferGeometry, data: ChunkGeometry): void {
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3).setUsage(DynamicDrawUsage))
  geometry.setAttribute('color', new BufferAttribute(data.colors, 3).setUsage(DynamicDrawUsage))
  geometry.setIndex(new BufferAttribute(data.indices, 1))
  geometry.computeBoundingSphere()
}

function updateLip(ground: Ground, c: Chunk, i: number): void {
  const data = buildOverhangGeometry(ground.layers, i, DEFAULT_PALETTE, ground.surface)
  c.hasLip = data.indices.length > 0
  if (c.hasLip) setBuffers(c.lip, data)
}

function updateInPlace(ground: Ground, c: Chunk, i: number): void {
  updateChunkGeometry(ground.layers, i, DEFAULT_PALETTE, c.data, ground.surface)
  c.geometry.getAttribute('position').needsUpdate = true
  c.geometry.getAttribute('color').needsUpdate = true
  c.geometry.computeBoundingSphere()
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
      return { data, geometry, sdf: ground.isSdfChunk(i), lip: new BufferGeometry(), hasLip: false }
    })
  }, [terrain])
  useEffect(
    () => () =>
      chunks.forEach((c) => {
        c.geometry.dispose()
        c.lip.dispose()
      }),
    [chunks],
  )
  const lipMeshes = useRef<(Mesh | null)[]>([])
  // Overhangs are built from scratch whenever the setting turns on, including for a fresh set of chunks.
  const lipsWereOn = useRef(false)
  useEffect(() => {
    lipsWereOn.current = false
  }, [chunks])

  const throttle = useMemo(() => new RemeshThrottle(0), [terrain])
  const hider = useMemo(() => new CaveHider(), [terrain])
  // Chunks that caves reach are meshed in a pool of Workers; their old mesh stays up until the new one arrives.
  const caveMesher = useMemo(() => {
    const runner = createCaveMeshRunner()
    const manager = new CaveMeshManager(runner.run, (id, ids) => caveMeshRequest(id, terrain.ground, ids), runner.workers)
    return { manager, dispose: runner.dispose }
  }, [terrain])
  useEffect(
    () => () => {
      caveMesher.manager.dispose()
      caveMesher.dispose()
    },
    [caveMesher],
  )

  useFrame(() => {
    const { ground } = terrain
    const settings = useEditorStore.getState()
    // The settings menu picks the wait; Off (0) remeshes every frame.
    throttle.minInterval = settings.caveRemeshDelay
    const hasCave = (i: number) => chunks[i]?.sdf || ground.isSdfChunk(i)
    const dirty = terrain.takeDirtyChunks('mesh')
    // Overhangs come from the heightmap alone, so they follow every change straight away, caves or not.
    const lipsOn = settings.grassOverhangs
    for (const i of overhangsToBuild(lipsOn, lipsWereOn.current, dirty, chunks.length)) if (chunks[i]) updateLip(ground, chunks[i], i)
    lipsWereOn.current = lipsOn
    chunks.forEach((c, i) => {
      const m = lipMeshes.current[i]
      if (m) m.visible = lipsOn && c.hasLip
    })
    const { hide, flush, normal } = hider.split(terrain.stroking && settings.hideCavesWhileStroking, dirty, hasCave)

    // While a stroke ignores caves, its chunks are plain heightmap, updated in place.
    caveMesher.manager.discard(hide)
    for (const i of hide) {
      const c = chunks[i]
      if (!c) continue
      if (c.sdf) {
        c.data = ground.chunkGeometry(i, DEFAULT_PALETTE, true)
        c.sdf = false
        setBuffers(c.geometry, c.data)
        continue
      }
      updateInPlace(ground, c, i)
    }

    // When it ends, every chunk it hid gets its caves back in the same frame.
    caveMesher.manager.request(flush.filter((i) => chunks[i]))

    for (const i of normal) {
      const c = chunks[i]
      if (!c) continue
      if (c.sdf || ground.isSdfChunk(i)) {
        // Density-field remeshes are slow, so they are queued and spaced out by the settings delay.
        throttle.add([i])
        continue
      }
      updateInPlace(ground, c, i)
    }
    const due = throttle.take(performance.now())
    if (due.length > 0) {
      caveMesher.manager.request(due)
      throttle.finished(performance.now(), 0)
    }
    caveMesher.manager.pump()
    for (const r of caveMesher.manager.take()) {
      const c = chunks[r.chunk]
      if (!c) continue
      c.data = r.geometry
      c.sdf = r.sdf
      setBuffers(c.geometry, c.data)
    }
  })

  return (
    <group>
      {chunks.map((c, i) => (
        <mesh key={i} geometry={c.geometry} material={material} castShadow receiveShadow />
      ))}
      {chunks.map((c, i) => (
        <mesh
          key={`lip${i}`}
          ref={(m) => {
            lipMeshes.current[i] = m
          }}
          geometry={c.lip}
          material={material}
          visible={false}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  )
}
