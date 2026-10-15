import { useRef, useState } from 'react'
import { normalizeSceneName } from '../scene/scene'
import { useEditorStore } from './editorStore'

export interface TopBarProps {
  onNew(): void
  onOpen(): void
  onSave(): void
  onDownload(): void
  onUpload(file: File): void
}

export function TopBar({ onNew, onOpen, onSave, onDownload, onUpload }: TopBarProps) {
  const scene = useEditorStore((s) => s.scene)
  const dirty = useEditorStore((s) => s.dirty)
  const renderBackend = useEditorStore((s) => s.renderBackend)
  const message = useEditorStore((s) => s.message)
  const rename = useEditorStore((s) => s.rename)
  const setMessage = useEditorStore((s) => s.setMessage)
  const fileInput = useRef<HTMLInputElement>(null)

  // While editing, the field keeps what was typed (spaces included); the store keeps the normalised name.
  // A draft that no longer matches the store (the scene was replaced mid-edit) gives way to the store's name.
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft !== null && normalizeSceneName(draft) === scene.name ? draft : scene.name

  return (
    <header className="top-bar">
      <span className="app-name">Set Builder</span>
      <input
        className="scene-name"
        aria-label="Scene name"
        value={shown}
        maxLength={80}
        onFocus={() => setDraft(scene.name)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value)
          rename(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
      />
      {dirty && (
        <span className="dirty-marker" title="Unsaved changes">
          •
        </span>
      )}
      <button type="button" onClick={onNew}>
        New
      </button>
      <button type="button" onClick={onOpen}>
        Open
      </button>
      <button type="button" onClick={onSave} title="Save in this browser (Ctrl/Cmd+S)">
        Save
      </button>
      <button type="button" onClick={onDownload} title="Download a .setbuilder project file">
        Download
      </button>
      <button type="button" onClick={() => fileInput.current?.click()} title="Open a .setbuilder project file">
        Upload
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".setbuilder"
        aria-label="Upload scene file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onUpload(file)
        }}
      />
      <span className="spacer" />
      {message && (
        <span className={`message message-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
          <button type="button" className="message-close" aria-label="Dismiss" onClick={() => setMessage(null)}>
            ×
          </button>
        </span>
      )}
      {renderBackend === 'webgl2' && (
        <span className="badge" title="WebGPU is unavailable in this browser; rendering with WebGL2">
          WebGL2 fallback
        </span>
      )}
    </header>
  )
}
