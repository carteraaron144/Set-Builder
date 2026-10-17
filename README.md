# Set Builder

A browser-based environment modeling app for game blockouts: a Kotlin + Spring Boot server and a React + Three.js (WebGPU) web app.
Editing, rendering and saving happen in the browser; the server serves the app and asset packs.

## Requirements

- JDK 21: `brew install --cask temurin@21`, or `brew install openjdk@21` and `export JAVA_HOME=/opt/homebrew/opt/openjdk@21`
- Node 26 and npm

## Run the server

`cd server && ./gradlew bootRun` (port 8080). This builds the web app (`npm ci` + `npm run build` in `web/`) and serves it at
http://localhost:8080, with `/api/health`, `/api/asset-packs` and `/packs/<id>/<path>`.

## Development

Run both, then open http://localhost:5173 (Vite proxies `/api` and `/packs` to the server):

- `cd server && ./gradlew bootRun -PskipWeb`
- `cd web && npm run dev`

Add `?renderer=webgl2` to the URL to force the WebGL2 backend (to check the fallback, or work around a WebGPU driver problem).

## Controls

| Action | Mouse | Keys |
| --- | --- | --- |
| Pan | Middle-drag, or move to the screen edge | WASD / arrows |
| Orbit | Right-drag | Q / E |
| Zoom | Wheel (toward the cursor) | R / F |
| Tilt | Right-drag vertically | Page Up / Page Down |
| Pick a tool | Bottom toolbar (Terrain, Paint, Path, River, Water, Caves) | C toggles Caves, 1 toggles Select; Esc deselects |
| Apply the brush | Left-drag | |
| Invert (lower, erase) | Alt-drag, or the panel's Invert toggle | |
| Brush size | Size slider | `[` / `]` |
| Undo / redo | Toolbar buttons | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl+Y) |
| Save in this browser | Save | Ctrl/Cmd+S |

Terrain modes are raise, lower, smooth, flatten (to the height where the stroke started), noise and terrace (snaps
heights to multiples of the Step height, 0.5–5 m, for stepped earthen mounds). Paint brushes the
meadow, forest, rocky and swamp biomes; slopes shade to earth from 30° and to rock from 60° automatically.

### Paths, rivers and ponds

| Action | Path / River | Water (ponds) |
| --- | --- | --- |
| Draw | Click points; double-click or Enter finishes; Backspace drops the last point; Esc cancels | Click to make a pond 1 m above the ground |
| Join | Start or finish within 2 m of another end of the same kind | |
| Select | Click the line (not near its ends) | Click its water or seed handle |
| Edit | Drag a point; Alt-click the line to add one; Width (and Style, for paths) in the panel | Drag up/down to set the level (0.05 m per pixel), or the Level slider |
| Delete | Delete/Backspace: the point under the cursor, or the whole line | Delete/Backspace, or the panel's Delete |

Paths (dirt trails or cobble roads) and rivers carve the terrain under them; all three clear scatter around them. A pond
fills its hollow up to its level, capped just below the rim where it would spill off the map. Undo while drawing only
cancels the draft. Scenes save the paths, rivers and ponds; carving is recomputed on load.

### Caves

| Action | Caves (`C`) |
| --- | --- |
| Draw | Click the ground for the entrance, then click points; each new point takes the previous one's height. Double-click or Enter finishes; Backspace drops the last point; Esc cancels |
| Select | Click a point (points and centrelines show through the ground) |
| Edit | Drag a point in x, z at its height; the panel sets the tunnel radius (1–4 m) and the selected point's Height and Chamber (3–12 m) |
| Delete | Delete/Backspace: the point under the cursor, or the whole cave; or the panel's Delete |

A cave hollows a tunnel with a flat floor (rock walls, moss where the floor faces up) and clears scatter where it breaks
the surface. Chunks a cave reaches are meshed from a signed-distance field instead of the heightmap; clicks reach into
a cave's mouth.

## Scatter and export

Painted biomes fill with trees, rocks, bushes, grass and reeds, and steep cliffs (60°+, 3 m+ tall) with rock pillars,
from the asset packs in `packs/` (the generated `setbuilder-basics` pack is CC0; rebuild it with `cd web && npm run
make-pack`). Scatter rules and colours are data: `web/src/scatter/rules.json`, `materials.json`. Nothing generated is
saved; scenes store only their painted layers and seed, and scatter is regenerated identically on load.

**Export** (top bar) downloads the generated scene as glTF 2.0 (`.glb`), metres, Y-up: one node per element (sharing
meshes), one mesh per chunk, or one merged mesh; optional `-col` collision meshes (terrain at 1 m, or as rendered where caves
reach; tree trunks, rock and cliff boxes); grass and reeds are optional. Paths are part of the terrain's vertex colours; each river and pond is its own
node (`River 1`, `Pond 1`, …) with the shared `water` material and no collision. No normals are written, so importers shade faces flat. Measured for a
256 m scene with four biomes and a cliff (~7,000 elements): 14.3 MB in 0.2 s (default), 15.4 MB per chunk, 19.4 MB
merged. Check an export in Blender (5.2 wires the terrain's vertex colours automatically):

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender-check.py -- scene.glb 256
```

## Test

- `cd web && npm test`
- `cd server && ./gradlew test` (builds the web app first; add `-PskipWeb` for server-only runs)

## Production build

`cd server && ./gradlew bootJar`, then `java -jar build/libs/setbuilder-0.0.1-SNAPSHOT.jar` from `server/`.

## Asset packs

A pack is a directory `packs/<id>/` with a `pack.json` (`{"name": "...", "version": "..."}`).
The packs directory is `setbuilder.packs-dir` in `server/src/main/resources/application.yml` (default `../packs`, relative to the working directory).
