# Volumetric Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sculpt overhangs, arches, ledges and undercuts anywhere with new 3D brush modes, while the 2D brushes, paint, scatter, select, paths, ponds, save and export keep working.

**Architecture:**
- A sparse **volume layer** (8³ voxel bricks of Int8 Add/Carve values) joins `TerrainLayers` beside the heightmap and biome map.
- `Ground.density()` becomes `smin(min(max(h − y, A), −K, −pathCut), c)`. Any chunk that meets a brick footprint is meshed as an SDF chunk by the M3b cave chunk builder, generalized.
- With no bricks, every output is byte-identical to today.

**Tech Stack:** React + Three.js (WebGPU), TypeScript, Vitest (jsdom, fake-indexeddb), fflate zips. No new npm dependencies; no server changes.

**Spec:** `docs/superpowers/specs/2026-10-17-volumetric-terrain-design.md` (read it first). Background: `docs/plans/2026-10-15-m3b-caves.md` (SDF chunks, seam argument).

## Global Constraints

- **No bricks means no change:** chunk geometry, exclusion, scatter, pond fills and exports are byte-identical to `main` for a scene with an empty volume layer.
- **Determinism:** density, meshes and scatter are pure functions of (layers incl. volume, features). No `Math.random`.
- **Bricks:** 8×8×8 voxels, 0.5 m spacing (4 m cube). Voxel (vi, vj, vk) sits at height sample (i = vi, j = vj) and world y = vk·0.5. Brick (bx, by, bz) holds vi ∈ [8bx, 8bx+7], vk ∈ [8by, 8by+7], vj ∈ [8bz, 8bz+7]. Brick coordinates are Int16.
- **Values:** A and K are Int8 in 1/32 m steps, clamped to [−2, 2] m (stored −64…64). Default (no brick) is −2 for both. A brick whose voxels are all default is deleted.
- **Voxel order** in a brick and on disk: index = (ly·8 + lz)·8 + lx (x fastest, then z, then y).
- **Limits:** at most 8,000 bricks per scene. 3D brush radius 1–12 m. The surface moves at most 0.5 m per dab (strength 1).
- **Footprint:** a brick's footprint is its xz extent + 2 m (4 height samples) as a height-sample `Rect`. A chunk is an SDF chunk if its sample square meets any cave or brick footprint.
- **Formats:** `SCENE_FORMAT_VERSION = 5`, `GENERATOR_VERSION = 5`. Zip entry `volume.i8`: Uint32 count, then per brick Int16 bx, by, bz, 512 A bytes, 512 K bytes (little-endian). v1–v4 load with no bricks; newer are `newer-version`; malformed is `invalid-layers`.
- **Scatter headroom:** a scatter site needs ≥ 3 m of air above it. At most 4 levels per column.
- **Path cut:** height samples whose `surface.kind !== SURFACE.none` force air from the carved height `h` up to `h + 4 m`.
- **Performance:** one SDF chunk meshes in ≤ 30 ms on a 256 m scene; strokes remesh at most once per frame.

## Review Focus

1. **Brush on a scene edge or at the height limits:** bricks outside the scene square or outside [MIN_HEIGHT, MAX_HEIGHT] are never created, so there's no crash or out-of-range save. Owned by Task 4.
2. **Carving clean through the bottom of the world (y < MIN_HEIGHT):** the mesh stays closed, because the field is forced solid at the chunk's y0. Owned by Task 3.
3. **Undo mid-3D-stroke, and undo after hitting the brick cap:** the cancelled-drag rule applies as in 2D, and the cap message doesn't leave a half-recorded stroke. Owned by Task 5.
4. **Loading a v5 file whose bricks are all default or duplicated:** default bricks are dropped, and duplicates are rejected as `invalid-layers`. Owned by Task 8.
5. **A 2D Raise under a 3D ledge, then undo:** the ledge returns exactly (bricks are untouched by 2D strokes). Owned by Task 5.

---

### Task 1: Volume layer

**Files:**
- Create: `web/src/terrain/volume.ts`, `web/src/terrain/volume.test.ts`
- Modify: `web/src/terrain/layers.ts` (`TerrainLayers`, `createFlatLayers`, `cloneLayers`)

**Interfaces:**
- Produces:
  ```ts
  export const BRICK = 8
  export const VOXEL_STEP = 1 / 32       // metres per Int8 unit
  export const VALUE_LIMIT = 2           // metres; default value is −VALUE_LIMIT
  export const MAX_BRICKS = 8000
  export interface Brick { a: Int8Array; k: Int8Array } // 512 each
  export const brickKey = (bx: number, by: number, bz: number) => number // packs three Int16
  export function unpackKey(key: number): [number, number, number]
  export class VolumeLayer {
    constructor(size: SceneSize)
    readonly size: SceneSize
    get count(): number
    keys(): IterableIterator<number>
    get(key: number): Brick | undefined
    /** Copy of a brick, or null when absent (= all default). */
    copy(key: number): Brick | null
    /** Sets or (null / all-default) deletes a brick. */
    put(key: number, brick: Brick | null): void
    /** Trilinear A and K (metres) at a world point; (−2, −2) where no brick reaches. */
    sample(x: number, y: number, z: number, out: { a: number; k: number }): void
    /** Lattice read for meshing: height sample (i, j), world y on the 0.5 m grid. */
    sampleLattice(i: number, j: number, y: number, out: { a: number; k: number }): void
    /** Height-sample footprints (brick xz + 4 samples), one per brick. */
    footprints(): Rect[]
    /** Lowest and highest world y any brick over sample column (i, j) covers, or null. */
    columnRange(i: number, j: number): readonly [number, number] | null
    clone(): VolumeLayer
  }
  ```
- `TerrainLayers` gains `volume: VolumeLayer`. `createFlatLayers` gives an empty one, and `cloneLayers` clones it.

- [ ] **Step 1: Write failing tests** in `volume.test.ts`:
  - `brickKey`/`unpackKey` round-trip for (−4, −4, −4), (0, 0, 0), (63, 15, 63).
  - Empty layer: `sample` at any point gives `{a: -2, k: -2}`.
  - `put` a brick with one voxel `a = 32` (1 m) at local (0, 0, 0): `sampleLattice` at that voxel is 1. `sample` halfway to the next voxel in x gives (1 + −2)/2 = −0.5.
  - `put` an all-default brick: `count` stays 0.
  - `copy` returns an independent copy (mutating it doesn't change the layer).
  - `footprints()` for brick (1, 0, 2) is `{x0: 4, z0: 12, x1: 19, z1: 27}`.
  - `cloneLayers` deep-copies volume.
- [ ] **Step 2:** Run `cd web && npm test -- volume layers`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `volume.ts` and the `layers.ts` changes. Use a `Map<number, Brick>`. Trilinear sampling reads up to 8 voxels across brick boundaries, and missing bricks read as −64. Fix every `TerrainLayers` literal the compiler flags (tests and fixtures) by using `createFlatLayers` or adding `volume: new VolumeLayer(size)`.
- [ ] **Step 4:** Run `npm test -- volume layers` and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5:** Commit: `Add a sparse volume layer of Add/Carve voxel bricks`.

### Task 2: Density, path cut and picking

**Files:**
- Modify: `web/src/features/ground.ts` (`density`, `raycast`, `isSdfChunk`, new `volumeChunks` bitset)
- Test: `web/src/features/ground.test.ts`

**Interfaces:**
- Consumes: `VolumeLayer.sample`, `footprints` (Task 1). `SurfaceMap.kind`, `SURFACE.none` (carve.ts).
- Produces:
  - `Ground.density(x, y, z, ignoreCaves = false): number` implements the spec formula, with `pathCut(p) = kind ≠ none at the nearest sample ? min(y − h, h + 4 − y) : −Infinity` and `s = min(..., −pathCut)` before the cave smin.
  - `Ground.hasVolume(chunk: number): boolean`, true when the chunk's sample square meets a brick footprint.
  - `Ground.refreshVolume(): Rect[]` recomputes footprints and the bitset, returning the union of old and new footprints so the caller can mark chunks dirty.
  - `isSdfChunk(chunk) = cavesOf(chunk).length > 0 || hasVolume(chunk)`.
  - `raycast(origin, dir, ignoreCaves)` passes a density whenever caves (not ignored) or bricks exist. `ignoreCaves` drops only the cave term.
  - The carved `this.layers.volume` is the same object as `base.volume` (not a copy).

- [ ] **Step 1: Write failing tests:**
  - With no bricks, `density` equals `smoothMin(h − y, caveDistance, groundBlend)` exactly at 50 seeded points (compare with `===`).
  - A brick with A = 1 m at a voxel 3 m above flat ground: density there > 0.
  - A brick with K = 1 m at a voxel 1 m below ground: density < 0.
  - A path's carved sample with an Add brick 2 m above it: density ≤ 0 at 2 m, and > 0 at 5 m when A > 0 there.
  - `raycast` straight down onto an Add blob hits the blob top, not the ground.
  - `isSdfChunk` is true for a chunk 1 m from a brick footprint edge and false for a chunk 3 m away.
- [ ] **Step 2:** Run `npm test -- ground`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep the no-brick path identical: skip the volume and path terms entirely when `volume.count === 0`, so floating-point results match bit for bit.
- [ ] **Step 4:** Run `npm test -- ground pick`. Expected: PASS.
- [ ] **Step 5:** Commit: `Fold the volume layer and path clearance into ground density`.

### Task 3: Meshing SDF chunks with volume

**Files:**
- Modify: `web/src/features/caveChunk.ts` (rename the export to `buildSdfChunk`; keep the file), `web/src/features/ground.ts` (`chunkGeometry`)
- Test: `web/src/features/caveChunk.test.ts`, `web/src/terrain/sdfChunk.test.ts`

**Interfaces:**
- Consumes: `Ground.density` semantics (Task 2), `VolumeLayer.sampleLattice`, `columnRange` (Task 1).
- Produces: `buildSdfChunk(layers: TerrainLayers, surface: SurfaceMap, caves: CaveProfile[], chunk: number, p: TerrainPalette, holder?: CaveDistanceHolder): ChunkGeometry`, which reads `layers.volume` itself. `Ground.chunkGeometry` calls it for every `isSdfChunk` chunk. `ignoreCaves` passes `[]` caves but keeps the volume.

- [ ] **Step 1: Write failing tests:**
  - **Seam:** a brick near the corner of chunk 0 in a 64 m scene. Every vertex on the face chunk 0 shares with heightmap chunk 1 lies on chunk 1's heightmap edge line (reuse the M3b seam test helper).
  - **Ledge:** an Add blob on a 10 m vertical wall gives triangles with normal.y < −0.5 (an underside).
  - **Underside colour:** those vertices get the earth palette colour.
  - **Wall colour:** a vertex with a 70° normal gets rock.
  - **Floor of the world:** a carve brick at y = MIN_HEIGHT under flat ground gives a closed mesh (every edge shared by two triangles).
  - **Determinism:** chunk geometry with no bricks is byte-identical to `buildChunkGeometry` / today's cave chunk (existing snapshot tests stay green).
- [ ] **Step 2:** Run `npm test -- caveChunk sdfChunk`. Expected: FAIL.
- [ ] **Step 3:** Implement. In `buildSdfChunk`:
  - The density lambda adds the volume and path terms.
  - `lo`/`hi` widen by every brick column range in the chunk.
  - `band(i, j)` widens to `[min(floor, rangeLo − 2), max(ground, rangeHi + 2)]` where `columnRange` is non-null, and to `ground + 4` on path samples.
  - Colour: for vertices that aren't cave walls, `up/len < 0` → earth. Otherwise compute the slope from the true normal and use the existing slope→earth/rock shading.
  - Skip grass-overhang lips on SDF chunks.
- [ ] **Step 4:** Run `npm test -- caveChunk sdfChunk chunks overhang ground`. Expected: PASS. Run the perf test, or time `buildSdfChunk` on a 256 m scene with 200 bricks in one chunk: ≤ 30 ms. Record the number in the commit message.
- [ ] **Step 5:** Commit: `Mesh sculpted chunks from the density field with true-normal shading`.

### Task 4: 3D brush maths

**Files:**
- Create: `web/src/terrain/brush3d.ts`, `web/src/terrain/brush3d.test.ts`
- Modify: `web/src/terrain/brush.ts` (`TerrainMode`)

**Interfaces:**
- Consumes: `VolumeLayer`, `brickKey`, `MAX_BRICKS` (Task 1). `brushWeight` (brush.ts).
- Produces:
  ```ts
  export type TerrainMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise' | 'terrace' | 'add' | 'carve' | 'smooth3d'
  export const is3dMode = (m: TerrainMode) => m === 'add' || m === 'carve' || m === 'smooth3d'
  export const RADIUS_3D_MAX = 12
  export interface Dab3 { x: number; y: number; z: number; dt: number; invert: boolean }
  /** Applies one dab; returns touched brick keys (before-state captured via onFirstTouch), or 'limit'. */
  export function sculpt3d(
    v: VolumeLayer, mode: 'add' | 'carve' | 'smooth3d', b: BrushSettings, dab: Dab3,
    density: (x: number, y: number, z: number) => number,
    onFirstTouch: (key: number) => void,
  ): number[] | 'limit'
  ```
  - `add` (or `carve` with invert) raises A toward the sphere's signed distance: `A' = max(A, min(VALUE_LIMIT, r·w − d))`, approached by at most `0.5·strength·w` m per dab, where `d` is the distance to the centre and `w = brushWeight(d, b)`.
  - `carve` does the same on K.
  - `smooth3d` computes the 3×3×3 box blur of `density` at each voxel. Where the blur exceeds the current value, raise A by up to `0.5·strength·w`; where it's lower, raise K the same way.
  - Voxels outside the scene square or y ∉ [MIN_HEIGHT, MAX_HEIGHT] are skipped, and their bricks are never created.
  - If the dab would create bricks beyond `MAX_BRICKS`, return `'limit'` and change nothing.
  - The radius is clamped to `RADIUS_3D_MAX`.

- [ ] **Step 1: Write failing tests:**
  - An Add dab of radius 2 at (0, 5, 0) makes `sample(0, 5, 0).a > 0` and leaves every brick outside radius+1 absent.
  - A Carve dab only touches K.
  - Alt-Add equals Carve (identical bricks).
  - Repeated Add saturates at `VALUE_LIMIT`.
  - smooth3d on a 1-voxel spike lowers the spike (combined density at the spike drops).
  - A dab at the scene edge (x = size/2) creates no brick with voxels outside the square.
  - A dab at y = MAX_HEIGHT creates no brick above MAX_HEIGHT.
  - A layer with 7,999 bricks and a dab needing 3 new bricks returns `'limit'`, and `count` stays 7,999.
  - `onFirstTouch` is called exactly once per touched key per dab sequence (the caller dedupes; the test passes a Set).
- [ ] **Step 2:** Run `npm test -- brush3d`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -- brush3d brush`. Expected: PASS.
- [ ] **Step 5:** Commit: `Add Add, Carve and Smooth 3D brush maths on the volume layer`.

### Task 5: Editor strokes, plane lock and undo

**Files:**
- Modify: `web/src/terrain/terrainEditor.ts`, `web/src/terrain/history.ts`
- Create: `web/src/terrain/strokePlane.ts`, `web/src/terrain/strokePlane.test.ts`
- Test: `web/src/terrain/terrainEditor.test.ts`, `web/src/terrain/history.test.ts`

**Interfaces:**
- Consumes: `sculpt3d`, `is3dMode`, `Dab3` (Task 4). `Ground.refreshVolume`, `Ground.density` (Task 2).
- Produces:
  - `history.ts`: `export interface VolumePatch { kind: 'volume'; before: Map<number, Brick | null>; after: Map<number, Brick | null> }`. Add it to `HistoryEntry`. Its byte size counts 1,024 per non-null brick.
  - `strokePlane.ts`: `export interface Plane { point: Vec3; normal: Vec3 }`, `cameraPlane(hit: Vec3, cameraDir: Vec3): Plane`, `intersectPlane(origin: Vec3, dir: Vec3, plane: Plane): Vec3 | null`.
  - `TerrainEditor.beginStroke(tool, brush, at: GroundPoint & { y: number } | null)`: for 3D modes the stroke keeps a `Map` of before-copies.
  - `TerrainEditor.dab3(at: Vec3, dt: number, invert: boolean): 'ok' | 'limit'`.
  - `endStroke` pushes a `VolumePatch` with after-copies of the touched keys (skipped when before equals after).
  - `undo`/`redo` apply a `VolumePatch` with `put` and then `markVolumeDirty()`.
  - `markVolumeDirty()` calls `ground.refreshVolume()` and marks `chunksForHeightRect` of the returned rects on both channels.

- [ ] **Step 1: Write failing tests:**
  - `intersectPlane` hits a camera-facing plane at the expected point and returns null for a parallel ray.
  - Editor: an Add stroke then undo leaves `volume.count === 0` and marks the same chunks dirty.
  - Redo restores identical bricks.
  - Undo mid-3D-drag ends the stroke and ignores later `dab3` calls (same rule as 2D).
  - A 2D Raise stroke under an Add ledge, then undo: the bricks are byte-identical before and after.
  - A stroke that hits `'limit'` on its first dab records no history entry, and `dab3` returns `'limit'`.
  - A stroke that changed bricks then hit the limit records one entry with only the changes made.
- [ ] **Step 2:** Run `npm test -- strokePlane terrainEditor history`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `Record 3D strokes as volume patches with undo, redo and a stroke plane`.

### Task 6: 3D brush UI

**Files:**
- Modify: `web/src/editor/BrushPanel.tsx`, `web/src/viewport/BrushRig.tsx`, `web/src/viewport/BrushCursor.tsx`, `web/src/editor/editorStore.ts` (radius clamp on mode change), `README.md` (Controls: 3D modes)
- Test: `web/src/editor/BrushPanel.test.tsx`

**Interfaces:**
- Consumes: `is3dMode`, `RADIUS_3D_MAX` (Task 4). `dab3`, `cameraPlane`, `intersectPlane` (Task 5).
- Produces UI only.

- [ ] **Step 1: Write failing tests:**
  - BrushPanel shows a "3D" radiogroup with Add, Carve and Smooth 3D. Picking Add calls `setTerrainMode('add')`.
  - With a 3D mode selected, the size slider's max is 12.
  - Switching to a 3D mode with radius 30 clamps it to 12.
- [ ] **Step 2:** Run `npm test -- BrushPanel`. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - **Panel:** a second radiogroup labelled "3D".
  - **BrushRig, 3D modes:**
    - `pick` returns the full-density hit with its y.
    - On stroke start, store `cameraPlane(hit, cameraDir)`.
    - Later dabs use `intersectPlane` of the pointer ray instead of the ground pick, and call `terrain.dab3`.
    - A `'limit'` result sets `setMessage({ kind: 'error', text: 'Volume limit reached' })` once per stroke.
    - `hideCavesWhileStroking` still drops only the cave term.
  - **BrushCursor:** a wireframe sphere (three latitude rings) of the brush radius at the hit point for 3D modes; the ring as today otherwise.
  - **README:** add the 3D modes to the Terrain modes paragraph.
- [ ] **Step 4:** Run `npm test -- BrushPanel BrushRig BrushCursor`. Expected: PASS.
- [ ] **Step 5 (manual, one short pass):** run the dev server. Add a ledge off a cliff and carve an arch through it. Screenshot the arch. Check that strokes stay smooth on a 256 m scene.
- [ ] **Step 6:** Commit: `Add the 3D brush modes to the Terrain panel with a sphere cursor`.

### Task 7: Scatter on ledges, and ponds behind berms

**Files:**
- Modify: `web/src/scatter/scatter.ts`, `web/src/scatter/scatterManager.ts` (and its worker request type), `web/src/features/ground.ts`, `web/src/features/ponds.ts`
- Test: `web/src/scatter/scatter.test.ts`, `web/src/features/ground.test.ts`, `web/src/features/ponds.test.ts`

**Interfaces:**
- Consumes: `Ground.density`, `isSdfChunk` (Tasks 2–3).
- Produces:
  - `export interface SurfaceLevels { ci: number; cj: number; levels: number; y: Float32Array }` (65×65×levels, NaN-padded, top surface first; `y[(l·65 + lj)·65 + li]`).
  - `Ground.surfaceLevels(chunk: number): SurfaceLevels | null`, null for heightmap chunks. Each lattice column scans the density from the band top down in 0.5 m steps. It records each air→solid crossing (linearly refined) that has ≥ 3 m of air above it, up to 4.
  - `ScatterInputs.levels?: Map<number, SurfaceLevels>`, sent to the worker as a plain array of chunk/levels pairs.
  - In scatter, a candidate in a chunk with levels is evaluated once per level `l`:
    - y is the bilinear of level `l` at the 4 lattice corners. If any corner is NaN or the corners differ by > 1 m, that level is skipped.
    - Slope comes from the corner differences.
    - The survivor cache keys by `(cell, level)`.
    - The spacing check ignores neighbours with |Δy| ≥ 3 m.
    - Instance y = level y.
    - Face (wall) rules stay heightmap-only.
  - `floodPond(h: Heightmap, pond: Pond, solidAt?: (i: number, j: number, y: number) => boolean): PondFill` treats samples where `solidAt(i, j, level)` is true as walls. `Ground` passes it only when `volume.count > 0`.

- [ ] **Step 1: Write failing tests:**
  - `surfaceLevels` for a column under a 4 m-thick ledge 10 m above the ground gives 2 levels (ledge top, ground).
  - With the ledge 2 m above the ground, only the ledge top is a level (the ground has < 3 m headroom).
  - A heightmap chunk returns null.
  - Scatter with a `levels` map containing a 2-level chunk places ground-rule instances at both y values. With no `levels`, output is identical to today (existing snapshot).
  - `floodPond` with a `solidAt` ring wall holds water inside the ring, which spills without it.
  - A pond whose level runs into added rock leaves those samples out of the mask (no water sheet inside rock).
- [ ] **Step 2:** Run `npm test -- scatter ground ponds`. Expected: FAIL.
- [ ] **Step 3:** Implement. `scatterManager` fills `levels` for each requested chunk where `ground.isSdfChunk(chunk)`.
- [ ] **Step 4:** Run `npm test -- scatter ground ponds water`. Expected: PASS.
- [ ] **Step 5:** Commit: `Scatter on every open ledge and let sculpted berms hold ponds`.

### Task 8: Save format v5

**Files:**
- Modify: `web/src/scene/scene.ts` (versions), `web/src/scene/sceneFile.ts`, `web/src/persistence/sceneStore.ts`
- Create: `web/src/terrain/volumeCodec.ts`, `web/src/terrain/volumeCodec.test.ts`
- Test: `web/src/scene/sceneFile.test.ts`, `web/src/persistence/sceneStore.test.ts`

**Interfaces:**
- Consumes: `VolumeLayer`, `brickKey`, `unpackKey`, `MAX_BRICKS` (Task 1).
- Produces:
  - `encodeVolume(v: VolumeLayer): Uint8Array` writes bricks in ascending key order.
  - `decodeVolume(size: SceneSize, bytes: Uint8Array | undefined): VolumeLayer` returns an empty layer for undefined. It throws `SceneFileError('invalid-layers')` on:
    - a wrong length or count > `MAX_BRICKS`;
    - a duplicate key;
    - a brick outside the scene square or height range;
    - a value outside −64…64.

    It drops all-default bricks.
  - `writeSceneFile` adds `volume.i8`. `readSceneFile` decodes it for v5 and returns empty for v1–v4. The IndexedDB `LayersRecord` gains an optional `volume?: ArrayBuffer`.
  - `parseScene` accepts formatVersion 3, 4 and 5, upgrading 3 and 4 in place to 5.

- [ ] **Step 1: Write failing tests:**
  - Encode/decode round trip of 3 bricks.
  - A truncated buffer is rejected.
  - A duplicate key is rejected.
  - Count 8,001 is rejected.
  - A brick at bx = −1 is rejected.
  - An all-default brick is dropped on decode.
  - A v5 `.setbuilder` round trip keeps the bricks.
  - A v4 file loads with `volume.count === 0` and `formatVersion === 5`.
  - formatVersion 6 → `newer-version`.
  - The IndexedDB save/load round trip keeps the bricks, and an old record without `volume` loads empty.
- [ ] **Step 2:** Run `npm test -- volumeCodec sceneFile sceneStore`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `Save the volume layer in scene format 5`.

### Task 9: Whole-suite check and export

**Files:**
- Test: `web/src/export/exportScene.test.ts`

- [ ] **Step 1: Write a failing test:** exporting a scene with an Add ledge gives a terrain mesh with more triangles than the same scene without it, and contains a vertex above the heightmap at the ledge.
- [ ] **Step 2:** Run `npm test -- exportScene`. Expected: PASS. If it fails, route `exportScene` through `ground.chunkGeometry` for SDF chunks. It should already do this.
- [ ] **Step 3:** Run both suites: `cd web && npm test 2>&1 | tail -5` and `cd server && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew test -PskipWeb -q`. Expected: all pass.
- [ ] **Step 4 (manual):** export the arch scene to `.glb` and import it into Blender. This is a manual check; report it as unverified if it isn't done.
- [ ] **Step 5:** Commit: `Cover sculpted shapes in the glb export test`.
