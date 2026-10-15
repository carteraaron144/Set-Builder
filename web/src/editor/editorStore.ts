import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { createScene, renameScene, type Scene } from '../scene/scene'
import type { RenderBackend } from '../viewport/renderBackend'

export type Message = { kind: 'error' | 'info'; text: string } | null

export interface EditorState {
  scene: Scene
  /** True when the scene has changes that are not in browser storage. */
  dirty: boolean
  renderBackend: RenderBackend | null
  message: Message
  /** Shows another scene; clears dirty. */
  replaceScene(scene: Scene): void
  rename(name: string): void
  markSaved(): void
  setRenderBackend(b: RenderBackend): void
  setMessage(m: Message): void
}

const initializer =
  (initialScene: () => Scene) =>
  (set: StoreApi<EditorState>['setState'], get: StoreApi<EditorState>['getState']): EditorState => ({
    scene: initialScene(),
    dirty: false,
    renderBackend: null,
    message: null,
    replaceScene: (scene) => set({ scene, dirty: false }),
    rename: (name) => {
      const { scene } = get()
      const renamed = renameScene(scene, name)
      if (renamed.name === scene.name) return
      set({ scene: renamed, dirty: true })
    },
    markSaved: () => set({ dirty: false }),
    setRenderBackend: (renderBackend) => set({ renderBackend }),
    setMessage: (message) => set({ message }),
  })

/** A standalone store (tests, tools). The app uses useEditorStore. */
export function createEditorStore(scene: Scene = createScene({ size: 128 })): StoreApi<EditorState> {
  return createStore<EditorState>()(initializer(() => scene))
}

export const useEditorStore: UseBoundStore<StoreApi<EditorState>> = create<EditorState>()(
  initializer(() => createScene({ size: 128 })),
)
