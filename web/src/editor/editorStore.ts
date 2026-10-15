import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { createScene, renameScene, type Scene } from '../scene/scene'
import {
  BRUSH_DEFAULTS,
  BRUSH_RADIUS_MAX,
  BRUSH_RADIUS_MIN,
  type BrushSettings,
  type TerrainMode,
} from '../terrain/brush'
import { createFlatLayers, type BiomeId, type TerrainLayers } from '../terrain/layers'
import { TerrainEditor } from '../terrain/terrainEditor'
import type { RenderBackend } from '../viewport/renderBackend'

export type Message = { kind: 'error' | 'info'; text: string } | null

export type ToolId = 'terrain' | 'paint'

export interface EditorState {
  scene: Scene
  /** Owns the scene's painted layers and undo history; replaced with the scene. */
  terrain: TerrainEditor
  /** Increments on every terrain change (stroke, undo, redo). */
  editVersion: number
  /** True when the scene has changes that are not in browser storage. */
  dirty: boolean
  renderBackend: RenderBackend | null
  message: Message
  tool: ToolId | null
  terrainMode: TerrainMode
  biome: BiomeId
  brush: BrushSettings
  invertToggle: boolean
  canUndo: boolean
  canRedo: boolean
  /** Shows another scene (flat layers unless given); clears dirty and history. */
  replaceScene(scene: Scene, layers?: TerrainLayers): void
  rename(name: string): void
  markSaved(): void
  setRenderBackend(b: RenderBackend): void
  setMessage(m: Message): void
  setTool(t: ToolId | null): void
  setTerrainMode(m: TerrainMode): void
  setBiome(b: BiomeId): void
  /** Clamps radius to 1..50 m and strength and falloff to 0..1. */
  setBrush(p: Partial<BrushSettings>): void
  resizeBrush(factor: number): void
  setInvertToggle(v: boolean): void
  undo(): void
  redo(): void
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const initializer =
  (initialScene: () => Scene) =>
  (set: StoreApi<EditorState>['setState'], get: StoreApi<EditorState>['getState']): EditorState => {
    const terrainFor = (scene: Scene, layers: TerrainLayers): TerrainEditor => {
      const editor: TerrainEditor = new TerrainEditor(layers, scene.seed, () => {
        // A replaced scene's editor may still be finishing a stroke; ignore it.
        if (get().terrain !== editor) return
        set((s) => ({ dirty: true, editVersion: s.editVersion + 1, canUndo: editor.canUndo, canRedo: editor.canRedo }))
      })
      return editor
    }
    const scene = initialScene()
    return {
      scene,
      terrain: terrainFor(scene, createFlatLayers(scene.size)),
      editVersion: 0,
      dirty: false,
      renderBackend: null,
      message: null,
      tool: null,
      terrainMode: 'raise',
      biome: 'forest',
      brush: { ...BRUSH_DEFAULTS },
      invertToggle: false,
      canUndo: false,
      canRedo: false,
      replaceScene: (next, layers) =>
        set({
          scene: next,
          terrain: terrainFor(next, layers ?? createFlatLayers(next.size)),
          dirty: false,
          canUndo: false,
          canRedo: false,
        }),
      rename: (name) => {
        const { scene: current } = get()
        const renamed = renameScene(current, name)
        if (renamed.name === current.name) return
        set({ scene: renamed, dirty: true })
      },
      markSaved: () => set({ dirty: false }),
      setRenderBackend: (renderBackend) => set({ renderBackend }),
      setMessage: (message) => set({ message }),
      setTool: (tool) => set({ tool }),
      setTerrainMode: (terrainMode) => set({ terrainMode }),
      setBiome: (biome) => set({ biome }),
      setBrush: (p) => {
        const b = { ...get().brush, ...p }
        set({
          brush: {
            radius: clamp(b.radius, BRUSH_RADIUS_MIN, BRUSH_RADIUS_MAX),
            strength: clamp(b.strength, 0, 1),
            falloff: clamp(b.falloff, 0, 1),
          },
        })
      },
      resizeBrush: (factor) => get().setBrush({ radius: get().brush.radius * factor }),
      setInvertToggle: (invertToggle) => set({ invertToggle }),
      undo: () => {
        get().terrain.undo()
      },
      redo: () => {
        get().terrain.redo()
      },
    }
  }

/** A standalone store (tests, tools). The app uses useEditorStore. */
export function createEditorStore(scene: Scene = createScene({ size: 128 })): StoreApi<EditorState> {
  return createStore<EditorState>()(initializer(() => scene))
}

export const useEditorStore: UseBoundStore<StoreApi<EditorState>> = create<EditorState>()(
  initializer(() => createScene({ size: 128 })),
)
