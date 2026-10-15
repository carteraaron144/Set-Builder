import { useEffect, useState } from 'react'
import type { SceneStore, SceneSummary } from '../persistence/sceneStore'

type ListState = { status: 'loading' } | { status: 'ready'; scenes: SceneSummary[] } | { status: 'error' }

export function OpenSceneDialog({
  sceneStore,
  onOpen,
  onCancel,
}: {
  sceneStore: () => Promise<SceneStore>
  onOpen(id: string): void
  onCancel(): void
}) {
  const [list, setList] = useState<ListState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    sceneStore()
      .then((s) => s.list())
      .then(
        (scenes) => live && setList({ status: 'ready', scenes }),
        () => live && setList({ status: 'error' }),
      )
    return () => {
      live = false
    }
  }, [sceneStore])

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="open-scene-title">
        <h2 id="open-scene-title">Open scene</h2>
        {list.status === 'loading' && <p className="muted">Loading…</p>}
        {list.status === 'error' && (
          <p className="muted">Browser storage is unavailable here, so there are no saved scenes. Use Upload to open a project file.</p>
        )}
        {list.status === 'ready' && list.scenes.length === 0 && <p className="muted">No saved scenes yet.</p>}
        {list.status === 'ready' && list.scenes.length > 0 && (
          <ul className="scene-list">
            {list.scenes.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpen(s.id)}>
                  <span className="scene-list-name">{s.name}</span>
                  <span className="muted">
                    {s.size} m · {new Date(s.updatedAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-buttons">
          <button type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
