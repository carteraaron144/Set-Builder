import { isTextEntry } from '../dom/isTextEntry'
import type { SplineKey } from '../tools/splineInput'
import type { ToolId } from './editorStore'

const FEATURE_KEYS: readonly string[] = ['Enter', 'Escape', 'Backspace', 'Delete'] satisfies SplineKey[]

export interface ShortcutHandlers {
  save(): void
  undo(): void
  redo(): void
  resizeBrush(factor: number): void
  deselectTool(): void
  /** Offers Enter, Escape, Backspace or Delete to the active feature tool; true if it used the key. */
  featureKey(k: SplineKey): boolean
  /** Selects the tool, or deselects it if it is active. */
  toggleTool(t: ToolId): void
}

/**
 * Editor keys: Ctrl/Cmd+S (works in text fields), Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, [ and ], and Enter,
 * Escape, Backspace and Delete for feature tools (an unused Escape deselects the tool), C for the Cave tool and 1 for the Select tool.
 */
export function installEditorShortcuts(target: Window, h: ShortcutHandlers): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase()
    const mod = e.ctrlKey || e.metaKey
    if (mod && !e.altKey && !e.shiftKey && key === 's') {
      e.preventDefault()
      h.save()
      return
    }
    if (isTextEntry(e.target)) return
    if (mod && !e.altKey && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) h.redo()
      else h.undo()
    } else if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'y') {
      e.preventDefault()
      h.redo()
    } else if (!mod && !e.altKey && e.key === '[') {
      h.resizeBrush(0.8)
    } else if (!mod && !e.altKey && e.key === ']') {
      h.resizeBrush(1.25)
    } else if (!mod && !e.altKey && FEATURE_KEYS.includes(e.key)) {
      if (h.featureKey(e.key as SplineKey)) e.preventDefault()
      else if (e.key === 'Escape') h.deselectTool()
    } else if (!mod && !e.altKey && key === 'c') {
      h.toggleTool('cave')
    } else if (!mod && !e.altKey && key === '1') {
      h.toggleTool('select')
    }
  }
  target.addEventListener('keydown', onKeyDown)
  return () => target.removeEventListener('keydown', onKeyDown)
}
