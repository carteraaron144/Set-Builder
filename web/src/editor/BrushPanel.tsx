import type { TerrainMode } from '../terrain/brush'
import { BRUSH_RADIUS_MAX, BRUSH_RADIUS_MIN } from '../terrain/brush'
import { BIOME_IDS } from '../terrain/layers'
import { BIOME_SWATCHES } from '../terrain/palette'
import { useEditorStore } from './editorStore'

const MODES: { id: TerrainMode; label: string }[] = [
  { id: 'raise', label: 'Raise' },
  { id: 'lower', label: 'Lower' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'flatten', label: 'Flatten' },
  { id: 'noise', label: 'Noise' },
]

const capitalise = (s: string) => s[0].toUpperCase() + s.slice(1)
const percent = (v: number) => `${Math.round(v * 100)}%`

/** Context panel for the active brush tool: mode or biome, size, strength, falloff and invert. */
export function BrushPanel() {
  const tool = useEditorStore((s) => s.tool)
  const terrainMode = useEditorStore((s) => s.terrainMode)
  const biome = useEditorStore((s) => s.biome)
  const brush = useEditorStore((s) => s.brush)
  const invert = useEditorStore((s) => s.invertToggle)
  const { setTerrainMode, setBiome, setBrush, setInvertToggle } = useEditorStore.getState()
  if (!tool) return null

  return (
    <div className="brush-panel" aria-label="Brush">
      {tool === 'terrain' ? (
        <div role="radiogroup" aria-label="Terrain mode" className="choice-group">
          {MODES.map(({ id, label }) => (
            <label key={id} className="choice">
              <input type="radio" name="terrain-mode" checked={terrainMode === id} onChange={() => setTerrainMode(id)} />
              {label}
            </label>
          ))}
        </div>
      ) : (
        <div role="radiogroup" aria-label="Biome" className="choice-group">
          {BIOME_IDS.map((id) => (
            <label key={id} className="choice">
              <input type="radio" name="biome" checked={biome === id} onChange={() => setBiome(id)} />
              <span className="swatch" style={{ background: BIOME_SWATCHES[id] }} />
              {capitalise(id)}
            </label>
          ))}
        </div>
      )}
      <label className="slider">
        <span>Size</span>
        <input
          type="range"
          aria-label="Size"
          min={BRUSH_RADIUS_MIN}
          max={BRUSH_RADIUS_MAX}
          step={0.5}
          value={brush.radius}
          onChange={(e) => setBrush({ radius: Number(e.target.value) })}
        />
        <output>{Math.round(brush.radius)} m</output>
      </label>
      <label className="slider">
        <span>Strength</span>
        <input
          type="range"
          aria-label="Strength"
          min={0}
          max={1}
          step={0.05}
          value={brush.strength}
          onChange={(e) => setBrush({ strength: Number(e.target.value) })}
        />
        <output>{percent(brush.strength)}</output>
      </label>
      <label className="slider">
        <span>Falloff</span>
        <input
          type="range"
          aria-label="Falloff"
          min={0}
          max={1}
          step={0.05}
          value={brush.falloff}
          onChange={(e) => setBrush({ falloff: Number(e.target.value) })}
        />
        <output>{percent(brush.falloff)}</output>
      </label>
      <label className="choice">
        <input type="checkbox" checked={invert} onChange={(e) => setInvertToggle(e.target.checked)} />
        Invert (Alt)
      </label>
    </div>
  )
}
