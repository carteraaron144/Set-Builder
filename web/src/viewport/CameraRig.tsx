import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { CameraInput } from '../camera/cameraInput'
import {
  cameraLimits,
  cameraPosition,
  defaultCameraState,
  type CameraState,
  type GroundPoint,
} from '../camera/overheadCamera'
import type { Scene } from '../scene/scene'

const GROUND = new Plane(new Vector3(0, 1, 0), 0)

/** Owns the camera state and input for a scene; resets when a different scene is shown. */
export function CameraRig({ scene }: { scene: Scene }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const element = gl.domElement as HTMLCanvasElement
  const limits = useMemo(() => cameraLimits(scene.size), [scene.size])
  const stateRef = useRef<CameraState>(defaultCameraState(scene.size))

  useEffect(() => {
    stateRef.current = defaultCameraState(scene.size)
  }, [scene.id, scene.size])

  const inputRef = useRef<CameraInput | null>(null)

  // Created in an effect (not useMemo) so StrictMode's mount/unmount/mount gets a live instance after dispose.
  useEffect(() => {
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const hit = new Vector3()
    const pickGround = (clientX: number, clientY: number): GroundPoint | null => {
      const r = element.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(GROUND, hit) ? { x: hit.x, z: hit.z } : null
    }
    const input = new CameraInput({
      element,
      getState: () => stateRef.current,
      setState: (s) => {
        stateRef.current = s
      },
      limits: () => limits,
      pickGround,
    })
    inputRef.current = input
    return () => {
      input.dispose()
      if (inputRef.current === input) inputRef.current = null
    }
  }, [element, camera, limits])

  useFrame((_, delta) => {
    inputRef.current?.update(Math.min(delta, 0.1))
    const s = stateRef.current
    const p = cameraPosition(s)
    camera.position.set(p.x, p.y, p.z)
    camera.lookAt(s.target.x, 0, s.target.z)
  })

  return null
}
