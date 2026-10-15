# M1 Terrain and Paint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users sculpt the terrain (raise, lower, smooth, flatten, noise) and paint biomes (meadow, forest, rocky, swamp) with a Skylines-style brush, see flat-coloured low-poly terrain regenerate chunk by chunk under the brush, undo and redo every stroke, and save and reload the result locally and as a project file.

**Architecture:** Two painted layers, a 0.5 m heightmap and a 1 m biome weight map, live in plain typed arrays owned by a non-React `TerrainEditor`, which applies brush dabs, records an undo patch per stroke and tracks which 32 m chunks a change touched. Pure modules do the maths: layers, brushes, noise, chunk geometry, ray picking and history. The viewport keeps one mesh per chunk and refreshes only dirty chunks, at most once per frame each, in place on the main thread. Layers are saved as binary blobs beside `scene.json` (format version 2) and in a second IndexedDB object store.

**Tech Stack:** As in M0, with no new dependencies: React 19, TypeScript (strict), Vite, Vitest, three r186 (`three/webgpu`), @react-three/fiber 9, zustand 5, idb, fflate, zod 4, fake-indexeddb. The server is unchanged.

**Spec:** Design doc "Environment Modeler — Design Doc", https://claude.ai/code/artifact/6c15080f-9693-489e-89ed-54e596c066b9. Relevant sections: Core experience and controls (Tool loop), Paint-on-environment tools (Terrain, Biome paint), Procedural world elements (Pipeline, Rules and assets as data, Determinism), Rendering (Art style, Targets), Data model, persistence and export (Storage, Versioning), Milestones (M1). It builds on M0: `docs/plans/2026-10-15-m0-skeleton.md` and the code on `main` (including af6b7cb, which flips right-drag orbit; leave that as it is).

## Global Constraints

- Everything stays in the browser. The server is unchanged in M1.
- **Heightmap:** 0.5 m sample spacing, `(size*2+1)²` Float32 samples (129² at 64 m, 257² at 128 m, 513² at 256 m). Sample (i, j) is at world x = −size/2 + 0.5·i, z = −size/2 + 0.5·j, row-major by j: `data[j*res + i]`. Heights are clamped to −32..+64 m. A new scene is flat at 0.
- **Biome map:** 1 m spacing, `(size+1)²` samples, RGBA8, 4 bytes per sample. The channels are meadow, forest, rocky and swamp, in that order, and every sample sums to 255. A new scene is all meadow: (255, 0, 0, 0).
- **Art style:** low-poly, flat shaded (`flatShading: true`), with no textures. Each vertex colour blends the biome colours by the weight map, then blends toward a rock colour on steep slopes. Biome colours and slope thresholds live in a data file (`web/src/terrain/biomes.json`), per "rules and assets as data".
- **Chunks:** 32 m × 32 m tiles, so (size/32)² chunks with index `cz*n + cx`. Each chunk mesh has 65 × 65 vertices at 0.5 m and an index buffer that never changes. Only chunks a change touched are rebuilt, at most once per frame each.
- **Undo:** one entry per stroke (pointer down to up). An entry stores the before and after of the touched rectangle of the one layer the stroke changed. The history holds at most 100 strokes or 64 MiB, whichever comes first, dropping the oldest. A new stroke clears the redo stack.
- **Files:** `formatVersion` 2. A `.setbuilder` zip holds `scene.json`, `heightmap.f32` (raw little-endian Float32, `res²` values) and `biomes.rgba8` (raw bytes). v1 files and v1 IndexedDB records still open, as flat all-meadow terrain. `scene.json` gains `generatorVersion: 1` (the doc's Versioning rule).
- **Performance:** sculpting at 60 fps on a 256 m scene. Mesh refresh runs on the main thread. If the Task 9 check misses 60 fps, move `updateChunkGeometry` into a Web Worker; it is a pure function of (layers, chunk), so it moves unchanged.
- **Bindings:** left-drag applies the active tool. Alt-drag, or the panel's Invert toggle, inverts it (the two XOR). `[` and `]` resize the brush by ×0.8 and ×1.25. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. Esc deselects the tool. None of these keys act while focus is in a text field (Ctrl/Cmd+S still saves). The camera bindings are unchanged from M0.
- App name in UI copy: "Set Builder". TypeScript `strict: true`.

## Decisions (defaults; change any in review)

- **Brush:** radius 1–50 m (default 8), strength 0–1 (default 0.5), falloff 0–1 (default 0.5). The settings are shared by Terrain and Paint. Weight is `1` for d ≤ r·(1−falloff), then `smoothstep` down to 0 at d = r. The 50 m cap keeps the worst-case rebuild near 25 chunks per frame.
- **Rates per second at strength 1** (tune after playtesting). Raise and lower add ±8 m·w·dt. Smooth and flatten blend with factor `k = min(1, 4·strength·w·dt)`: smooth blends toward the 3 × 3 mean, read from a copy of the area taken before the dab; flatten blends toward the height under the cursor when the stroke started. Noise adds ±4 m·w·dt·n(x, z), where n is seeded 2-octave value noise (8 m and 4 m features, in [−1, 1]) keyed by the scene seed. Paint blends a sample toward the selected biome with `k = min(1, 4·strength·w·dt)`.
- **Invert (Alt):** raise and lower swap, and noise negates. Smooth and flatten ignore Invert. In Paint, Invert moves the selected biome's weight to meadow; with meadow selected it does nothing.
- **Strokes are time-based:** each frame the pointer is down, one dab at the point under the cursor (re-picked each frame, because the ground moves). `dt` is capped at 0.1 s. A dab off the terrain does nothing, and a stroke that changed nothing records no history entry.
- **Undo during a drag** ends the stroke, records it and undoes it, so Redo brings it back. The rest of that drag is ignored until the button is released. Redo during a drag is ignored.
- **Tools:** no tool is selected at start (left-drag does nothing until you pick one). The bottom toolbar shows Terrain, Paint, Paths, Water, Caves, Zones and Props. Only Terrain and Paint are enabled; the others are disabled with the tooltip "Coming in a later milestone". The toolbar also has Undo and Redo buttons.
- **Rendering:** the M0 grid overlay is dropped (it would float or bury on sculpted terrain). The camera looks at the ground height under its target and never goes below the ground + 2 m. Picking ray-marches the heightmap in 0.25 m horizontal steps, then refines with 8 bisections, so it can't step over thin spikes.
- **Damaged layer data** (wrong byte length, missing blob, NaN or Infinity) fails with the reason `invalid-layers`. Out-of-range heights are clamped. Biome samples that don't sum to 255 are renormalised, and an all-zero sample becomes meadow.
- **Not in M1:** terrain LOD, workers (unless Task 9's check needs them), brush presets, a "clean again after undoing to the save point" state, and terrain under the M2 scatter.

## Review Focus

1. **Strokes at the scene edge and brushes bigger than the scene:** dabs clip to the grid and never write out of bounds. Edge and corner chunks rebuild, undo restores the clipped rectangle exactly, and a 50 m brush on a 64 m scene changes the whole scene without errors. Tests in Tasks 2 and 4.
2. **Undo or redo while dragging:** Ctrl/Cmd+Z mid-drag restores the pre-stroke terrain, the rest of the drag does nothing, Redo brings the stroke back, and Redo mid-drag is ignored. Tests in Tasks 4 and 8.
3. **Opening older or damaged scenes:** a v1 `.setbuilder` file and a v1 IndexedDB record open as flat meadow. A v2 file with a missing or wrong-sized blob, or NaN heights, shows "That scene file is damaged: its terrain data is missing or the wrong size." and leaves the current scene untouched. `formatVersion: 3` shows the newer-version message. Tests in Tasks 5, 6 and 7.
4. **Very steep slopes and height limits:** heights stay within −32..64 m, faces steeper than 50° are fully rock-coloured, picking still hits a single-sample 60 m spike, and the camera never goes underground. Tests in Tasks 2, 3, 8 and 9.
5. **Saving while sculpting:** Save copies the layers before it awaits, so a stroke that ends during the write is not half-saved, and the scene stays dirty afterwards. The history drops the oldest entries at 100 strokes or 64 MiB without corrupting undo. Tests in Tasks 4 and 7.

---

## File structure

```
web/src/
  dom/isTextEntry.ts              # moved out of cameraInput.ts, shared with shortcuts and brush input
  terrain/layers.ts               # Heightmap, BiomeMap, TerrainLayers, sampling, rect crop/paste
  terrain/noise.ts                # seeded 2D value noise
  terrain/brush.ts                # BrushSettings, falloff, sculpt(), paint()
  terrain/biomes.json             # biome + rock colours, slope thresholds (data)
  terrain/palette.ts              # loads biomes.json -> TerrainPalette (linear RGB)
  terrain/chunks.ts               # chunk indexing, dirty mapping, chunk geometry build/update
  terrain/history.ts              # StrokeHistory (patches, caps)
  terrain/terrainEditor.ts        # TerrainEditor: strokes, undo/redo, dirty chunks
  terrain/pick.ts                 # raycastTerrain
  tools/brushInput.ts             # DOM pointer events -> begin/dab/end
  editor/shortcuts.ts             # Ctrl/Cmd+S, Z, Shift+Z, Y, [ ], Esc
  editor/ToolBar.tsx, BrushPanel.tsx
  viewport/TerrainMesh.tsx        # replaces FlatTerrain.tsx
  viewport/BrushCursor.tsx, BrushRig.tsx
  (modified) scene/scene.ts, scene/sceneFile.ts, persistence/sceneStore.ts, editor/editorStore.ts,
             editor/sceneActions.ts, camera/overheadCamera.ts, camera/cameraInput.ts,
             viewport/Viewport.tsx, viewport/CameraRig.tsx, App.tsx, index.css, README.md
```

---

### Task 1: Terrain layers

**Files:**
- Create: `web/src/terrain/layers.ts`
- Test: `web/src/terrain/layers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const HEIGHT_SPACING = 0.5; export const BIOME_SPACING = 1;
  export const MIN_HEIGHT = -32; export const MAX_HEIGHT = 64;
  export type BiomeId = 'meadow' | 'forest' | 'rocky' | 'swamp';
  export const BIOME_IDS: readonly BiomeId[];              // channel order
  export interface Heightmap { size: SceneSize; resolution: number; data: Float32Array }   // res = size*2+1
  export interface BiomeMap  { size: SceneSize; resolution: number; data: Uint8Array }     // res = size+1, 4 per sample
  export interface TerrainLayers { heights: Heightmap; biomes: BiomeMap }
  export interface Rect { x0: number; z0: number; x1: number; z1: number }  // inclusive sample indices
  export function createFlatLayers(size: SceneSize): TerrainLayers;
  export function heightAt(h: Heightmap, x: number, z: number): number;          // bilinear, clamped to edges
  export function biomeWeightsAt(b: BiomeMap, x: number, z: number): [number, number, number, number]; // bilinear, 0..1
  export function clipRect(r: Rect, resolution: number): Rect | null;
  export function cropRect<T extends Float32Array | Uint8Array>(data: T, resolution: number, channels: 1 | 4, r: Rect): T;
  export function pasteRect<T extends Float32Array | Uint8Array>(data: T, resolution: number, channels: 1 | 4, r: Rect, src: T): void;
  export function cloneLayers(l: TerrainLayers): TerrainLayers;
  ```

- [ ] **Step 1: Write failing tests** in `layers.test.ts`:
  - `createFlatLayers(256)`: heights resolution 513, length 263 169, all 0; biomes resolution 257, length 257·257·4, every sample `[255, 0, 0, 0]`. `createFlatLayers(64)`: resolutions 129 and 65.
  - With sample (i=10, j=20) of a 64 m heightmap set to 6: `heightAt(h, -32 + 5, -32 + 10)` is 6; halfway to (11, 20), which is 0, gives 3; `heightAt(h, -1000, -1000)` equals the corner sample.
  - `biomeWeightsAt` on a flat map is `[1, 0, 0, 0]`.
  - `clipRect({x0:-5,z0:-5,x1:3,z1:600}, 513)` is `{x0:0,z0:0,x1:3,z1:512}`; a rect entirely outside is `null`.
  - `cropRect` then `pasteRect` round-trips a 3 × 2 region for 1 and 4 channels and leaves other samples alone.
  - `cloneLayers` copies, so mutating the clone leaves the original unchanged.
- [ ] **Step 2: Run** `cd web && npm test -- layers`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `layers.ts`.
- [ ] **Step 4: Run** `npm test -- layers`. Expected: PASS.
- [ ] **Step 5: Commit**: `"Add terrain layer model"`

### Task 2: Brushes and noise

**Files:**
- Create: `web/src/terrain/noise.ts`, `web/src/terrain/brush.ts`
- Test: `web/src/terrain/noise.test.ts`, `web/src/terrain/brush.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export function valueNoise2(seed: number, x: number, z: number): number;   // [-1, 1], 8 m + 4 m octaves, deterministic
  export type TerrainMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise';
  export interface BrushSettings { radius: number; strength: number; falloff: number }
  export const BRUSH_DEFAULTS: BrushSettings;            // { radius: 8, strength: 0.5, falloff: 0.5 }
  export const BRUSH_RADIUS_MIN = 1; export const BRUSH_RADIUS_MAX = 50;
  export function brushWeight(distance: number, b: BrushSettings): number;
  export interface Dab { x: number; z: number; dt: number; invert: boolean }
  export function sculpt(h: Heightmap, mode: TerrainMode, b: BrushSettings, dab: Dab,
                         ctx: { flattenTo: number; seed: number }): Rect | null;  // mutates; returns changed rect (clipped) or null
  export function paint(m: BiomeMap, biome: BiomeId, b: BrushSettings, dab: Dab): Rect | null;
  ```

- [ ] **Step 1: Write failing tests:**
  - `valueNoise2`: the same (seed, x, z) gives the same value; a different seed gives a different value at most points; 10 000 samples all lie in [−1, 1] and not all equal.
  - `brushWeight` with r 10, falloff 0.5: 1 at d 0 and d 5, 0.5 at d 7.5, 0 at d 10 and d 12. Falloff 0: 1 at d 9.99, 0 at d 10. Falloff 1: 0.5 at d 5.
  - Raise on a flat 64 m map, centre (0, 0), r 4, strength 1, falloff 0, dt 0.5: the centre sample is 4 m, a sample 5 m away stays 0, and the returned rect is `{x0:56,z0:56,x1:72,z1:72}`. `invert: true` gives −4. Lower gives −4.
  - Raise with dt 100 clamps to 64; lower clamps to −32.
  - Flatten to 10 over a ramp, strength 1, falloff 0, dt 10: every sample within r is 10.
  - Smooth on a lone 10 m spike: the spike drops below 10, its neighbours rise above 0, and a flat area stays flat. Invert changes nothing about smooth.
  - Noise: two maps with the same seed and dab are identical; `invert` gives exactly the negated heights.
  - **Review Focus 1:** a dab at (−32, −32) on a 64 m map with r 8 doesn't throw, its rect starts at 0, and the corner sample changes. With r 50 on a 64 m map the rect is `{0,0,128,128}`. A dab at x = 100 returns `null` and changes nothing.
  - Paint forest, strength 1, falloff 0, dt 1, at the centre: the centre sample is `[0,255,0,0]`. After 200 random dabs (fixed-seed RNG, random biome, invert, position, strength) every sample sums to 255. Invert with forest moves forest back to meadow. Invert with meadow returns `null`.
- [ ] **Step 2: Run** `npm test -- noise brush`. Expected: FAIL.
- [ ] **Step 3: Implement** with the rates and rules in **Decisions**. Paint blends in floats, then quantises each sample with the largest-remainder method so the channels sum to exactly 255.
- [ ] **Step 4: Run** `npm test -- noise brush`. Expected: PASS.
- [ ] **Step 5: Commit**: `"Add terrain sculpt and biome paint brushes"`

### Task 3: Chunks, palette and chunk geometry

**Files:**
- Create: `web/src/terrain/biomes.json`, `web/src/terrain/palette.ts`, `web/src/terrain/chunks.ts`
- Test: `web/src/terrain/chunks.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  // biomes.json: { "biomes": { "meadow": "#7fa650", "forest": "#4f7a3a", "rocky": "#9a9182", "swamp": "#5d6b45" },
  //                "rock": { "color": "#8a8178", "slopeStartDeg": 35, "slopeFullDeg": 50 } }
  export interface TerrainPalette { biomes: [RGB, RGB, RGB, RGB]; rock: RGB; slopeStart: number; slopeFull: number } // linear RGB, radians
  export type RGB = [number, number, number];
  export const DEFAULT_PALETTE: TerrainPalette;           // from biomes.json, sRGB hex -> linear
  export const CHUNK_SIZE = 32; export const CHUNK_VERTS = 65;
  export function chunkCount(size: SceneSize): number;     // per axis
  export function chunksForHeightRect(r: Rect, size: SceneSize): number[];  // expands 1 sample (slope uses neighbours)
  export function chunksForBiomeRect(r: Rect, size: SceneSize): number[];   // expands 1 sample
  export interface ChunkGeometry { positions: Float32Array; colors: Float32Array; indices: Uint16Array }
  export function buildChunkGeometry(l: TerrainLayers, chunk: number, p: TerrainPalette): ChunkGeometry;
  export function updateChunkGeometry(l: TerrainLayers, chunk: number, p: TerrainPalette, g: ChunkGeometry): void; // y + colours in place
  ```

- [ ] **Step 1: Write failing tests:**
  - `chunkCount(256)` is 8 and `chunkCount(64)` is 2.
  - Chunk geometry for a flat 256 m scene: 4225 vertices, 24 576 indices, and vertex 0 of chunk 0 at (−128, 0, −128). Vertex 64 of chunk 0 has the same position as vertex 0 of chunk 1, and that holds for every shared edge vertex after random sculpting.
  - Positions' y equals the heightmap sample.
  - Colours: on flat meadow every vertex is `DEFAULT_PALETTE.biomes[0]`. At a sample split 50/50 between meadow and forest (128 and 127) the colour is the weighted mix.
  - **Review Focus 4:** a 60° ramp is `rock` (within 1e-6), and a 20° ramp is the biome colour.
  - `chunksForHeightRect` on a 64 m scene: a rect touching sample 64 (the 0 m chunk boundary) returns all 4 chunks; a rect inside chunk 0 returns `[0]`; the full grid returns `[0,1,2,3]`.
  - `updateChunkGeometry` after a sculpt equals a fresh `buildChunkGeometry` and keeps the same array objects.
- [ ] **Step 2: Run** `npm test -- chunks`. Expected: FAIL.
- [ ] **Step 3: Implement.** Slope comes from central differences on the heightmap. Colour = Σ biome weight × colour (bilinear from the biome map), then mixed toward rock by `smoothstep(slopeStart, slopeFull, slope)`. Vertex colours are linear because three treats vertex colours as linear.
- [ ] **Step 4: Run** `npm test -- chunks`. Expected: PASS.
- [ ] **Step 5: Commit**: `"Add chunked terrain geometry with biome and slope colours"`

### Task 4: Stroke history and TerrainEditor

**Files:**
- Create: `web/src/terrain/history.ts`, `web/src/terrain/terrainEditor.ts`
- Test: `web/src/terrain/history.test.ts`, `web/src/terrain/terrainEditor.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  ```ts
  export interface LayerPatch { layer: 'heights' | 'biomes'; rect: Rect; before: Float32Array | Uint8Array; after: Float32Array | Uint8Array }
  export const HISTORY_LIMITS = { maxStrokes: 100, maxBytes: 64 * 1024 * 1024 };
  export class StrokeHistory {
    constructor(limits?: { maxStrokes: number; maxBytes: number });
    push(p: LayerPatch): void;  undo(): LayerPatch | undefined;  redo(): LayerPatch | undefined;
    readonly canUndo: boolean;  readonly canRedo: boolean;  readonly bytes: number;  clear(): void;
  }
  export type StrokeTool = { tool: 'terrain'; mode: TerrainMode } | { tool: 'paint'; biome: BiomeId };
  export type TerrainChange = 'stroke' | 'undo' | 'redo';
  export class TerrainEditor {
    constructor(layers: TerrainLayers, seed: number, onChange: (c: TerrainChange) => void);
    readonly layers: TerrainLayers;
    readonly strokeActive: boolean;
    beginStroke(t: StrokeTool, b: BrushSettings, at: GroundPoint | null): void;  // snapshots the target layer; flattenTo = heightAt(at)
    dab(at: GroundPoint, dt: number, invert: boolean): void;                    // no-op without a live stroke
    endStroke(): void;          // records a patch only if something changed, then onChange('stroke')
    undo(): boolean;            // mid-stroke: endStroke, then undo, and ignore dabs until the next beginStroke
    redo(): boolean;            // ignored mid-stroke
    readonly canUndo: boolean; readonly canRedo: boolean;
    takeDirtyChunks(): number[];  // chunks changed since the last call (strokes, undo, redo); clears the set
  }
  ```

- [ ] **Step 1: Write failing tests:**
  - `StrokeHistory({maxStrokes: 3, maxBytes: 1e9})` keeps the newest 3 of 4 pushes. `{maxStrokes: 100, maxBytes: 100}` drops the oldest until the bytes fit, and a single oversize patch still stays as the only entry. A push after an undo clears redo. `HISTORY_LIMITS` is 100 and 64 MiB.
  - TerrainEditor raise stroke: begin, dab, end calls `onChange('stroke')` once and changes heights. `undo()` restores the heights exactly (same bytes), and `redo()` gives the after state exactly.
  - A stroke with no dab, or with only off-scene dabs, records nothing: `canUndo` stays false and `onChange` isn't called.
  - `takeDirtyChunks` after a r 4 stroke at (0, 0) on a 256 m scene returns `[27, 28, 35, 36]`; a second call returns `[]`; after `undo()` it returns them again.
  - **Review Focus 2:** begin, dab, `undo()` while active restores the pre-stroke heights, `canRedo` is true, a further `dab` changes nothing, and `endStroke()` records nothing. `redo()` while active returns false.
  - A paint stroke undoes back to the original biome bytes.
  - **Review Focus 5:** 101 strokes leave 100 undoable, and undoing all 100 leaves exactly the state after the first stroke.
- [ ] **Step 2: Run** `npm test -- history terrainEditor`. Expected: FAIL.
- [ ] **Step 3: Implement.** `beginStroke` copies only the layer the tool writes (heights or biomes). `endStroke` builds the patch from the union of the dab rects, cropping before from the snapshot and after from the live layer.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: `"Add stroke history and TerrainEditor"`

### Task 5: Project file format v2

**Files:**
- Modify: `web/src/scene/scene.ts`, `web/src/scene/sceneFile.ts`, and their tests (M0's expectations change from `formatVersion: 1` to 2)
- Test: `web/src/scene/scene.test.ts`, `web/src/scene/sceneFile.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces (replaces the M0 signatures):
  ```ts
  export const SCENE_FORMAT_VERSION = 2; export const GENERATOR_VERSION = 1;
  export interface Scene { formatVersion: 2; generatorVersion: number; id; name; size; seed; createdAt; updatedAt }
  export type SceneFileErrorReason = ... | 'invalid-layers';
  export function parseScene(data: unknown): Scene;                    // accepts v1 (adds generatorVersion 1) and v2
  export function layersFromBuffers(size: SceneSize, heights: ArrayBuffer | undefined, biomes: ArrayBuffer | undefined): TerrainLayers; // throws invalid-layers
  export interface SceneFileContents { scene: Scene; layers: TerrainLayers }
  export function writeSceneFile(scene: Scene, layers: TerrainLayers): Uint8Array;
  export function readSceneFile(bytes: Uint8Array): SceneFileContents;
  ```

- [ ] **Step 1: Write failing tests:**
  - `createScene` produces `formatVersion: 2, generatorVersion: 1`.
  - Round trip: a scene with a raised hill and a forest patch comes back with equal scene fields and byte-identical layers.
  - **Review Focus 3:** a v1 zip (scene.json with `formatVersion: 1`, no blobs) reads as a v2 scene with `generatorVersion: 1` and `createFlatLayers(size)`. A v2 zip with no `heightmap.f32`, a wrong-length `biomes.rgba8`, or a NaN height fails with `invalid-layers`. `formatVersion: 3` fails with `newer-version`.
  - Heights of 100 load as 64. A biome sample `[10,10,0,0]` loads summing to 255, and `[0,0,0,0]` loads as meadow.
- [ ] **Step 2: Run** `npm test -- scene`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write with `zipSync({ 'scene.json', 'heightmap.f32', 'biomes.rgba8' })`, deflate level 6 (so a 256 m save stays well under 5 MB). Blobs go in as the typed arrays' bytes; all supported browsers are little-endian, so note that in a comment rather than byte-swapping.
- [ ] **Step 4: Run** `npm test -- scene`. Expected: PASS.
- [ ] **Step 5: Commit**: `"Save terrain layers in .setbuilder files (format v2)"`

### Task 6: IndexedDB store v2

**Files:**
- Modify: `web/src/persistence/sceneStore.ts`, `sceneStore.test.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces (replaces M0's save/load):
  ```ts
  export interface SceneStore {
    save(scene: Scene, layers: TerrainLayers): Promise<void>;          // one transaction over 'scenes' + 'layers'
    load(id: string): Promise<SceneFileContents | undefined>;          // undefined if no scene; throws SceneFileError('invalid-layers') if layers are damaged
    list(): Promise<SceneSummary[]>;  remove(id: string): Promise<void>;
  }
  // DB version 2: adds object store 'layers' { id, heights: ArrayBuffer, biomes: ArrayBuffer }, keyPath 'id'
  ```

- [ ] **Step 1: Write failing tests:**
  - save then load returns an equal scene and byte-identical layers; `list()` is unchanged; `remove` deletes both records.
  - **Review Focus 3:** a database created as M0 did (`openDB(name, 1)` with a `scenes` store holding a `formatVersion: 1` record) opens through `openSceneStore(name)`. Its scene lists, and `load` returns it migrated with flat layers.
  - A stored layers record with a wrong-length buffer makes `load` reject with `SceneFileError` reason `invalid-layers`.
  - Another connection held open at version 1, which ignores `versionchange`, makes `openSceneStore` reject with `StorageUnavailableError` whose message mentions closing other Set Builder tabs. An open v2 store closes itself when a newer version asks (`blocking` handler), so `openDB(name, 3)` succeeds.
- [ ] **Step 2: Run** `npm test -- sceneStore`. Expected: FAIL.
- [ ] **Step 3: Implement** with `openDB(name, 2, { upgrade, blocked, blocking })`. `upgrade` creates `scenes` if `oldVersion < 1` and `layers` if `oldVersion < 2`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: `"Store terrain layers in IndexedDB (schema v2)"`

### Task 7: Editor store and scene actions with layers

**Files:**
- Modify: `web/src/editor/editorStore.ts`, `web/src/editor/sceneActions.ts`, their tests, `web/src/App.test.tsx` if it needs updating
- Test: `web/src/editor/editorStore.test.ts` (new), `web/src/editor/sceneActions.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5 and 6.
- Produces (adds to M0's EditorState; existing members unchanged unless listed):
  ```ts
  export type ToolId = 'terrain' | 'paint';
  interface EditorState {
    terrain: TerrainEditor;           // replaced with the scene; onChange -> dirty true, editVersion++, canUndo/canRedo refreshed
    editVersion: number;
    tool: ToolId | null; terrainMode: TerrainMode; biome: BiomeId; brush: BrushSettings; invertToggle: boolean;
    canUndo: boolean; canRedo: boolean;
    replaceScene(scene: Scene, layers?: TerrainLayers): void;   // default createFlatLayers(scene.size); clears history; dirty false
    setTool(t: ToolId | null): void; setTerrainMode(m: TerrainMode): void; setBiome(b: BiomeId): void;
    setBrush(p: Partial<BrushSettings>): void;   // clamps radius 1..50, strength/falloff 0..1
    resizeBrush(factor: number): void;           // radius * factor, clamped
    setInvertToggle(v: boolean): void;
    undo(): void; redo(): void;
  }
  export const MESSAGES: { ...M0, damaged: "That scene file is damaged: its terrain data is missing or the wrong size.",
                           damagedSaved: "That saved scene is damaged and can't be opened." };
  ```

- [ ] **Step 1: Write failing tests:**
  - Store: `replaceScene` gives flat layers of the scene's size and `canUndo` false. A stroke through `getState().terrain` sets `dirty`, increments `editVersion` and sets `canUndo`. `undo()` sets `canRedo` and keeps `dirty` true. `setBrush({radius: 500})` gives 50 and `resizeBrush(0.001)` gives 1.
  - Actions: `saveCurrent` then `openScene` in a fresh store restores byte-identical heights. `downloadCurrent` bytes parse with `readSceneFile` to the current layers. `newScene` gives flat layers and clears history. `loadInitialScene` restores the newest scene's layers.
  - **Review Focus 3:** uploading a v1 file gives flat layers. Uploading a v2 file with damaged layers shows `MESSAGES.damaged` and leaves the scene and layers untouched. Opening a saved scene whose stored layers are damaged shows `MESSAGES.damagedSaved`.
  - **Review Focus 5:** `saveCurrent` with a `sceneStore` whose `save` resolves only when the test releases it. During the wait the test runs a full raise stroke, then releases. The stored heights equal the pre-stroke heights, `dirty` is still true, and "Saved" is shown.
- [ ] **Step 2: Run** `npm test -- editor`. Expected: FAIL.
- [ ] **Step 3: Implement.** `saveCurrent` takes `cloneLayers` and `editVersion` synchronously before the first `await`, and calls `markSaved` only if both the scene object and `editVersion` are unchanged afterwards. `replaceScene` builds the new `TerrainEditor`. Map `SceneFileError('invalid-layers')` to `damaged` for uploads and `damagedSaved` for opens.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (whole suite).
- [ ] **Step 5: Commit**: `"Hold terrain layers in the editor and save, open, upload and download them"`

### Task 8: Picking, brush input and editor shortcuts

**Files:**
- Create: `web/src/dom/isTextEntry.ts` (moved from `cameraInput.ts`, which now imports it), `web/src/terrain/pick.ts`, `web/src/tools/brushInput.ts`, `web/src/editor/shortcuts.ts`
- Modify: `web/src/App.tsx` (replace its Ctrl/Cmd+S listener with `installEditorShortcuts`)
- Test: `web/src/terrain/pick.test.ts`, `web/src/tools/brushInput.test.ts`, `web/src/editor/shortcuts.test.ts`

**Interfaces:**
- Consumes: Task 1 (`heightAt`), Task 7 (store actions).
- Produces:
  ```ts
  export function isTextEntry(target: EventTarget | null): boolean;
  export interface Vec3 { x: number; y: number; z: number }
  export function raycastTerrain(h: Heightmap, origin: Vec3, dir: Vec3, maxDistance?: number): Vec3 | null; // default 2000 m
  export interface BrushInputOptions {
    element: HTMLElement;
    active(): boolean;
    pick(clientX: number, clientY: number): GroundPoint | null;
    begin(at: GroundPoint | null): void; dab(at: GroundPoint, dt: number, altKey: boolean): void; end(): void;
    hover(at: GroundPoint | null): void;
  }
  export class BrushInput { constructor(o: BrushInputOptions); update(dt: number): void; dispose(): void }
  export interface ShortcutHandlers { save(): void; undo(): void; redo(): void; resizeBrush(f: number): void; deselectTool(): void }
  export function installEditorShortcuts(target: Window, h: ShortcutHandlers): () => void;  // returns uninstall
  ```

- [ ] **Step 1: Write failing tests:**
  - `raycastTerrain`: a ray straight down from (0, 100, 0) hits (0, 0, 0) on flat ground; over a 10 m hill at the origin it hits y = 10 ± 0.05. Rays pointing up, or passing outside the scene square, return `null`. **Review Focus 4:** a single sample raised to 60 m is hit by a shallow ray passing at y = 30 over it.
  - BrushInput (jsdom, real PointerEvents): with `active()` false a left-drag calls nothing. With it true: left `pointerdown` calls `begin(pick)`; `update(0.1)` calls `dab(at, 0.1, false)`; after a `pointermove` with `altKey: true` the next dab passes `true`; `pointerup` calls `end`. Middle and right buttons never begin. A window `blur` mid-drag calls `end`. `pick` returning `null` means no dab. After `dispose()` nothing fires. Hover calls `hover` on every move and `hover(null)` on `pointerleave`.
  - Shortcuts: Cmd+Z and Ctrl+Z call undo; Cmd+Shift+Z and Ctrl+Y call redo; `[` calls `resizeBrush(0.8)` and `]` calls `resizeBrush(1.25)`; Escape calls `deselectTool`; Cmd+S calls save with `preventDefault`. With an `<input>` as the target, every key except Cmd/Ctrl+S calls nothing. Uninstalling stops all of them.
  - **Review Focus 2** (wired through a real store): begin a stroke, dab, then Ctrl+Z restores the heights, further dabs do nothing, and Redo after `end` brings the stroke back.
- [ ] **Step 2: Run** `npm test -- pick brushInput shortcuts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Ray-march in 0.25 m horizontal steps from where the ray enters the scene square, then run 8 bisection steps once the ray drops below `heightAt`. BrushInput re-picks on every `update` (the ground moves under a raising brush) and tracks Alt from pointer and key events.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `"Add terrain picking, brush input and editor shortcuts"`

### Task 9: Chunked terrain in the viewport

**Files:**
- Create: `web/src/viewport/TerrainMesh.tsx`, `web/src/viewport/BrushCursor.tsx`, `web/src/viewport/BrushRig.tsx`
- Modify: `web/src/camera/overheadCamera.ts` (+ test), `web/src/viewport/CameraRig.tsx`, `web/src/viewport/Viewport.tsx` (props become `{ scene, terrain, onBackend }`); delete `web/src/viewport/FlatTerrain.tsx`
- Test: `web/src/camera/overheadCamera.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 7 and 8.
- Produces:
  ```ts
  export function cameraPoseOverTerrain(s: CameraState, groundAt: (x: number, z: number) => number, clearance?: number):
    { position: Vec3; lookAt: Vec3 };    // lookAt.y = groundAt(target); position lifted by that, then to >= groundAt(pos) + clearance (default 2)
  ```

- [ ] **Step 1: Write failing tests** for `cameraPoseOverTerrain`: on flat ground it equals M0's `cameraPosition` and the target at y 0. With the ground at 20 m everywhere, both points are 20 m higher. **Review Focus 4:** with a 60 m wall under the camera but not under the target, `position.y` is at least 62.
- [ ] **Step 2: Run** `npm test -- overheadCamera`. Expected: FAIL. Then **implement** it and run again. Expected: PASS.
- [ ] **Step 3: Implement the viewport.**
  - `TerrainMesh` creates one `Mesh` per chunk from `buildChunkGeometry`, with `MeshStandardMaterial({ vertexColors: true, flatShading: true })`, casting and receiving shadows. In `useFrame` it calls `terrain.takeDirtyChunks()` once, runs `updateChunkGeometry` for each chunk, sets `needsUpdate` on position and colour, and recomputes the bounding sphere. It rebuilds every chunk when `terrain` changes identity.
  - `BrushRig` owns a `BrushInput` (created in an effect, like `CameraRig`). It picks with `raycastTerrain`, begins strokes from the store's tool, mode, biome and brush, and passes `altKey XOR invertToggle`.
  - `BrushCursor` draws a 64-segment ring of the brush radius draped on `heightAt` (+0.1 m) at the hover point, and only while a tool is selected.
  - `CameraRig` uses `cameraPoseOverTerrain` and picks the wheel-zoom target with `raycastTerrain`, falling back to the y = 0 plane.
  - Delete `FlatTerrain.tsx` (the grid goes with it). Keep the shadow camera covering the scene and heights up to 64 m.
- [ ] **Step 4: Verify in a browser** (`npm run dev` and the in-app browser, as in M0):
  - On a 256 m scene, raise a hill with Terrain, then smooth, flatten (a building pad) and noise it. Paint forest, rocky and swamp. Alt-drag inverts.
  - Steep faces turn rock-coloured, and chunk seams show no cracks.
  - Strokes at the scene edge and in the corners behave, and a 50 m brush on a 64 m scene changes the whole scene.
  - **Performance:** with a 50 m brush, a scripted 3 s raise stroke over the centre of a 256 m scene keeps rAF frame times at a p95 ≤ 16.7 ms. If not, move `updateChunkGeometry` into a Web Worker (the Global Constraints rule) and record it. Also check idle full-scene frame rate; if that misses 60 fps, render every second sample (33 × 33 per chunk) and record the ruling.
  - Check `?renderer=webgl2` still renders.
- [ ] **Step 5: Run** `npm test`. Expected: PASS. **Commit**: `"Render chunked, sculptable terrain with a brush cursor"`

### Task 10: Bottom toolbar and brush panel

**Files:**
- Create: `web/src/editor/ToolBar.tsx`, `web/src/editor/BrushPanel.tsx`
- Modify: `web/src/App.tsx`, `web/src/index.css`, `README.md` (controls table)
- Test: `web/src/editor/ToolBar.test.tsx`, `web/src/editor/BrushPanel.test.tsx`

**Interfaces:**
- Consumes: Task 7's store.
- Produces: `ToolBar()` and `BrushPanel()`, which read and write `useEditorStore` directly (no props).

- [ ] **Step 1: Write failing tests:**
  - ToolBar shows the buttons Terrain, Paint, Paths, Water, Caves, Zones and Props, in that order. The last five are disabled with the title "Coming in a later milestone". Clicking Terrain sets `tool` to `'terrain'` with `aria-pressed="true"`, and clicking it again sets `null`. Undo and Redo are disabled per `canUndo` and `canRedo`, and clicking them calls the store.
  - BrushPanel renders nothing with no tool. For Terrain it shows a radio group with Raise, Lower, Smooth, Flatten and Noise. For Paint it shows Meadow, Forest, Rocky and Swamp swatches, each coloured from `biomes.json`. It has Size (range 1–50, showing "8 m"), Strength ("50%") and Falloff ("50%"), and moving a slider updates the store. It has an "Invert (Alt)" toggle. Its keyboard focus doesn't trigger camera keys (sliders aren't text fields, so arrows still pan; accepted).
- [ ] **Step 2: Run** `npm test -- ToolBar BrushPanel`. Expected: FAIL.
- [ ] **Step 3: Implement.** The toolbar is centred at the bottom of the viewport. The panel sits above it, on the left, when a tool is active. Update the README controls table with every M1 binding.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. **Verify in a browser:** the whole tool loop works by mouse and keys:
  - pick a tool, change its mode or biome;
  - resize with `[` and `]` while the ring follows;
  - sculpt and paint, then undo and redo with the buttons and keys;
  - Esc deselects the tool;
  - save, reload, download and upload (layers intact, using the in-page download capture from M0);
  - upload an M0-era (v1) file, which opens flat.
- [ ] **Step 5: Commit**: `"Add bottom toolbar and brush panel"`

---

## Done when

- `cd web && npm test` and `cd server && ./gradlew test` both pass.
- From `./gradlew bootRun` (or `run.command`), on a 256 m scene you can raise, lower, smooth, flatten and noise the terrain and paint all four biomes at 60 fps. Steep faces show rock colour, and every stroke undoes and redoes.
- The sculpted, painted scene survives a reload and a download/upload round trip, and M0 scenes and files still open (as flat meadow).
