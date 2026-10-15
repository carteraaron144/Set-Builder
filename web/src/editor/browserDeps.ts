import type { StoreApi } from 'zustand'
import { openSceneStore, type SceneStore } from '../persistence/sceneStore'
import type { EditorState } from './editorStore'
import type { ActionDeps } from './sceneActions'

/** ActionDeps backed by the real browser: IndexedDB, window.confirm and an <a download> click. */
export function browserDeps(store: StoreApi<EditorState>): ActionDeps {
  let opening: Promise<SceneStore> | null = null
  return {
    store,
    sceneStore: () => {
      if (!opening) {
        opening = openSceneStore()
        // Retry on the next call rather than caching a failure (storage may be unblocked later).
        opening.catch(() => {
          opening = null
        })
      }
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
