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
import { is3dMode, RADIUS_3D_MAX } from '../terrain/brush3d'
import { createFlatLayers, type BiomeId, type TerrainLayers } from '../terrain/layers'
import { TerrainEditor } from '../terrain/terrainEditor'
import { scaleSelectedPoint } from './pointScale'
import type { PathStyle } from '../features/features'
import type { ScatterManager } from '../scatter/scatterManager'
import type { SplineKey } from '../tools/splineInput'
import type { RenderBackend } from '../viewport/renderBackend'

export type Message = { kind: 'error' | 'info'; text: string } | null

/** Least ms between remeshes of cave chunks while sculpting; 0 remeshes every frame. */
export const CAVE_REMESH_DELAYS = [0, 30, 60, 120, 240] as const
export type CaveRemeshDelay = (typeof CAVE_REMESH_DELAYS)[number]

export type ToolId = 'terrain' | 'paint' | 'path' | 'river' | 'water' | 'cave' | 'select'

/** The tools that paint with a brush. */
export const isBrushTool = (t: ToolId | null): t is 'terrain' | 'paint' => t === 'terrain' || t === 'paint'

/** The selected feature; for a cave, also its selected point (null for none). */
export type Selection = { kind: 'pond'; id: string } | { kind: 'spline'; id: string; point: number | null } | { kind: 'cave'; id: string; point: number | null } | null

/** The active feature tool's keyboard and undo hooks, registered by its viewport rig. */
export interface FeatureKeys {
  /** True if the tool used the key. */
  key(k: SplineKey): boolean
  /** Drops an unfinished drawing; true if there was one. */
  cancelDraft(): boolean
}

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
  /** Scattered elements shown in the viewport. */
  scatterVisible: boolean
  /** Settings menu: how long cave chunks wait between remeshes (0 = off). */
  caveRemeshDelay: CaveRemeshDelay
  /** Settings menu: while a stroke lasts, draw and pick the ground as if caves weren't there; they return on release. */
  hideCavesWhileStroking: boolean
  /** Settings menu: draw the 32 m chunk boundaries on the ground. */
  showChunkGrid: boolean
  /** Settings menu: hang grass lips over cliff tops, in the viewport and in exports. */
  grassOverhangs: boolean
  /** The viewport's live scatter (export reads its instances); null when none is running. */
  scatterManager: ScatterManager | null
  /** Terrace step height in metres (0.5–5). */
  terraceStep: number
  /** The selected path, river or pond. */
  selection: Selection
  /** Style for new paths. */
  pathStyle: PathStyle
  featureKeys: FeatureKeys | null
  canUndo: boolean
  canRedo: boolean
  /** Shows another scene (flat layers unless given); clears dirty and history. */
  replaceScene(scene: Scene, layers?: TerrainLayers): void
  /** The scene as it should be saved: `scene` with the editor's current features. */
  currentScene(): Scene
  rename(name: string): void
  markSaved(): void
  setRenderBackend(b: RenderBackend): void
  setMessage(m: Message): void
  setTool(t: ToolId | null): void
  setTerrainMode(m: TerrainMode): void
  setBiome(b: BiomeId): void
  /** Clamps radius to 1..50 m (1..12 m for the 3D modes) and strength and falloff to 0..1. */
  setBrush(p: Partial<BrushSettings>): void
  resizeBrush(factor: number): void
  setInvertToggle(v: boolean): void
  setTerraceStep(m: number): void
  setScatterVisible(v: boolean): void
  setCaveRemeshDelay(ms: CaveRemeshDelay): void
  setHideCavesWhileStroking(v: boolean): void
  setShowChunkGrid(v: boolean): void
  setGrassOverhangs(v: boolean): void
  setScatterManager(m: ScatterManager | null): void
  setSelection(s: Selection): void
  setPathStyle(s: PathStyle): void
  setFeatureKeys(k: FeatureKeys | null): void
  /** Cancels a feature draft if there is one; otherwise undoes the last entry. */
  undo(): void
  redo(): void
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** The largest brush for a tool and mode: 3D modes are limited to 12 m. */
const radiusMax = (tool: ToolId | null, mode: TerrainMode) => (tool === 'terrain' && is3dMode(mode) ? RADIUS_3D_MAX : BRUSH_RADIUS_MAX)

const initializer =
  (initialScene: () => Scene) =>
  (set: StoreApi<EditorState>['setState'], get: StoreApi<EditorState>['getState']): EditorState => {
    const terrainFor = (scene: Scene, layers: TerrainLayers): TerrainEditor => {
      const editor: TerrainEditor = new TerrainEditor(layers, scene.seed, scene.features, () => {
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
      terraceStep: 1.5,
      scatterVisible: true,
      caveRemeshDelay: 0,
      hideCavesWhileStroking: false,
      showChunkGrid: false,
      grassOverhangs: false,
      scatterManager: null,
      selection: null,
      pathStyle: 'dirt',
      featureKeys: null,
      canUndo: false,
      canRedo: false,
      currentScene: () => ({ ...get().scene, features: get().terrain.features }),
      replaceScene: (next, layers) =>
        set((s) => ({
          terrainMode: next.mapMode !== 'volumetric' && is3dMode(s.terrainMode) ? 'raise' : s.terrainMode,
          scene: next,
          terrain: terrainFor(next, layers ?? createFlatLayers(next.size)),
          dirty: false,
          selection: null,
          canUndo: false,
          canRedo: false,
        })),
      rename: (name) => {
        const { scene: current } = get()
        const renamed = renameScene(current, name)
        if (renamed.name === current.name) return
        set({ scene: renamed, dirty: true })
      },
      markSaved: () => set({ dirty: false }),
      setRenderBackend: (renderBackend) => set({ renderBackend }),
      setMessage: (message) => set({ message }),
      setTool: (tool) =>
        set((s) => ({ tool, selection: null, brush: { ...s.brush, radius: Math.min(s.brush.radius, radiusMax(tool, s.terrainMode)) } })),
      setTerrainMode: (terrainMode) => {
        // The 3D modes belong to volumetric maps.
        if (is3dMode(terrainMode) && get().scene.mapMode !== 'volumetric') return
        set((s) => ({ terrainMode, brush: { ...s.brush, radius: Math.min(s.brush.radius, radiusMax(s.tool, terrainMode)) } }))
      },
      setBiome: (biome) => set({ biome }),
      setBrush: (p) => {
        const b = { ...get().brush, ...p }
        set({
          brush: {
            radius: clamp(b.radius, BRUSH_RADIUS_MIN, radiusMax(get().tool, get().terrainMode)),
            strength: clamp(b.strength, 0, 1),
            falloff: clamp(b.falloff, 0, 1),
          },
        })
      },
      resizeBrush: (factor) => {
        const { terrain, selection } = get()
        const scaled = scaleSelectedPoint(terrain.features, selection, factor)
        if (scaled) terrain.commitFeatures(scaled)
        else get().setBrush({ radius: get().brush.radius * factor })
      },
      setInvertToggle: (invertToggle) => set({ invertToggle }),
      setTerraceStep: (m) => set({ terraceStep: clamp(m, 0.5, 5) }),
      setScatterVisible: (scatterVisible) => set({ scatterVisible }),
      setCaveRemeshDelay: (caveRemeshDelay) => set({ caveRemeshDelay }),
      setHideCavesWhileStroking: (hideCavesWhileStroking) => set({ hideCavesWhileStroking }),
      setShowChunkGrid: (showChunkGrid) => set({ showChunkGrid }),
      setGrassOverhangs: (grassOverhangs) => set({ grassOverhangs }),
      setScatterManager: (scatterManager) => set({ scatterManager }),
      setSelection: (selection) => set({ selection }),
      setPathStyle: (pathStyle) => set({ pathStyle }),
      setFeatureKeys: (featureKeys) => set({ featureKeys }),
      undo: () => {
        if (get().featureKeys?.cancelDraft()) return
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
