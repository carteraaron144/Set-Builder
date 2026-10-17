import { useState } from 'react'
import { CAVE_REMESH_DELAYS, useEditorStore, type CaveRemeshDelay } from './editorStore'

/** A gear button at the top left of the viewport that opens the app's settings. */
export function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const delay = useEditorStore((s) => s.caveRemeshDelay)
  const setDelay = useEditorStore((s) => s.setCaveRemeshDelay)
  const hideCaves = useEditorStore((s) => s.hideCavesWhileStroking)
  const setHideCaves = useEditorStore((s) => s.setHideCavesWhileStroking)
  const showGrid = useEditorStore((s) => s.showChunkGrid)
  const setShowGrid = useEditorStore((s) => s.setShowChunkGrid)

  return (
    <div className="settings-menu">
      <button type="button" className="settings-button" aria-label="Settings" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="settings-panel" role="dialog" aria-label="Settings">
          <label className="settings-row">
            Cave remesh delay
            <select value={delay} onChange={(e) => setDelay(Number(e.target.value) as CaveRemeshDelay)}>
              {CAVE_REMESH_DELAYS.map((ms) => (
                <option key={ms} value={ms}>
                  {ms === 0 ? 'Off' : `${ms} ms`}
                </option>
              ))}
            </select>
          </label>
          <p className="panel-hint">Waits this long between remeshes of terrain near caves while sculpting. Off remeshes every frame.</p>
          <label className="settings-check">
            <input type="checkbox" checked={hideCaves} onChange={(e) => setHideCaves(e.target.checked)} />
            Ignore caves while sculpting
          </label>
          <p className="panel-hint">Draws the terrain without its caves during a stroke, then remeshes them all at once on release.</p>
          <label className="settings-check">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            Show chunk grid
          </label>
          <p className="panel-hint">Draws the 32 m chunk boundaries on the ground.</p>
        </div>
      )}
    </div>
  )
}
