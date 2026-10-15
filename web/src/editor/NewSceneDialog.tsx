import { useState } from 'react'
import { SCENE_SIZES, type SceneSize } from '../scene/scene'

export function NewSceneDialog({ onCreate, onCancel }: { onCreate(name: string, size: SceneSize): void; onCancel(): void }) {
  const [name, setName] = useState('')
  const [size, setSize] = useState<SceneSize>(128)

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-scene-title"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate(name, size)
        }}
      >
        <h2 id="new-scene-title">New scene</h2>
        <label>
          Name
          <input value={name} placeholder="Untitled scene" maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Size
          <select value={String(size)} onChange={(e) => setSize(Number(e.target.value) as SceneSize)}>
            {SCENE_SIZES.map((s) => (
              <option key={s} value={String(s)}>
                {s} × {s} m
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-buttons">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Create
          </button>
        </div>
      </form>
    </div>
  )
}
