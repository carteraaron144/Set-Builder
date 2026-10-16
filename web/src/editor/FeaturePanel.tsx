import { useEffect, useRef } from 'react'
import { clampWidth, FEATURES, widthRange, type PathStyle, type Pond, type Spline } from '../features/features'
import { MAX_HEIGHT, MIN_HEIGHT } from '../terrain/layers'
import { editCave, editCavePoint } from '../tools/caveInput'
import { levelRange } from '../tools/pondInput'
import { editSplinePoint } from '../tools/splineInput'
import { useEditorStore } from './editorStore'

const STYLES: { id: PathStyle; label: string }[] = [
  { id: 'dirt', label: 'Dirt' },
  { id: 'cobble', label: 'Cobble' },
]

const SELECT_HINT = 'Click any handle to select it; drag it or its arrows to move it, [ and ] scale it, Delete removes it.'
const POND_HINT = 'Click to make a pond and drag up or down to set its level. Click a pond to select it.'
const CAVE_HINT =
  'Click the ground for the entrance, then click to add points at the same depth; double-click or Enter to finish. Click a point to select it and drag it; its height, radius and chamber are below; [ and ] scale its radius.'
const HINT = 'Click to add points; double-click or Enter to finish. Click a spline to select it, drag its points, Alt-click to add one. [ and ] scale a selected point width.'

/**
 * Context panel for the Path, River, Water and Cave tools: style for new paths, the selected spline's width and style,
 * the selected pond's level, and the selected cave's radius and point.
 */
export function FeaturePanel() {
  const tool = useEditorStore((s) => s.tool)
  const selection = useEditorStore((s) => s.selection)
  const pathStyle = useEditorStore((s) => s.pathStyle)
  const terrain = useEditorStore((s) => s.terrain)
  useEditorStore((s) => s.editVersion)
  const spline = selection?.kind === 'spline' ? terrain.features.splines.find((s) => s.id === selection.id) : undefined
  // With the Select tool the panel follows whatever is selected, not the tool.
  const shown =
    tool !== 'select' ? tool : selection?.kind === 'pond' ? 'water' : selection?.kind === 'cave' ? 'cave' : (spline?.kind ?? 'select')
  if (shown === 'select') return <p className="panel-hint">{SELECT_HINT}</p>
  if (shown === 'water') return <PondPanel />
  if (shown === 'cave') return <CavePanel />
  if (shown !== 'path' && shown !== 'river') return null

  const edit = (change: Partial<Spline>) => {
    const f = terrain.features
    if (!spline) return
    terrain.commitFeatures({ ...f, splines: f.splines.map((s) => (s.id === spline.id ? { ...s, ...change } : s)) })
  }
  const pointIndex = selection?.kind === 'spline' ? selection.point : null
  const style = spline?.kind === 'path' ? spline.style : pathStyle

  return (
    <div className="brush-panel" aria-label={shown === 'path' ? 'Path' : 'River'}>
      {shown === 'path' && (
        <div role="radiogroup" aria-label="Style" className="choice-group">
          {STYLES.map(({ id, label }) => (
            <label key={id} className="choice">
              <input
                type="radio"
                name="path-style"
                checked={style === id}
                onChange={() => {
                  useEditorStore.getState().setPathStyle(id)
                  edit({ style: id })
                }}
              />
              {label}
            </label>
          ))}
        </div>
      )}
      {spline && <WidthField spline={spline} onCommit={(width) => edit({ width })} />}
      {spline && pointIndex !== null && spline.points[pointIndex] && (
        <NumberField
          label="Point width"
          value={spline.points[pointIndex].width ?? spline.width}
          range={widthRange(spline.kind)}
          onCommit={(width) => terrain.commitFeatures(editSplinePoint(terrain.features, spline.id, pointIndex, { width }))}
        />
      )}
      <p className="panel-hint">{HINT}</p>
    </div>
  )
}

/** Commits on the input's native change (blur, Enter or a spinner step), not on every keystroke. */
function WidthField({ spline, onCommit }: { spline: Spline; onCommit(width: number): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [min, max] = widthRange(spline.kind)
  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
  })
  useEffect(() => {
    if (ref.current) ref.current.value = String(spline.width)
  }, [spline.width])
  useEffect(() => {
    const el = ref.current!
    const onChange = () => {
      const v = Number(el.value)
      const width = clampWidth(spline.kind, Number.isFinite(v) && el.value !== '' ? v : spline.width)
      el.value = String(width)
      commit.current(width)
    }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [spline.kind, spline.width])

  return (
    <label className="slider">
      <span>Width</span>
      <input ref={ref} type="number" aria-label="Width" min={min} max={max} step={0.5} defaultValue={spline.width} />
      <output>m</output>
    </label>
  )
}

function PondPanel() {
  const selection = useEditorStore((s) => s.selection)
  const terrain = useEditorStore((s) => s.terrain)
  useEditorStore((s) => s.editVersion)
  const ponds = terrain.features.ponds
  const index = selection?.kind === 'pond' ? ponds.findIndex((p) => p.id === selection.id) : -1
  const pond = index >= 0 ? ponds[index] : undefined
  const withLevel = (level: number) => ({ ...terrain.features, ponds: ponds.map((p) => (p.id === pond?.id ? { ...p, level } : p)) })

  return (
    <div className="brush-panel" aria-label="Water">
      {pond && (
        <>
          <LevelSlider
            key={pond.id}
            pond={pond}
            range={levelRange(terrain.ground.layers.heights, pond)}
            onPreview={(level) => terrain.previewFeatures(withLevel(level))}
            onCommit={(level) => terrain.commitFeatures(withLevel(level))}
          />
          {terrain.ground.ponds[index]?.capped && <p className="panel-hint">Capped at the spill height</p>}
          <button
            type="button"
            onClick={() => {
              terrain.commitFeatures({ ...terrain.features, ponds: ponds.filter((p) => p.id !== pond.id) })
              useEditorStore.getState().setSelection(null)
            }}
          >
            Delete
          </button>
        </>
      )}
      <p className="panel-hint">{POND_HINT}</p>
    </div>
  )
}

/** Previews while the thumb moves and commits once on the native change (release), like a level drag. */
function LevelSlider(props: {
  pond: Pond
  range: [number, number]
  onPreview(level: number): void
  onCommit(level: number): void
}) {
  const { pond, range } = props
  const ref = useRef<HTMLInputElement>(null)
  const handlers = useRef(props)
  useEffect(() => {
    handlers.current = props
  })
  useEffect(() => {
    if (ref.current) ref.current.value = String(pond.level)
  }, [pond.level])
  useEffect(() => {
    const el = ref.current!
    const read = () => Number(el.value)
    const onInput = () => handlers.current.onPreview(read())
    const onChange = () => handlers.current.onCommit(read())
    el.addEventListener('input', onInput)
    el.addEventListener('change', onChange)
    return () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('change', onChange)
    }
  }, [])

  return (
    <label className="slider">
      <span>Level</span>
      <input ref={ref} type="range" aria-label="Level" min={range[0]} max={range[1]} step={0.05} defaultValue={pond.level} />
      <output>{pond.level.toFixed(2)} m</output>
    </label>
  )
}

function CavePanel() {
  const selection = useEditorStore((s) => s.selection)
  const terrain = useEditorStore((s) => s.terrain)
  useEditorStore((s) => s.editVersion)
  const sel = selection?.kind === 'cave' ? selection : null
  const cave = sel ? terrain.features.caves.find((c) => c.id === sel.id) : undefined
  const index = sel?.point ?? null
  const point = cave && index !== null ? cave.points[index] : undefined
  const { radius, chamber } = FEATURES.cave

  return (
    <section className="brush-panel" aria-label="Caves">
      {cave && (
        <>
          <NumberField
            label="Tunnel radius"
            value={cave.radius}
            range={[radius.min, radius.max]}
            onCommit={(r) => terrain.commitFeatures(editCave(terrain.features, cave.id, { radius: r }))}
          />
          {point && index !== null && (
            <>
              <NumberField
                label="Height"
                value={point.y}
                range={[MIN_HEIGHT, MAX_HEIGHT]}
                onCommit={(y) => terrain.commitFeatures(editCavePoint(terrain.features, cave.id, index, { y }))}
              />
              <NumberField
                label="Point radius"
                value={point.radius ?? cave.radius}
                range={[radius.min, radius.max]}
                onCommit={(r) => terrain.commitFeatures(editCavePoint(terrain.features, cave.id, index, { radius: r }))}
              />
              <label className="choice">
                <input
                  type="checkbox"
                  checked={point.chamber > 0}
                  onChange={(e) =>
                    terrain.commitFeatures(
                      editCavePoint(terrain.features, cave.id, index, { chamber: e.target.checked ? chamber.default : 0 }),
                    )
                  }
                />
                Chamber
              </label>
              {point.chamber > 0 && (
                <NumberField
                  label="Chamber radius"
                  value={point.chamber}
                  range={[chamber.min, chamber.max]}
                  onCommit={(c) => terrain.commitFeatures(editCavePoint(terrain.features, cave.id, index, { chamber: c }))}
                />
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => {
              terrain.commitFeatures({ ...terrain.features, caves: terrain.features.caves.filter((c) => c.id !== cave.id) })
              useEditorStore.getState().setSelection(null)
            }}
          >
            Delete
          </button>
        </>
      )}
      <p className="panel-hint">{CAVE_HINT}</p>
    </section>
  )
}

/** A metres field clamped to `range` that commits on the native change (blur, Enter or a spinner step). */
function NumberField(props: { label: string; value: number; range: [number, number]; onCommit(v: number): void }) {
  const { label, value, range } = props
  const ref = useRef<HTMLInputElement>(null)
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  useEffect(() => {
    if (ref.current) ref.current.value = String(value)
  }, [value])
  useEffect(() => {
    const el = ref.current!
    const onChange = () => {
      const { value: old, range: [lo, hi], onCommit } = latest.current
      const v = Number(el.value)
      const next = Math.min(hi, Math.max(lo, Number.isFinite(v) && el.value !== '' ? v : old))
      el.value = String(next)
      if (next !== old) onCommit(next)
    }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])

  return (
    <label className="slider">
      <span>{label}</span>
      <input ref={ref} type="number" aria-label={label} min={range[0]} max={range[1]} step={0.5} defaultValue={value} />
      <output>m</output>
    </label>
  )
}
