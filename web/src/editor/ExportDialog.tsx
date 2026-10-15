import { useState } from 'react'
import { EXPORT_DEFAULTS, type ExportGrouping, type ExportOptions } from '../export/exportScene'

const GROUPINGS: { id: ExportGrouping; label: string }[] = [
  { id: 'element', label: 'One node per element' },
  { id: 'chunk', label: 'One mesh per chunk' },
  { id: 'merged', label: 'One merged mesh' },
]

export function ExportDialog({ onExport, onCancel }: { onExport(o: ExportOptions): Promise<void>; onCancel(): void }) {
  const [options, setOptions] = useState<ExportOptions>(EXPORT_DEFAULTS)
  const [busy, setBusy] = useState(false)

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          void onExport(options).finally(() => setBusy(false))
        }}
      >
        <h2 id="export-title">Export scene</h2>
        <p className="muted">glTF 2.0 (.glb), metres, Y-up.</p>
        <div role="radiogroup" aria-label="Grouping" className="choice-group export-grouping">
          {GROUPINGS.map(({ id, label }) => (
            <label key={id} className="choice">
              <input type="radio" name="grouping" checked={options.grouping === id} onChange={() => setOptions({ ...options, grouping: id })} />
              {label}
            </label>
          ))}
        </div>
        <label className="choice">
          <input type="checkbox" checked={options.collision} onChange={(e) => setOptions({ ...options, collision: e.target.checked })} />
          Include collision meshes (-col)
        </label>
        <label className="choice">
          <input type="checkbox" checked={options.includeGrass} onChange={(e) => setOptions({ ...options, includeGrass: e.target.checked })} />
          Include grass and reeds
        </label>
        {busy && <p className="muted">Exporting…</p>}
        <div className="dialog-buttons">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Export
          </button>
        </div>
      </form>
    </div>
  )
}
