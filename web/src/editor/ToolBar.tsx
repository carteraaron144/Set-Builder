import { useEditorStore, type ToolId } from './editorStore'

const TOOLS: { id: ToolId | null; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'paint', label: 'Paint' },
  { id: 'path', label: 'Path' },
  { id: 'river', label: 'River' },
  { id: 'water', label: 'Water' },
  { id: 'cave', label: 'Caves' },
  { id: null, label: 'Zones' },
  { id: null, label: 'Props' },
]

/** Bottom toolbar: the brush and feature tools (later ones shown disabled) plus Undo and Redo. */
export function ToolBar() {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const canUndo = useEditorStore((s) => s.canUndo)
  const canRedo = useEditorStore((s) => s.canRedo)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const scatterVisible = useEditorStore((s) => s.scatterVisible)
  const setScatterVisible = useEditorStore((s) => s.setScatterVisible)

  return (
    <div className="tool-bar">
      <div role="toolbar" aria-label="Tools" className="tool-group">
        {TOOLS.map(({ id, label }) =>
          id ? (
            <button key={label} type="button" aria-pressed={tool === id} onClick={() => setTool(tool === id ? null : id)}>
              {label}
            </button>
          ) : (
            <button key={label} type="button" disabled title="Coming in a later milestone">
              {label}
            </button>
          ),
        )}
      </div>
      <div className="tool-group">
        <button
          type="button"
          aria-pressed={scatterVisible}
          onClick={() => setScatterVisible(!scatterVisible)}
          title="Show or hide trees, rocks and plants"
        >
          Scatter
        </button>
      </div>
      <div className="tool-group">
        <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
          Redo
        </button>
      </div>
    </div>
  )
}
