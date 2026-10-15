import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createScene } from '../scene/scene'
import { useEditorStore } from './editorStore'
import { TopBar } from './TopBar'

function renderTopBar() {
  const handlers = { onNew: vi.fn(), onOpen: vi.fn(), onSave: vi.fn(), onDownload: vi.fn(), onUpload: vi.fn() }
  render(<TopBar {...handlers} />)
  return handlers
}

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true)
  useEditorStore.getState().replaceScene(createScene({ size: 128, name: 'Forest' }))
})

describe('TopBar', () => {
  it('renames the scene as you type and marks it unsaved', async () => {
    renderTopBar()
    expect(screen.queryByText('•')).not.toBeInTheDocument()
    const field = screen.getByRole('textbox', { name: 'Scene name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Dark Forest')
    expect(useEditorStore.getState().scene.name).toBe('Dark Forest')
    expect(field).toHaveValue('Dark Forest')
    expect(screen.getByText('•')).toBeInTheDocument()
  })

  it('shows the new name when the scene is replaced while the field is being edited', async () => {
    renderTopBar()
    const field = screen.getByRole('textbox', { name: 'Scene name' })
    await userEvent.type(field, ' edit')
    act(() => useEditorStore.getState().replaceScene(createScene({ size: 64, name: 'Uploaded' })))
    expect(field).toHaveValue('Uploaded')
    // Same id, different name (e.g. re-uploading this scene's own download).
    const current = useEditorStore.getState().scene
    await userEvent.type(field, ' edit')
    act(() => useEditorStore.getState().replaceScene({ ...current, name: 'Original' }))
    expect(field).toHaveValue('Original')
  })

  it('shows the WebGL2 fallback badge only on the WebGL2 backend', () => {
    renderTopBar()
    expect(screen.queryByText('WebGL2 fallback')).not.toBeInTheDocument()
    act(() => useEditorStore.getState().setRenderBackend('webgpu'))
    expect(screen.queryByText('WebGL2 fallback')).not.toBeInTheDocument()
    act(() => useEditorStore.getState().setRenderBackend('webgl2'))
    expect(screen.getByText('WebGL2 fallback')).toBeInTheDocument()
  })

  it('renders an error message as an alert', () => {
    renderTopBar()
    act(() => useEditorStore.getState().setMessage({ kind: 'error', text: 'Something broke' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Something broke')
  })

  it('wires the buttons and the hidden file input', async () => {
    const h = renderTopBar()
    for (const [label, fn] of [
      ['New', h.onNew],
      ['Open', h.onOpen],
      ['Save', h.onSave],
      ['Download', h.onDownload],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: label }))
      expect(fn).toHaveBeenCalledTimes(1)
    }
    const file = new File(['x'], 'a.setbuilder')
    await userEvent.upload(screen.getByLabelText('Upload scene file'), file)
    expect(h.onUpload).toHaveBeenCalledWith(file)
  })
})
