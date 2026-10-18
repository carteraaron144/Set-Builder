import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Raycaster, Vector2 } from 'three'
import { isBrushTool, useEditorStore } from '../editor/editorStore'
import { is3dMode } from '../terrain/brush3d'
import { HoldPoint } from '../terrain/holdPoint'
import type { StrokeTool, TerrainEditor } from '../terrain/terrainEditor'
import { BrushInput, type BrushPoint } from '../tools/brushInput'
import { BrushCursor } from './BrushCursor'

/** Wires left-drag on the canvas to the terrain editor using the store's tool and brush settings. */
export function BrushRig({ terrain }: { terrain: TerrainEditor }) {
  const camera = useThree((s) => s.camera)
  const element = useThree((s) => s.gl.domElement) as HTMLCanvasElement
  const hover = useRef<BrushPoint | null>(null)
  const inputRef = useRef<BrushInput | null>(null)

  // Created in an effect (not useMemo) so StrictMode's mount/unmount/mount gets a live instance after dispose.
  useEffect(() => {
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    // A 3D stroke re-picks the live terrain as the pointer moves, but holds still while it doesn't so Add doesn't climb.
    const hold = new HoldPoint<BrushPoint>()
    let holding = false
    let limitShown = false
    const pick = (clientX: number, clientY: number): BrushPoint | null => {
      const r = element.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const cast = (): BrushPoint | null => {
        const hit = terrain.ground.raycast(raycaster.ray.origin, raycaster.ray.direction, terrain.stroking && useEditorStore.getState().hideCavesWhileStroking)
        return hit ? { x: hit.x, y: hit.y, z: hit.z } : null
      }
      return holding ? hold.resolve(clientX, clientY, cast) : cast()
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
        limitShown = false
        hold.reset()
        holding = s.tool === 'terrain' && is3dMode(s.terrainMode)
      },
      dab: (at, dt, altKey) => {
        const s = useEditorStore.getState()
        const invert = altKey !== s.invertToggle
        if (s.tool === 'terrain' && is3dMode(s.terrainMode)) {
          if (terrain.dab3({ x: at.x, y: at.y ?? 0, z: at.z }, dt, invert) === 'limit' && !limitShown) {
            limitShown = true
            s.setMessage({ kind: 'error', text: 'Volume limit reached' })
          }
        } else terrain.dab(at, dt, invert)
      },
      end: () => {
        holding = false
        hold.reset()
        terrain.endStroke()
      },
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
