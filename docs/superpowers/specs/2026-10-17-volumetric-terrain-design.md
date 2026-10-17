# Volumetric Terrain Design

**Goal:** sculpt true 3D shapes — overhangs, arches, ledges, undercut cliffs — anywhere on the terrain, while the existing tools keep working largely the same.

**Agreed in brainstorming (2026-10-17):**
- Purpose: 3D sculpting anywhere, not just via the cave tool.
- The six 2D terrain modes stay exactly as they are; new 3D modes sit beside them.
- Paint, scatter, select/picking, paths and ponds all work with 3D surfaces (within the limits below).
- Approach: the heightmap stays the base; a sparse **volume layer** holds 3D edits. Chunks that meet it are meshed as SDF chunks, as caves already are (M3b).

**Assumptions:** scene sizes stay 64/128/256 m, 0.5 m detail, heights −32…64 m. A scene with no 3D edits behaves and exports exactly as before.

## 1. Volume layer and density

**Bricks.** The volume layer is a `Map<brickKey, Brick>`. A brick is 8×8×8 voxels at 0.5 m spacing (a 4 m cube), aligned to the height-sample lattice (voxel x/z = height sample i/j, voxel y = k·0.5 m). Brick coordinates are Int16 (bx, by, bz). Each voxel stores two Int8 values in 1/32 m steps, truncated to ±2 m:
- **A (add):** distance-like material from 3D brushes, positive inside.
- **K (carve):** distance-like removal, positive inside the carved space.

Default (no brick) is A = K = −2. A brick whose every voxel is default is dropped. Values between voxels are trilinear.

**Density.**

`s(p) = smin_k( min( max(h(x,z) − y, A(p)), −K(p) ), c(p) )`

where `h` is the carved heightmap, `c` the cave volume and `smin_k` the existing cave blend (`cave.groundBlend`). With no bricks this is exactly today's field, bit for bit.

**Interaction with 2D brushes:** they edit `h` only. Raising ground under a ledge merges into it (union); lowering it leaves the ledge standing. Neither touches bricks.

**SDF chunks.** A chunk is an SDF chunk when its sample square meets a cave footprint **or a brick footprint** (the brick's xz extent + 2 m). The M3b seam argument holds: on every face shared with a heightmap chunk, A and K are default, so `s = h − y` there. A per-chunk "has bricks near" bit lets `density()` skip the brick lookup elsewhere. The meshing band per column widens to cover the bricks above it; the chunk's y range widens to cover them too.

## 2. 3D brushes

**Modes**, in a "3D" group in the Terrain panel. Size/strength/falloff sliders, `[`/`]`, and Alt-to-invert work as today:

| Mode | Effect | Alt |
| --- | --- | --- |
| Add | Sphere at the hit point raises A with the brush falloff | Carve |
| Carve | Sphere raises K; cuts heightmap, added material and cave walls | Add |
| Smooth 3D | Blurs `s` over the sphere; where the blurred value is higher raise A, where lower raise K | — |

- **Radius:** 1–12 m for 3D modes; strength sets how far (in metres, up to 0.5 m per dab) the surface moves per dab.
- **Aim:** the true surface hit from `Ground.raycast` on the full density. The preview is a wireframe sphere. 2D modes keep aiming at the heightmap as now.
- **Stroke plane lock:** during a stroke, the hit is taken on a camera-facing plane through the first hit, so Add does not climb its own material toward the camera.
- **Dab spacing:** 0.25 × radius, as today.
- **Cap:** at most 8,000 bricks per scene (~8 MB). Add/Carve that would exceed it stop and show "Volume limit reached".
- **Undo:** a stroke records before/after copies of every brick it touched (absent = default), like heightmap rects. Undo and redo restore them and drop all-default bricks.

## 3. Other tools on 3D surfaces

- **Paint:** the biome map stays 2D. SDF chunk colours use the true mesh normal: upward faces take the column's biome; walls shade to earth from 30° and rock from 60°; undersides (normal.y < 0) are earth. Painting a ledge also paints the ground under it. Grass-overhang lips are not generated on SDF chunks.
- **Scatter:** in SDF chunks, each candidate (x, z) scans its column through the density and yields one site per upward-facing surface with at least 3 m of air above; each site runs the usual slope and biome tests. Seeding stays deterministic. Heightmap chunks are unchanged.
- **Picking / Select:** `Ground.raycast` marches the full density wherever bricks or caves exist.
- **Paths and rivers:** still carve the heightmap. Their corridor (width + 1 m) also acts as an implicit carve from the carved surface up to 4 m above it, applied in `density()` (not written into bricks), so a path drawn into a 3D wall cuts a passage and moves with the path. Path points snap to the heightmap ground. Corridor footprints count as SDF-chunk footprints only where they overlap bricks.
- **Ponds:** the flood fill still runs on the heightmap, but a column also counts as a wall where `s > 0` at the water level. The water mesh is skipped at vertices where `s > 0` at the water level.
- **Export:** `.glb` already uses chunk geometry; sculpted shapes export with no change.

## 4. Performance, saving, testing

**Performance:** one SDF chunk meshes in ≤ 30 ms on a 256 m scene (M3b budget). During a 3D stroke only chunks whose footprints the dab touched re-mesh, at most once per frame.

**Saving:**
- `SCENE_FORMAT_VERSION = 5`, `GENERATOR_VERSION = 5`.
- New zip entry `volume.i8`: a Uint32 brick count, then per brick: bx, by, bz as Int16, 512 A bytes, 512 K bytes (voxel order x fastest, then z, then y).
- Bricks outside the scene square or height range, duplicate keys, and wrong lengths are rejected as `invalid-layers`.
- v1–v4 scenes load with no bricks; newer versions are rejected as `newer-version`.
- IndexedDB storage (`sceneStore`) saves the same blob.
- The server does not read scene files: no server change.

**Determinism:** every mesh and placement is a pure function of (layers, volume, features); no `Math.random`.

**Tests (Vitest, test-first):**
- Volume layer: brick key math; default reads; write/read round trip; Int8 quantization; all-default brick is dropped.
- Density: no bricks gives today's values exactly; Add makes a point above ground solid; Carve makes a point below ground air; caves still blend.
- Chunks: SDF-chunk set includes brick footprints; shared faces between SDF and heightmap chunks match.
- Brushes: Add/Carve/Smooth 3D change only bricks within the sphere; plane lock; undo/redo round trip; brick cap.
- Scatter: a ledge column yields two sites; a low overhang (< 3 m headroom) yields none beneath it.
- Paths: the corridor clears added material up to 4 m.
- Ponds: an added berm holds water; water is hidden inside added rock.
- Save: v5 round trip; v4 loads with no bricks; malformed `volume.i8` is rejected.
- Manual only: look and feel, stroke smoothness on 256 m, Blender `.glb` import.

**Out of scope:** per-voxel paint, paths over arches, 3D flatten/terrace/noise.
