# M3a Paths and Water Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** You can draw dirt trails and cobble roads, rivers and ponds. Paths and rivers carve the terrain under them, and all three clear scatter around them. Water renders in the flat low-poly style, everything saves with the scene, and everything exports to `.glb`. Caves are M3b, a separate plan written after this one ships.

**Architecture:**
- **Saved inputs:** splines and ponds are saved in `scene.json`. The sculpted heightmap is never changed by them.
- **Derived ground:** a pure, deterministic pass turns (sculpted layers + features) into a *ground*:
  - carved heights;
  - a per-sample surface map (path, verge and river-bed colour weights);
  - the 1 m scatter exclusion mask;
  - pond masks and levels.
- **Where it runs:** `TerrainEditor` owns the features as well as the layers. It rebuilds the ground for dirty rects and keeps one undo stack for strokes and feature edits. The terrain mesh, scatter, picking and export all read the ground instead of the raw layers.

**Tech Stack:** As in M2: React, three (WebGPU, `three/addons`), zustand, zod, Vitest. No new npm dependencies, and no server changes.

**Spec:** Design doc "Environment Modeler — Design Doc", https://claude.ai/code/artifact/6c15080f-9693-489e-89ed-54e596c066b9. Relevant sections:
- Paint-on-everything: the Paths and Water rows, and "Paths and rivers affect what is around them: they flatten terrain under them and clear vegetation in a margin."
- Procedural world elements: Pipeline step 1, "heightmap + path/river carving → terrain mesh and splat weights"; and Determinism.
- Data model and Export.
- Milestones: M3.

It builds on M0–M2 (`docs/plans/2026-10-15-m*.md`) and the code on `main`.

## Global Constraints

- **Saves store only inputs:** `scene.json` (now carrying `features`), `heightmap.f32` and `biomes.rgba8`. Carved heights, surface weights, the exclusion mask and pond masks are never saved.
- **Determinism:** the ground is a pure function of (layers, features). There is no `Math.random`. The same inputs give byte-identical carved heights, masks and water geometry.
- **No features means no change:** a scene with no features gives a ground byte-identical to its layers. M2 scenes look, scatter and export exactly as before.
- **Feature tuning lives in data:** widths, margins, depths and colours are in `web/src/features/features.json`.
- **Formats:**
  - `SCENE_FORMAT_VERSION = 3` and `GENERATOR_VERSION = 3`.
  - v1 and v2 scenes load with `features: { splines: [], ponds: [] }`.
  - A formatVersion > 3 or a generatorVersion > 3 is rejected as `newer-version`.
- **Limits** (enforced on load and in the editor):
  - at most 200 splines, each with 2–200 points;
  - at most 50 ponds;
  - every point and pond seed inside the scene bounds.
- **Art style:** flat shaded and untextured. Water is one shared material, named `water` in exports (colour `#3f7f9a`, opacity 0.75).
- **Units and axes:** metres, Y-up.
- **Performance:** 60 fps while dragging a spline point or sculpting next to a path on a 256 m scene with 20 splines and 5 ponds.
- **Exports:**
  - Paths are part of the terrain mesh's vertex colours.
  - Each river and pond is its own node: `River 1`, `Pond 1` and so on, numbered in feature order.
  - Water gets no `-col` mesh.
- App name in UI copy: "Set Builder". TypeScript `strict: true`.

## Decisions (defaults; change any in review)

- **Feature model** (`web/src/features/features.ts`):
  ```ts
  type PathStyle = 'dirt' | 'cobble'
  interface SplinePoint { x: number; z: number }
  interface Spline { id: string; kind: 'path' | 'river'; style: PathStyle; width: number; points: SplinePoint[] }
  interface Pond { id: string; seed: SplinePoint; level: number }
  interface Features { splines: Spline[]; ponds: Pond[] }
  ```
  - `style` is ignored for rivers.
  - Widths are clamped as follows:

    | Kind | Allowed width | Default |
    | --- | --- | --- |
    | Path | 1–8 m | dirt 2 m, cobble 3 m |
    | River | 1–12 m | 3 m |
  - Ids come from `crypto.randomUUID()`. They are identity only: nothing generated depends on them.
- **Curve:** a centripetal Catmull-Rom curve through the points (every point lies on the curve), sampled every 0.5 m of arc length. The end segments use mirrored phantom points.
- **Path carving:**
  - **Grade:** the base height along the centreline, smoothed by a moving average. The average's window radius is `min(gradeWindow/2, distance to the nearer end)`, with `gradeWindow` = 8 m. So the grade at an end equals the base height there, and paths snapped together meet at the same height.
  - **Cross-section:**
    - Within `width/2` of the centreline, the height is the grade.
    - Out to `width/2 + shoulder` (shoulder = 2 m), it blends back to the base with smoothstep.
  - **Surface:** the path colour fills `width/2`. The verge colour (`#6f7d3c`) fills a further 0.75 m band. Dirt is `#8a6a45` and cobble is `#8d8a84`.
- **River carving:**
  - **Flow direction:** a river flows from whichever end has the higher smoothed grade (ties: first point to last).
  - **Bank line:** the smoothed grade, then a running minimum along the flow. This makes it non-increasing, so the bed only goes downhill.
  - **Water surface:** bank − `freeboard` (0.2 m).
  - **Bed:** a parabola across the width, `water − depth·(1 − (2d/width)²)`. Depth is `clamp(0.4·width, 0.5, 2)` m.
  - **Banks:** carved to `min(base, bank)` across the width, with a 2 m smoothstep shoulder back to the base.
  - **Surface:** the bed colour (`#5b4d3a`) fills the width.
- **Overlaps:**
  - All paths are applied first, then all rivers, each in array order.
  - A path blends the running height toward its grade by its weight.
  - A river takes `min(running height, river height)`. So a river cutting a road leaves a ford.
  - Surface weights overwrite in the same order.
- **Exclusion mask** (1 m biome grid): a sample is 1 when any of these hold:
  - it is within `width/2 + clearMargin` of a path centreline (path margin 1 m);
  - it is within `width/2 + clearMargin` of a river centreline (river margin 1.5 m);
  - it is within 1 m of a flooded pond sample.
- **Ponds:**
  - **Fill:** a 4-connected flood fill on the carved 0.5 m heights, from the sample nearest the seed, over samples with height < level.
  - **Empty pond:** if the seed sample is at or above the level, the pond is empty. It shows nothing but stays selectable by its seed handle.
  - **Spill cap:** if the fill would reach the scene edge, the effective level becomes the spill height − 0.05 m. The spill height is the lowest level at which the fill touches the edge, found by priority flood from the seed.
  - **No carving:** ponds don't carve terrain.
  - **New ponds:** the default level is the seed height + 1 m.
- **Water meshes** (built from the ground; never saved):
  - **River:** a ribbon along the centreline samples at the water-surface height, `width` wide, with two vertices per sample.
  - **Pond:** one flat quad per 0.5 m height cell that has any corner flooded, at the effective level. The terrain hides the overhang.
- **Where the ground is rebuilt:**
  - **Stroke:** the stroke's rect, grown to the full footprint (bbox + `width/2` + shoulder) of any spline whose footprint it touches. A spline's grade depends on base heights all along it.
  - **Feature edit:** the union of the old and new footprints of the changed splines.
  - **Ponds:** recomputed in full after any rebuild. A flood fill over 513² samples is cheap.
  - **Dirty chunks:** both mesh and scatter chunks are marked for the rebuilt rect and the pond masks' changed bboxes. A `waterVersion` counter increments whenever water geometry may have changed.
- **Undo:** one stack whose entries are `LayerPatch | FeaturesPatch` (`{ kind: 'features', before: Features, after: Features }`).
  - A whole spline-point drag, a pond-level drag, a width change or a delete is one entry.
  - Feature entries count toward `maxStrokes` and toward `maxBytes` (as JSON length × 2).
- **Tools and input:**
  - **Toolbar:** gets Path, River and Water (pond) after Paint. There are no letter shortcuts, as in M2.
  - **Path and River tools:**
    - Click to add a point; double-click or Enter finishes. Escape cancels the draft, and Backspace removes its last point.
    - A finished spline needs ≥ 2 points; otherwise it is discarded.
    - When starting or finishing, a click within `snapDistance` (2 m) of an existing spline end of the same kind snaps exactly onto that end.
  - **Selecting and editing:** with a Path or River tool and no draft, clicking within `width/2 + 1` m of a spline of that kind selects it, and its points show as handles.
    - Drag a handle to move a point.
    - Alt-click on the curve inserts a point.
    - Delete/Backspace removes the hovered handle's point, or the whole spline when the spline has 2 points or no handle is hovered.
    - The panel edits width and, for paths, the style.
  - **Water tool:**
    - Click inside a pond's flooded area or on its seed handle to select it. Otherwise a click makes a new pond.
    - Dragging vertically after the click sets the level at 0.05 m per pixel (up raises).
    - The panel has a level slider over the base height ± 10 m, and Delete.

## Review Focus

1. **Moving a path restores the ground it left:** dragging a path across a hill and then back, or deleting it, leaves carved heights byte-identical to the base outside every remaining footprint. Undo and redo of the drag give byte-identical grounds. Tests in Task 5.
2. **Sculpting under and beside features:**
   - Raising terrain under a path keeps the path's cross-section flat at its new grade.
   - Lowering a river's bank never makes its bed run uphill.
   - A stroke far from any feature rebuilds only its own chunks.

   Tests in Task 5.
3. **Ponds that would flood the map:** a seed on flat ground, a seed in a basin open on one side to the scene edge, and a level raised above the rim all cap at the spill height − 0.05 m and never flood past the rim. A seed above its level gives an empty pond. Tests in Task 4.
4. **Degenerate drawing input:**
   - A spline with two identical points, a zero-length segment, points dragged outside the scene, a 200-point spline, or an extra click past the limit never produces NaN heights or crashes the mesh.
   - Points are clamped to bounds.
   - Clicks past the limit are ignored, with the info message "A spline can have at most 200 points."

   Tests in Tasks 2 and 8.
5. **Unified undo across kinds:** sculpt, add a path, paint, then drag a path point. Undo four times and every layer and the features are back to the start. Redo four times and they match again, with only the touched chunks dirtied each time. Undo mid-draft cancels the draft without touching history. Tests in Tasks 5 and 8.

---

## File structure

```
web/src/features/features.json   # tuning: widths, margins, depths, colours, snapDistance
web/src/features/features.ts     # types, defaults, limits, zod schema, featuresBytes()
web/src/features/spline.ts       # Catmull-Rom sampling, nearest point, end snapping
web/src/features/carve.ts        # spline profiles, carveRect(): carved heights + surface + exclusion
web/src/features/ponds.ts        # floodPond(): mask, effective level, spill cap
web/src/features/ground.ts       # Ground: derived layers, incremental rebuild, dirty rects
web/src/features/water.ts        # river ribbon and pond surface geometry
web/src/tools/splineInput.ts     # pure draft/edit state machine for Path and River
web/src/tools/pondInput.ts       # pure create/select/level-drag logic for Water
web/src/viewport/WaterMesh.tsx   # renders water from the ground
web/src/viewport/FeatureRig.tsx  # pointer handling, handles and draft line for the feature tools
web/src/editor/FeaturePanel.tsx  # width/style/level/delete for the selection
```
Modified files:
- **Scene:** `scene/scene.ts`, `scene/sceneFile.ts`.
- **Terrain:** `terrain/history.ts`, `terrain/terrainEditor.ts`, `terrain/chunks.ts`.
- **Scatter:** `scatter/scatterManager.ts`.
- **Export:** `export/exportScene.ts`.
- **Editor:** `editor/editorStore.ts`, `editor/sceneActions.ts`, `editor/ToolBar.tsx`, `editor/shortcuts.ts`.
- **Viewport:** `viewport/Viewport.tsx`, `viewport/TerrainMesh.tsx`, `viewport/BrushRig.tsx` (picks against carved heights).
- **Docs:** `README.md`.

---

### Task 1: Feature model and scene format v3

**Files:**
- Create: `web/src/features/features.json`, `web/src/features/features.ts`, `web/src/features/features.test.ts`
- Modify: `web/src/scene/scene.ts`, `web/src/scene/sceneFile.ts`, `web/src/scene/sceneFile.test.ts`

**Interfaces:**
- Produces:
  - The types in Decisions.
  - `FEATURES: typeof features.json` and `FEATURE_LIMITS = { maxSplines: 200, maxPoints: 200, maxPonds: 50 }`.
  - `emptyFeatures(): Features`.
  - `defaultWidth(kind, style): number`.
  - `featuresSchema(size: SceneSize)`: zod; it clamps widths and rejects out-of-bounds points, splines with < 2 points and over-limit lists.
  - `featuresBytes(f: Features): number`.
  - `Scene` gains `features: Features`, with `formatVersion: 3`.

- [ ] **Step 1: Write failing tests**:
  - `parseScene` upgrades a v2 scene to v3 with empty features and `generatorVersion` 3.
  - It round-trips a v3 scene with two splines and a pond.
  - It rejects a point at x = size/2 + 1, a 1-point spline, 201 splines, and `generatorVersion: 4` (`newer-version`).
  - It clamps a path width of 20 to 8.
  - `createScene` has empty features.
- [ ] **Step 2: Run** `cd web && npm test -- sceneFile features` and expect it to fail.
- [ ] **Step 3: Implement.** Bump both versions, add a v3 zod schema, and add v1/v2 → v3 upgrade branches in `parseScene`.
- [ ] **Step 4: Run** the same filter and expect it to pass. Then run the full `npm test`, because existing fixtures that build `Scene` literals need `features`.
- [ ] **Step 5: Commit**: `"Add the feature model and scene format v3"`

### Task 2: Spline curves

**Files:** Create `web/src/features/spline.ts`, `web/src/features/spline.test.ts`

**Interfaces:**
- Produces:
  - `interface SplineSamples { xs: Float32Array; zs: Float32Array; s: Float32Array /* arc length */; length: number }`
  - `sampleSpline(points: SplinePoint[], step = 0.5): SplineSamples`
  - `nearestOnSamples(sm: SplineSamples, x: number, z: number): { index: number; distance: number; s: number }`
  - `snapToEnd(p: SplinePoint, splines: Spline[], kind: Spline['kind'], exclude?: string): SplinePoint`
  - `splineBounds(sm: SplineSamples, pad: number): { x0: number; z0: number; x1: number; z1: number }` (world metres)

- [ ] **Step 1: Write failing tests**:
  - Sampling passes through every control point (within 1e-4).
  - Sample spacing is 0.5 ± 0.05 m on a curved 4-point spline.
  - A straight 2-point spline of length 10 gives 21 samples.
  - Duplicate consecutive points and a 2-point spline with both points equal give finite samples with no NaN, and a length ≥ 0.
  - `nearestOnSamples` gives a distance of 0 on the curve.
  - `snapToEnd` snaps within 2 m to the end of a same-kind spline, ignores a river end for a path, and ignores the excluded id.
- [ ] **Step 2: Run** `npm test -- spline` and expect it to fail.
- [ ] **Step 3: Implement.** Centripetal Catmull-Rom (alpha 0.5) per segment, densely evaluated and then resampled by arc length. Skip zero-length segments.
- [ ] **Step 4: Run** and expect it to pass.
- [ ] **Step 5: Commit**: `"Sample spline curves by arc length"`

### Task 3: Carving, surface and exclusion

**Files:** Create `web/src/features/carve.ts`, `web/src/features/carve.test.ts`

**Interfaces:**
- Consumes: Task 2's `sampleSpline` and `nearestOnSamples`, and `Heightmap` from `terrain/layers`.
- Produces:
  - `interface SplineProfile { spline: Spline; samples: SplineSamples; grade: Float32Array /* bank for rivers */; water: Float32Array | null; footprint: Rect /* height-sample indices */ }`
  - `profileSpline(base: Heightmap, spline: Spline): SplineProfile`
  - `interface SurfaceMap { kind: Uint8Array; weight: Uint8Array }`: one entry per height sample. `kind` is 0 none, 1 dirt, 2 cobble, 3 verge, 4 river bed.
  - `carveRect(base: Heightmap, profiles: SplineProfile[], rect: Rect, outHeights: Float32Array, outSurface: SurfaceMap): void`: writes only samples inside `rect`. Outside every footprint it copies the base.
  - `exclusionRect(profiles: SplineProfile[], biomeRes: number, size: SceneSize, rect: Rect /* biome-sample indices */, out: Uint8Array): void`
- Algorithm note:
  - Each sample in a footprint finds its nearest centreline sample through a coarse spatial bucket of the profile's samples (cell size 4 m) and uses that sample's grade or water height.
  - Order and blend rules are as in Decisions.

- [ ] **Step 1: Write failing tests** on a 64 m scene with a 1:4 slope plus noise:
  - **Paths:**
    - Every sample within `width/2 − 0.25` of a straight 3 m dirt path's centreline is within 1e-3 of the grade.
    - Samples beyond `width/2 + shoulder` equal the base exactly.
    - The grade at both ends equals the base height there.
  - **Rivers:**
    - The water height is non-increasing along the flow, including for a river drawn uphill: it reverses.
    - The bed at the centre is water − depth.
    - Bank samples are ≤ base.
  - **Crossing:** where a river crosses a road, the height is the river's.
  - **Exclusion:**
    - It covers `width/2 + clearMargin` and nothing beyond `+ 1` m.
    - `carveRect` over the whole scene equals the union of four quadrant calls, byte for byte.
  - **Degenerate input:** a zero-length spline changes nothing and produces no NaN.
- [ ] **Step 2: Run** `npm test -- carve` and expect it to fail.
- [ ] **Step 3: Implement** with the signatures above.
- [ ] **Step 4: Run** and expect it to pass.
- [ ] **Step 5: Commit**: `"Carve paths and rivers into the ground"`

### Task 4: Pond flooding

**Files:** Create `web/src/features/ponds.ts`, `web/src/features/ponds.test.ts`

**Interfaces:**
- Produces:
  - `interface PondFill { mask: Uint8Array /* height samples */; level: number /* effective */; capped: boolean; bounds: Rect | null }`
  - `floodPond(h: Heightmap, pond: Pond): PondFill`

- [ ] **Step 1: Write failing tests**:
  - A bowl with a rim at 3 m and level 2 floods exactly the samples below 2, with `capped` false.
  - At level 5 it caps at the 3 m rim minus 0.05 m, with `capped` true, and no sample outside the rim is flooded.
  - A bowl open to the scene edge on one side caps at its lowest edge-reaching saddle.
  - On a flat scene the pond is empty or capped, and never floods to the edge.
  - A seed above its level gives an empty mask and `bounds: null`.
  - Two basins separated by a 4 m ridge: a pond in one never floods the other at level 3.
- [ ] **Step 2: Run** `npm test -- ponds` and expect it to fail.
- [ ] **Step 3: Implement** a priority flood (a binary-heap queue of height samples) from the seed to find the spill height, then a 4-connected fill below the effective level.
- [ ] **Step 4: Run** and expect it to pass.
- [ ] **Step 5: Commit**: `"Flood ponds up to their level or spill height"`

### Task 5: Ground, feature edits and unified undo in TerrainEditor

**Files:**
- Create: `web/src/features/ground.ts`, `web/src/features/ground.test.ts`
- Modify: `web/src/terrain/history.ts`, `web/src/terrain/terrainEditor.ts`, `web/src/terrain/terrainEditor.test.ts`, `web/src/terrain/history.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces:
  - `class Ground`:
    - `constructor(base: TerrainLayers, features: Features)`
    - `readonly layers: TerrainLayers`: carved heights; the biomes are the base's biome map by reference.
    - `readonly surface: SurfaceMap`
    - `readonly exclusion: Uint8Array | null`: null when there are no features.
    - `readonly ponds: PondFill[]`
    - `readonly profiles: SplineProfile[]`
    - `rebuild(features: Features, heightRect: Rect | null): Rect[]`: returns the height rects that changed.
  - `HistoryEntry = LayerPatch | FeaturesPatch`, with `StrokeHistory` storing `HistoryEntry`.
  - `TerrainEditor`:
    - The constructor gains `features: Features` (4th parameter, after `seed`).
    - `readonly ground: Ground`
    - `get features(): Features`
    - `commitFeatures(next: Features): void`: pushes a `FeaturesPatch`, rebuilds and fires `onChange('stroke')`.
    - `previewFeatures(next: Features): void`: rebuilds and dirties without pushing to history. It is used while dragging, followed by one `commitFeatures` on release, whose `before` is the features at drag start.
    - `waterVersion: number`
    - `TerrainChange` is unchanged.

- [ ] **Step 1: Write failing tests**:
  - **No features:** `ground.layers.heights.data` equals `base` byte for byte, and `exclusion` is null.
  - **Moving a path back and forth:** commit a path, move it 10 m, then move it back. Heights equal those after the first commit, byte for byte. Deleting it restores the base exactly.
  - **Sculpting under a path:**
    - A raise stroke under a path keeps the path's cross-section flat.
    - A stroke 40 m from any spline dirties only the chunks of `chunksForHeightRect(strokeRect)`.
  - **Unified undo:**
    - Sculpt, then add a path, then paint, then preview and commit a point drag. Undo ×4 restores the initial layers, features and ground. Redo ×4 matches the end state, byte for byte.
    - Previews never add history entries.
  - **Dirtying:**
    - `commitFeatures` marks the mesh and scatter chunks covering the old ∪ new footprints, and no others.
    - `waterVersion` increments when a river or pond changes.
  - **History limits:** feature entries count toward `maxStrokes`.
- [ ] **Step 2: Run** `npm test -- ground terrainEditor history` and expect it to fail.
- [ ] **Step 3: Implement.**
  - `Ground` keeps `profiles` in feature order. It reprofiles only the splines whose definition changed or whose footprint meets `heightRect`.
  - `TerrainEditor.markDirty` calls `ground.rebuild` and then dirties every returned rect.
  - `apply()` handles both entry kinds.
- [ ] **Step 4: Run** and expect it to pass, along with the full `npm test`.
- [ ] **Step 5: Commit**: `"Derive the carved ground from layers and features, with one undo stack"`

### Task 6: Terrain colours, picking and scatter from the ground

**Files:**
- Modify: `web/src/terrain/chunks.ts`, `web/src/terrain/chunks.test.ts`, `web/src/viewport/TerrainMesh.tsx`, `web/src/viewport/BrushRig.tsx`, `web/src/scatter/scatterManager.ts`, `web/src/scatter/scatterManager.test.ts`, `web/src/terrain/palette.ts`

**Interfaces:**
- Consumes: `Ground` (Task 5) and `FEATURES` colours (Task 1).
- Produces:
  - `buildChunkGeometry(l, chunk, p, surface?: SurfaceMap)` and `updateChunkGeometry(l, chunk, p, g, surface?)`: the vertex colour is lerped from the terrain colour to the surface colour by `weight/255`.
  - `TerrainPalette` gains `surface: [RGB, RGB, RGB, RGB]` (dirt, cobble, verge, bed).

- [ ] **Step 1: Write failing tests**:
  - **Colours:**
    - A chunk vertex on a dirt path's centreline has the dirt colour.
    - A vertex outside every footprint is unchanged from M2: the existing colour tests still pass with `surface` omitted.
  - **Scatter:**
    - `ScatterManager` sends the carved heights and the ground's exclusion.
    - With an all-forest scene and one path, no instance lies within `width/2 + clearMargin` of the centreline.
    - Chunks away from the path have the same instances as with no path.
- [ ] **Step 2: Run** `npm test -- chunks scatterManager` and expect it to fail.
- [ ] **Step 3: Implement.**
  - `TerrainMesh` builds from `terrain.ground.layers` with `terrain.ground.surface`.
  - `BrushRig` raycasts `terrain.ground.layers.heights`, so the brush cursor sits on carved ground.
  - Brushes still write the base layers.
- [ ] **Step 4: Run** and expect it to pass.
- [ ] **Step 5: Commit**: `"Render and scatter from the carved ground"`

### Task 7: Water geometry and rendering

**Files:** Create `web/src/features/water.ts`, `web/src/features/water.test.ts`, `web/src/viewport/WaterMesh.tsx`; modify `web/src/viewport/Viewport.tsx`

**Interfaces:**
- Consumes: `SplineProfile.water`, `PondFill`.
- Produces:
  - `interface WaterGeometry { name: string; positions: Float32Array; indices: Uint32Array }`
  - `buildWater(ground: Ground): WaterGeometry[]`: rivers first, then ponds, in feature order, named `River n` / `Pond n`. Empty ponds are skipped.
  - `WATER_MATERIAL` parameters from `features.json`.

- [ ] **Step 1: Write failing tests**:
  - **Ponds:** every pond vertex y equals the effective level, and every flooded sample lies under a triangle.
  - **Rivers:**
    - A river ribbon has 2 × samples vertices.
    - The midpoints of each vertex pair follow the centreline, and the pairs are `width` apart.
    - y is non-increasing along the flow.
  - **Naming:** two rivers and an empty pond give `River 1`, `River 2` and nothing else.
  - **Validity:** all positions are finite.
- [ ] **Step 2: Run** `npm test -- water` and expect it to fail.
- [ ] **Step 3: Implement.**
  - `WaterMesh` rebuilds its meshes when `terrain.waterVersion` changes.
  - It uses one flat-shaded, transparent `MeshStandardMaterial` with `depthWrite: false` and `renderOrder` 1.
- [ ] **Step 4: Run** and expect it to pass.
- [ ] **Step 5: Commit**: `"Build and render river and pond water"`

### Task 8: Path and River tools

**Files:**
- Create: `web/src/tools/splineInput.ts`, `web/src/tools/splineInput.test.ts`, `web/src/viewport/FeatureRig.tsx`, `web/src/editor/FeaturePanel.tsx`, `web/src/editor/FeaturePanel.test.tsx`
- Modify: `web/src/editor/editorStore.ts`, `web/src/editor/ToolBar.tsx`, `web/src/editor/ToolBar.test.tsx`, `web/src/editor/shortcuts.ts`, `web/src/editor/shortcuts.test.ts`, `web/src/viewport/Viewport.tsx`

**Interfaces:**
- Consumes: `snapToEnd`, `nearestOnSamples` (Task 2), and `commitFeatures`/`previewFeatures` (Task 5).
- Produces:
  - `ToolId = 'terrain' | 'paint' | 'path' | 'river' | 'water'`.
  - The store gains `selection: { kind: 'spline' | 'pond'; id: string } | null`, `setSelection` and `pathStyle: PathStyle`.
  - `class SplineInput`, which is pure:
    - `constructor(kind, getFeatures, size)`
    - `click(p, opts: { alt: boolean })`
    - `doubleClick(p)`
    - `pointerDown(p)` / `pointerMove(p)` / `pointerUp()`
    - `key(k: 'Enter' | 'Escape' | 'Backspace' | 'Delete')`
    - `get draft(): SplinePoint[] | null`
    - `get selectedId(): string | null`
    - The result of each event is `{ preview?: Features; commit?: Features; message?: string } | null`.

- [ ] **Step 1: Write failing tests** for `SplineInput`:
  - **Drafting:**
    - Three clicks and a double-click commit one path with 3 points. The double-click's duplicate point is dropped.
    - One click and then Enter commits nothing.
    - Escape clears the draft. Backspace removes the last draft point.
  - **Snapping:** the start and end snap to existing path ends within 2 m, but not to river ends.
  - **Clamping:** points outside bounds clamp to the edge.
  - **Point limit:** the 201st click returns the message "A spline can have at most 200 points." and adds nothing.
  - **Selecting and editing:**
    - A click near an existing path with no draft selects it.
    - A handle drag yields previews on move and exactly one commit on release.
    - Alt-click on the curve inserts a point between the right neighbours.
    - Delete with a hovered handle removes that point. On a 2-point spline it removes the spline.
  - **Store, toolbar and panel:**
    - Undo while drafting cancels the draft and does not undo history.
    - The toolbar shows Path, River and Water.
    - The panel's width field clamps to the kind's range and commits once on change.
- [ ] **Step 2: Run** `npm test -- splineInput ToolBar FeaturePanel shortcuts` and expect it to fail.
- [ ] **Step 3: Implement.**
  - `FeatureRig` turns pointer events on the carved ground into `SplineInput` calls, and calls `previewFeatures`/`commitFeatures`.
  - It draws handles as small spheres and the draft as a line.
  - `shortcuts.ts` routes Enter, Escape, Backspace and Delete to the active feature tool when one is selected.
- [ ] **Step 4: Run** and expect it to pass.
- [ ] **Step 5: Browser check** (one pass), with a screenshot of each:
  - A dirt trail and a cobble road snapped together over a hill.
  - A river down a slope.
  - Scatter cleared along both.
  - A point drag at 60 fps on a 256 m scene with 20 splines.
- [ ] **Step 6: Commit**: `"Add the Path and River tools"`

### Task 9: Water (pond) tool

**Files:**
- Create: `web/src/tools/pondInput.ts`, `web/src/tools/pondInput.test.ts`
- Modify: `web/src/viewport/FeatureRig.tsx`, `web/src/editor/FeaturePanel.tsx`, `web/src/editor/FeaturePanel.test.tsx`

**Interfaces:**
- Consumes: `Ground.ponds`, `floodPond`, `FEATURE_LIMITS.maxPonds`.
- Produces: `class PondInput`, which has the same event/result shape as `SplineInput`.

- [ ] **Step 1: Write failing tests**:
  - **Creating:** a click on dry ground creates a pond at the seed height + 1 m.
  - **Level drag:** dragging up 40 px raises the level by 2 m, with previews during the drag and one commit on release.
  - **Selecting:** a click inside an existing pond's mask selects it rather than creating a new one.
  - **Pond limit:** the 51st pond gives the message "A scene can have at most 50 ponds." and is not created.
  - **Panel:**
    - The level slider spans base ± 10 m.
    - It shows "Capped at the spill height" when `capped`.
    - Delete removes the pond.
- [ ] **Step 2: Run** `npm test -- pondInput FeaturePanel` and expect it to fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and expect it to pass.
- [ ] **Step 5: Browser check:** a pond in a dug basin, raised until it caps at the rim.
- [ ] **Step 6: Commit**: `"Add the Water tool for ponds"`

### Task 10: Save, open and export with features

**Files:**
- Modify: `web/src/editor/editorStore.ts`, `web/src/editor/sceneActions.ts`, `web/src/editor/sceneActions.test.ts`, `web/src/export/exportScene.ts`, `web/src/export/exportScene.test.ts`, `web/src/editor/editorStore.test.ts`
- Docs: `README.md`

**Interfaces:**
- Consumes: `TerrainEditor.features`, `Ground`, `buildWater`.
- Produces:
  - `ExportInput` gains `ground: Ground`. The terrain is built from `ground.layers` + `ground.surface`.
  - The export's scatter inputs use the carved heights and `ground.exclusion`.

- [ ] **Step 1: Write failing tests**:
  - **Saving and opening:**
    - `saveCurrent` stores a scene whose `features` equal `terrain.features`.
    - `replaceScene` builds the editor with the scene's features.
    - Download then upload round-trips the features, with an identical ground, byte for byte.
  - **Export:**
    - The export of a scene with a river and a pond has nodes `River 1` and `Pond 1` using material `water`, with no `-col` for them.
    - The terrain colours under a path are the dirt colour.
    - No exported scatter instance lies in the exclusion mask.
    - A scene with no features exports exactly as in M2: the existing export tests pass unchanged.
- [ ] **Step 2: Run** `npm test -- sceneActions exportScene editorStore` and expect it to fail.
- [ ] **Step 3: Implement.** Add the Path, River and Water controls to the README.
- [ ] **Step 4: Run** the full `cd web && npm test`, and `cd server && ./gradlew test -PskipWeb -q` with `JAVA_HOME=/opt/homebrew/opt/openjdk@21`. Expect both to pass.
- [ ] **Step 5: Blender check:** export the Task 9 scene and import it headless into the installed Blender. Expect `River 1` and `Pond 1` at the right heights, in metres.
- [ ] **Step 6: Commit**: `"Save and export paths, rivers and ponds"`

---

## Done when

- Both test suites pass.
- In the browser, a new user can draw a path to a spot, a river down a hillside and a pond in a hollow:
  - the terrain carves under them;
  - scatter clears around them;
  - sculpting nearby keeps them consistent;
  - undo walks back through every kind of edit.
- Save, reload and download/upload keep the features. M2 scenes open unchanged.
- The `.glb` shows the paths in the terrain colours, and the rivers and ponds as named water nodes, in Blender.
- Not verified by unit tests (manual checks in Tasks 8–10): how water looks, frame rate while dragging, and the Blender import.
