import { useEffect, useRef } from 'react'
import { clampWidth, widthRange, type PathStyle, type Pond, type Spline } from '../features/features'
import { levelRange } from '../tools/pondInput'
import { useEditorStore } from './editorStore'

const STYLES: { id: PathStyle; label: string }[] = [
  { id: 'dirt', label: 'Dirt' },
  { id: 'cobble', label: 'Cobble' },
]

const POND_HINT = 'Click to make a pond and drag up or down to set its level. Click a pond to select it.'
const HINT = 'Click to add points; double-click or Enter to finish. Click a spline to select it, drag its points, Alt-click to add one.'

/**
 * Context panel for the Path, River and Water tools: style for new paths, the selected spline's width and style,
 * and the selected pond's level.
 */
export function FeaturePanel() {
  const tool = useEditorStore((s) => s.tool)
  const selection = useEditorStore((s) => s.selection)
  const pathStyle = useEditorStore((s) => s.pathStyle)
  const terrain = useEditorStore((s) => s.terrain)
  useEditorStore((s) => s.editVersion)
  if (tool === 'water') return <PondPanel />
  if (tool !== 'path' && tool !== 'river') return null

  const spline = selection?.kind === 'spline' ? terrain.features.splines.find((s) => s.id === selection.id) : undefined
  const edit = (change: Partial<Spline>) => {
    const f = terrain.features
    if (!spline) return
    terrain.commitFeatures({ ...f, splines: f.splines.map((s) => (s.id === spline.id ? { ...s, ...change } : s)) })
  }
  const style = spline?.kind === 'path' ? spline.style : pathStyle

  return (
    <div className="brush-panel" aria-label={tool === 'path' ? 'Path' : 'River'}>
      {tool === 'path' && (
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
