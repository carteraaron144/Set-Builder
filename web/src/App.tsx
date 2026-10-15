import { useState } from 'react'
import { createScene } from './scene/scene'
import type { RenderBackend } from './viewport/renderBackend'
import { Viewport } from './viewport/Viewport'

export default function App() {
  const [scene] = useState(() => createScene({ size: 128 }))
  const [backend, setBackend] = useState<RenderBackend | null>(null)

  return (
    <div className="app">
      <header className="top-bar">
        <span className="app-name">Set Builder</span>
        {backend === 'webgl2' && <span className="badge">WebGL2 fallback</span>}
      </header>
      <main className="viewport-area">
        <Viewport scene={scene} onBackend={setBackend} />
      </main>
    </div>
  )
}
