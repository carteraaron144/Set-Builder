import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useEditorStore } from './editor/editorStore'
import { MESSAGES } from './editor/sceneActions'

vi.mock('./viewport/Viewport', () => ({
  Viewport: () => <div data-testid="viewport" />,
}))

function beforeUnload() {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e
}

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true)
})

describe('App', () => {
  it('shows the app name in the top bar', () => {
    render(<App />)
    expect(screen.getByText('Set Builder')).toBeInTheDocument()
  })

  it('guards closing the tab only while there are unsaved changes', () => {
    render(<App />)
    expect(beforeUnload().defaultPrevented).toBe(false)
    act(() => useEditorStore.getState().rename('Edited'))
    expect(beforeUnload().defaultPrevented).toBe(true)
    act(() => useEditorStore.getState().markSaved())
    expect(beforeUnload().defaultPrevented).toBe(false)
  })

  it('saves on Ctrl/Cmd+S (storage is unavailable in jsdom, so it reports that)', async () => {
    render(<App />)
    const e = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(e)
    })
    expect(e.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(MESSAGES.storageFailed))
  })

  it('creates a new scene from the New dialog', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'New' }))
    const dialog = screen.getByRole('dialog', { name: 'New scene' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText('Size')).toHaveValue('128')
    await userEvent.type(screen.getByLabelText('Name'), 'Canyon')
    await userEvent.selectOptions(screen.getByLabelText('Size'), '256')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(useEditorStore.getState().scene).toMatchObject({ name: 'Canyon', size: 256 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a storage problem in the Open dialog', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog', { name: 'Open scene' })).toBeInTheDocument()
    expect(await screen.findByText(/storage is unavailable/i)).toBeInTheDocument()
  })
})
