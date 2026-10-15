import type { StoreApi } from 'zustand'
import type { SceneStore } from '../persistence/sceneStore'
import { createScene, type SceneSize } from '../scene/scene'
import { readSceneFile, SCENE_FILE_EXTENSION, SceneFileError, writeSceneFile } from '../scene/sceneFile'
import { createFlatLayers } from '../terrain/layers'
import type { EditorState } from './editorStore'

export interface ActionDeps {
  store: StoreApi<EditorState>
  /** Lazily opened; may reject with StorageUnavailableError. */
  sceneStore: () => Promise<SceneStore>
  /** Asks before discarding unsaved changes (window.confirm in the app). */
  confirmDiscard: () => boolean
  download: (filename: string, bytes: Uint8Array) => void
}

export const MESSAGES = {
  saved: 'Saved',
  storageFailed: "Couldn't save in this browser (storage is blocked or full). Use Download to keep a copy.",
  openFailed: "Couldn't open that scene from this browser's storage.",
  notFound: "That saved scene couldn't be found.",
  notAScene: "That file isn't a Set Builder scene.",
  newerVersion: 'That scene was made with a newer version of Set Builder.',
  unreadableFile: "Couldn't read that file.",
} as const

function canDiscard(deps: ActionDeps): boolean {
  return !deps.store.getState().dirty || deps.confirmDiscard()
}

export function newScene(deps: ActionDeps, name: string, size: SceneSize): void {
  if (!canDiscard(deps)) return
  const { replaceScene, setMessage } = deps.store.getState()
  replaceScene(createScene({ name, size }))
  setMessage(null)
}

export async function saveCurrent(deps: ActionDeps): Promise<void> {
  const scene = deps.store.getState().scene
  try {
    const sceneStore = await deps.sceneStore()
    await sceneStore.save(scene)
  } catch {
    deps.store.getState().setMessage({ kind: 'error', text: MESSAGES.storageFailed })
    return
  }
  const state = deps.store.getState()
  // Edits made while the write was in flight are still unsaved.
  if (state.scene === scene) state.markSaved()
  state.setMessage({ kind: 'info', text: MESSAGES.saved })
}

export async function openScene(deps: ActionDeps, id: string): Promise<void> {
  let scene
  try {
    scene = await (await deps.sceneStore()).load(id)
  } catch {
    deps.store.getState().setMessage({ kind: 'error', text: MESSAGES.openFailed })
    return
  }
  if (!scene) {
    deps.store.getState().setMessage({ kind: 'error', text: MESSAGES.notFound })
    return
  }
  if (!canDiscard(deps)) return
  const { replaceScene, setMessage } = deps.store.getState()
  replaceScene(scene)
  setMessage(null)
}

export async function uploadSceneFile(deps: ActionDeps, file: File): Promise<void> {
  let scene
  try {
    scene = readSceneFile(new Uint8Array(await file.arrayBuffer())).scene
  } catch (e) {
    const text =
      e instanceof SceneFileError
        ? e.reason === 'newer-version'
          ? MESSAGES.newerVersion
          : MESSAGES.notAScene
        : MESSAGES.unreadableFile
    deps.store.getState().setMessage({ kind: 'error', text })
    return
  }
  if (!canDiscard(deps)) return
  const { replaceScene, setMessage } = deps.store.getState()
  replaceScene(scene)
  setMessage(null)
}

export function sceneFilename(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (slug || 'scene') + SCENE_FILE_EXTENSION
}

export function downloadCurrent(deps: ActionDeps): void {
  const { scene } = deps.store.getState()
  deps.download(sceneFilename(scene.name), writeSceneFile(scene, createFlatLayers(scene.size)))
}

/** On startup: shows the newest saved scene, else keeps the new one. Storage problems are left for Save to report. */
export async function loadInitialScene(deps: ActionDeps): Promise<void> {
  try {
    const sceneStore = await deps.sceneStore()
    const [newest] = await sceneStore.list()
    if (!newest) return
    const scene = await sceneStore.load(newest.id)
    // Don't replace a scene the user has already started editing.
    if (scene && !deps.store.getState().dirty) deps.store.getState().replaceScene(scene)
  } catch {
    // Storage unavailable: start with the new scene.
  }
}
