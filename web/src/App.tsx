import { useEffect, useMemo, useState } from 'react'
import { browserDeps } from './editor/browserDeps'
import { useEditorStore } from './editor/editorStore'
import { NewSceneDialog } from './editor/NewSceneDialog'
import { OpenSceneDialog } from './editor/OpenSceneDialog'
import {
  downloadCurrent,
  loadInitialScene,
  newScene,
  openScene,
  saveCurrent,
  uploadSceneFile,
} from './editor/sceneActions'
import { TopBar } from './editor/TopBar'
import { Viewport } from './viewport/Viewport'
import { ViewportErrorBoundary } from './viewport/ViewportErrorBoundary'

type Dialog = 'new' | 'open' | null

export default function App() {
  const deps = useMemo(() => browserDeps(useEditorStore), [])
  const scene = useEditorStore((s) => s.scene)
  const dirty = useEditorStore((s) => s.dirty)
  const setRenderBackend = useEditorStore((s) => s.setRenderBackend)
  const [dialog, setDialog] = useState<Dialog>(null)

  useEffect(() => {
    void loadInitialScene(deps)
  }, [deps])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveCurrent(deps)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deps])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  return (
    <div className="app">
      <TopBar
        onNew={() => setDialog('new')}
        onOpen={() => setDialog('open')}
        onSave={() => void saveCurrent(deps)}
        onDownload={() => downloadCurrent(deps)}
        onUpload={(file) => void uploadSceneFile(deps, file)}
      />
      <main className="viewport-area">
        <ViewportErrorBoundary>
          <Viewport scene={scene} onBackend={setRenderBackend} />
        </ViewportErrorBoundary>
      </main>
      {dialog === 'new' && (
        <NewSceneDialog
          onCancel={() => setDialog(null)}
          onCreate={(name, size) => {
            setDialog(null)
            newScene(deps, name, size)
          }}
        />
      )}
      {dialog === 'open' && (
        <OpenSceneDialog
          sceneStore={deps.sceneStore}
          onCancel={() => setDialog(null)}
          onOpen={(id) => {
            setDialog(null)
            void openScene(deps, id)
          }}
        />
      )}
    </div>
  )
}
