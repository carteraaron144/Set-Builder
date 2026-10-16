import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Raycaster, Vector2 } from 'three'
import type { GroundPoint } from '../camera/overheadCamera'
import { isBrushTool, useEditorStore } from '../editor/editorStore'
import type { StrokeTool, TerrainEditor } from '../terrain/terrainEditor'
import { BrushInput } from '../tools/brushInput'
import { BrushCursor } from './BrushCursor'

/** Wires left-drag on the canvas to the terrain editor using the store's tool and brush settings. */
export function BrushRig({ terrain }: { terrain: TerrainEditor }) {
  const camera = useThree((s) => s.camera)
  const element = useThree((s) => s.gl.domElement) as HTMLCanvasElement
  const hover = useRef<GroundPoint | null>(null)
  const inputRef = useRef<BrushInput | null>(null)

  // Created in an effect (not useMemo) so StrictMode's mount/unmount/mount gets a live instance after dispose.
  useEffect(() => {
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const pick = (clientX: number, clientY: number): GroundPoint | null => {
      const r = element.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = terrain.ground.raycast(raycaster.ray.origin, raycaster.ray.direction)
      return hit ? { x: hit.x, z: hit.z } : null
    }
    const input = new BrushInput({
      element,
      active: () => isBrushTool(useEditorStore.getState().tool),
      pick,
      begin: (at) => {
        const s = useEditorStore.getState()
        const tool: StrokeTool =
          s.tool === 'paint'
            ? { tool: 'paint', biome: s.biome }
            : { tool: 'terrain', mode: s.terrainMode, terraceStep: s.terraceStep }
        terrain.beginStroke(tool, s.brush, at)
      },
      dab: (at, dt, altKey) => terrain.dab(at, dt, altKey !== useEditorStore.getState().invertToggle),
      end: () => terrain.endStroke(),
      hover: (at) => {
        hover.current = at
      },
    })
    inputRef.current = input
    return () => {
      input.dispose()
      if (inputRef.current === input) inputRef.current = null
    }
  }, [element, camera, terrain])

  useFrame((_, delta) => {
    inputRef.current?.update(Math.min(delta, 0.1))
  })

  return <BrushCursor terrain={terrain} hover={hover} />
}
