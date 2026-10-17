import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { WebGPURenderer } from 'three/webgpu'
import type { AssetLibrary } from '../assets/assetLibrary'
import type { Scene } from '../scene/scene'
import type { TerrainEditor } from '../terrain/terrainEditor'
import { CameraRig } from './CameraRig'
import { CaveGlow } from './CaveGlow'
import { FeatureRig } from './FeatureRig'
import { SelectRig } from './SelectRig'
import { BrushRig } from './BrushRig'
import { browserSupport, detectSupport, forcedBackend, type RenderBackend } from './renderBackend'
import { ScatterMesh } from './ScatterMesh'
import { ChunkGrid } from './ChunkGrid'
import { TerrainMesh } from './TerrainMesh'
import { WaterMesh } from './WaterMesh'

export function Viewport({
  scene,
  terrain,
  library,
  onBackend,
}: {
  scene: Scene
  terrain: TerrainEditor
  library?: AssetLibrary | null
  onBackend(b: RenderBackend): void
}) {
  const forceWebGL = useMemo(() => forcedBackend(window.location.search) === 'webgl2', [])
  const support = useMemo(() => {
    const env = browserSupport()
    return detectSupport(forceWebGL ? { webgl2: env.webgl2 } : env)
  }, [forceWebGL])
  const onBackendRef = useRef(onBackend)
  useEffect(() => {
    onBackendRef.current = onBackend
  }, [onBackend])

  if (support === 'none') {
    return (
      <div className="viewport viewport-unsupported" role="alert">
        Set Builder needs a browser with WebGPU or WebGL2.
      </div>
    )
  }

  const sun = scene.size * 0.6

  return (
    <div className="viewport">
      <Canvas
        shadows="percentage"
        camera={{ fov: 45, near: 0.1, far: 2000 }}
        gl={async (props) => {
          // WebGPURenderer falls back to a WebGL2 backend by itself when WebGPU is unavailable.
          const renderer = new WebGPURenderer({ ...(props as object), antialias: true, forceWebGL })
          await renderer.init()
          onBackendRef.current((renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2')
          return renderer
        }}
      >
        <color attach="background" args={['#a9c7e0']} />
        <hemisphereLight args={['#dfeeff', '#4a5a3a', 0.9]} />
        <directionalLight
          position={[sun, sun * 1.4, sun * 0.8]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-scene.size * 0.75}
          shadow-camera-right={scene.size * 0.75}
          shadow-camera-top={scene.size * 0.75}
          shadow-camera-bottom={-scene.size * 0.75}
          shadow-camera-far={scene.size * 4}
        />
        <CameraRig scene={scene} terrain={terrain} />
        {/* BrushRig before TerrainMesh: a frame's dab is meshed in the same frame. */}
        <BrushRig terrain={terrain} />
        <TerrainMesh terrain={terrain} />
        <CaveGlow terrain={terrain} />
        <ChunkGrid terrain={terrain} />
        <WaterMesh terrain={terrain} />
        <FeatureRig terrain={terrain} scene={scene} />
        <SelectRig terrain={terrain} scene={scene} />
        {library && <ScatterMesh terrain={terrain} scene={scene} library={library} />}
      </Canvas>
    </div>
  )
}
