import { isTextEntry } from '../dom/isTextEntry'

export interface ShortcutHandlers {
  save(): void
  undo(): void
  redo(): void
  resizeBrush(factor: number): void
  deselectTool(): void
}

/** Editor keys: Ctrl/Cmd+S (works in text fields), Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, [ and ], Escape. */
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
    } else if (!mod && e.key === 'Escape') {
      h.deselectTool()
    }
  }
  target.addEventListener('keydown', onKeyDown)
  return () => target.removeEventListener('keydown', onKeyDown)
}
