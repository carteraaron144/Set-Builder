import { useEffect, useMemo, useState } from 'react'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { loadAssetLibrary, type AssetLibrary } from './assets/assetLibrary'
import { browserDeps } from './editor/browserDeps'
import { useEditorStore } from './editor/editorStore'
import { BrushPanel } from './editor/BrushPanel'
import { ExportDialog } from './editor/ExportDialog'
import { NewSceneDialog } from './editor/NewSceneDialog'
import { OpenSceneDialog } from './editor/OpenSceneDialog'
import {
  downloadCurrent,
  exportCurrent,
  loadInitialScene,
  newScene,
  openScene,
  saveCurrent,
  uploadSceneFile,
} from './editor/sceneActions'
import { installEditorShortcuts } from './editor/shortcuts'
import { ToolBar } from './editor/ToolBar'
import { TopBar } from './editor/TopBar'
import { Viewport } from './viewport/Viewport'
import { ViewportErrorBoundary } from './viewport/ViewportErrorBoundary'

type Dialog = 'new' | 'open' | 'export' | null

export const SCATTER_ASSETS_MESSAGE = "Scatter assets couldn't be loaded; showing terrain only."

export default function App() {
  const deps = useMemo(() => browserDeps(useEditorStore), [])
  const scene = useEditorStore((s) => s.scene)
  const terrain = useEditorStore((s) => s.terrain)
  const dirty = useEditorStore((s) => s.dirty)
  const setRenderBackend = useEditorStore((s) => s.setRenderBackend)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [library, setLibrary] = useState<AssetLibrary | null>(null)

  useEffect(() => {
    let live = true
    void loadAssetLibrary({
      fetch: (input, init) => fetch(input, init),
      parseGlb: (bytes) => new GLTFLoader().parseAsync(bytes, '').then((g) => g.scene),
    }).then((lib) => {
      if (!live) return
      setLibrary(lib)
      if (lib.problems.length) useEditorStore.getState().setMessage({ kind: 'info', text: SCATTER_ASSETS_MESSAGE })
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    void loadInitialScene(deps)
  }, [deps])

  useEffect(
    () =>
      installEditorShortcuts(window, {
        save: () => void saveCurrent(deps),
        undo: () => useEditorStore.getState().undo(),
        redo: () => useEditorStore.getState().redo(),
        resizeBrush: (f) => useEditorStore.getState().resizeBrush(f),
        deselectTool: () => useEditorStore.getState().setTool(null),
      }),
    [deps],
  )

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
        onExport={() => setDialog('export')}
      />
      <main className="viewport-area">
        <ViewportErrorBoundary>
          <Viewport scene={scene} terrain={terrain} library={library} onBackend={setRenderBackend} />
        </ViewportErrorBoundary>
        <BrushPanel />
        <ToolBar />
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
      {dialog === 'export' && (
        <ExportDialog
          onCancel={() => setDialog(null)}
          onExport={async (options) => {
            const scatter = useEditorStore.getState().scatterManager
            await exportCurrent({ ...deps, library, scatter }, options)
            setDialog(null)
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
