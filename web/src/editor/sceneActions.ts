import type { StoreApi } from 'zustand'
import type { SceneStore } from '../persistence/sceneStore'
import { createScene, type SceneSize } from '../scene/scene'
import { readSceneFile, SCENE_FILE_EXTENSION, SceneFileError, writeSceneFile } from '../scene/sceneFile'
import { cloneLayers } from '../terrain/layers'
import type { Object3D } from 'three'
import { assetInfoOf, type AssetLibrary } from '../assets/assetLibrary'
import { writeGlb as defaultWriteGlb } from '../export/exportGlb'
import { buildExportScene, type ExportOptions } from '../export/exportScene'
import { rulesFor } from '../scatter/rules'
import { scatterChunk, type Instance } from '../scatter/scatter'
import { chunkCount } from '../terrain/chunks'
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
  damaged: 'That scene file is damaged: its terrain data is missing or the wrong size.',
  damagedSaved: "That saved scene is damaged and can't be opened.",
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
  // Copy before the first await: strokes keep mutating the live layers while the write is in flight.
  const { scene, editVersion, terrain } = deps.store.getState()
  const layers = cloneLayers(terrain.layers)
  try {
    const sceneStore = await deps.sceneStore()
    await sceneStore.save(scene, layers)
  } catch {
    deps.store.getState().setMessage({ kind: 'error', text: MESSAGES.storageFailed })
    return
  }
  const state = deps.store.getState()
  // Edits made while the write was in flight are still unsaved.
  if (state.scene === scene && state.editVersion === editVersion) state.markSaved()
  state.setMessage({ kind: 'info', text: MESSAGES.saved })
}

export async function openScene(deps: ActionDeps, id: string): Promise<void> {
  let contents
  try {
    contents = await (await deps.sceneStore()).load(id)
  } catch (e) {
    const text = e instanceof SceneFileError && e.reason === 'invalid-layers' ? MESSAGES.damagedSaved : MESSAGES.openFailed
    deps.store.getState().setMessage({ kind: 'error', text })
    return
  }
  if (!contents) {
    deps.store.getState().setMessage({ kind: 'error', text: MESSAGES.notFound })
    return
  }
  if (!canDiscard(deps)) return
  const { replaceScene, setMessage } = deps.store.getState()
  replaceScene(contents.scene, contents.layers)
  setMessage(null)
}

function uploadErrorText(e: unknown): string {
  if (!(e instanceof SceneFileError)) return MESSAGES.unreadableFile
  if (e.reason === 'newer-version') return MESSAGES.newerVersion
  if (e.reason === 'invalid-layers') return MESSAGES.damaged
  return MESSAGES.notAScene
}

export async function uploadSceneFile(deps: ActionDeps, file: File): Promise<void> {
  let contents
  try {
    contents = readSceneFile(new Uint8Array(await file.arrayBuffer()))
  } catch (e) {
    deps.store.getState().setMessage({ kind: 'error', text: uploadErrorText(e) })
    return
  }
  if (!canDiscard(deps)) return
  const { replaceScene, setMessage } = deps.store.getState()
  replaceScene(contents.scene, contents.layers)
  setMessage(null)
}

function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'scene'
}

export function sceneFilename(name: string): string {
  return slugify(name) + SCENE_FILE_EXTENSION
}

export interface ExportDeps extends ActionDeps {
  library: AssetLibrary | null
  writeGlb?: (root: Object3D) => Promise<Uint8Array>
}

/**
 * Builds the export scene from the current data and downloads it as <slug>.glb. Scatter is regenerated here from the
 * current layers (it is a pure function), so the file never depends on how far the viewport's Worker has got.
 */
export async function exportCurrent(deps: ExportDeps, o: ExportOptions): Promise<void> {
  const { scene, terrain, setMessage } = deps.store.getState()
  const filename = slugify(scene.name) + '.glb'
  try {
    // Let the dialog paint "Exporting…" before the synchronous build.
    await new Promise((r) => setTimeout(r, 0))
    const library = deps.library ?? { assets: new Map(), materials: {} as AssetLibrary['materials'], packs: [], problems: [] }
    const rules = deps.library ? rulesFor(scene.generatorVersion) : { maxInstances: 0, rules: [] }
    const instancesByRule: Instance[][] = rules.rules.map(() => [])
    if (deps.library) {
      const inputs = { layers: terrain.layers, seed: scene.seed, rules, exclusion: null }
      const assets = assetInfoOf(library)
      const n = chunkCount(scene.size)
      for (let c = 0; c < n * n; c++) for (const i of scatterChunk(inputs, c, assets).instances) instancesByRule[i.rule].push(i)
    }
    const root = buildExportScene({ scene, layers: terrain.layers, instancesByRule, rules, library }, o)
    const bytes = await (deps.writeGlb ?? defaultWriteGlb)(root)
    deps.download(filename, bytes)
    setMessage({ kind: 'info', text: `Exported ${filename} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)` })
  } catch (e) {
    setMessage({ kind: 'error', text: `Couldn't export the scene: ${(e as Error).message}` })
  }
}

export function downloadCurrent(deps: ActionDeps): void {
  const { scene, terrain } = deps.store.getState()
  deps.download(sceneFilename(scene.name), writeSceneFile(scene, terrain.layers))
}

/** On startup: shows the newest saved scene, else keeps the new one. Storage problems are left for Save to report. */
export async function loadInitialScene(deps: ActionDeps): Promise<void> {
  try {
    const sceneStore = await deps.sceneStore()
    const [newest] = await sceneStore.list()
    if (!newest) return
    const contents = await sceneStore.load(newest.id)
    // Don't replace a scene the user has already started editing.
    if (contents && !deps.store.getState().dirty) deps.store.getState().replaceScene(contents.scene, contents.layers)
  } catch {
    // Storage unavailable: start with the new scene.
  }
}
