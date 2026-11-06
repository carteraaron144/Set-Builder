import type { StoreApi } from 'zustand'
import { createHttpSceneStore } from '../persistence/httpSceneStore'
import { importBrowserScenes } from '../persistence/importBrowserScenes'
import type { SceneStore } from '../persistence/sceneStore'
import type { EditorState } from './editorStore'
import type { ActionDeps } from './sceneActions'

/** ActionDeps backed by the real browser: the server's /api/sets, window.confirm and an <a download> click. */
export function browserDeps(store: StoreApi<EditorState>): ActionDeps {
  let opening: Promise<SceneStore> | undefined
  return {
    store,
    sceneStore: () => {
      // The first use moves any scenes saved in this browser's storage up to the server.
      opening ??= (async () => {
        const remote = createHttpSceneStore()
        await importBrowserScenes(remote)
        return remote
      })()
      return opening
    },
    confirmDiscard: () =>
      window.confirm(`Discard unsaved changes to "${store.getState().scene.name}"?`),
    download: (filename, bytes) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  }
}
