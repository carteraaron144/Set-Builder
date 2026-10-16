import { useEffect, useRef } from 'react'
import { clampWidth, widthRange, type PathStyle, type Spline } from '../features/features'
import { useEditorStore } from './editorStore'

const STYLES: { id: PathStyle; label: string }[] = [
  { id: 'dirt', label: 'Dirt' },
  { id: 'cobble', label: 'Cobble' },
]

const HINT = 'Click to add points; double-click or Enter to finish. Click a spline to select it, drag its points, Alt-click to add one.'

/** Context panel for the Path and River tools: style for new paths, and the selected spline's width and style. */
export function FeaturePanel() {
  const tool = useEditorStore((s) => s.tool)
  const selection = useEditorStore((s) => s.selection)
  const pathStyle = useEditorStore((s) => s.pathStyle)
  const terrain = useEditorStore((s) => s.terrain)
  useEditorStore((s) => s.editVersion)
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
