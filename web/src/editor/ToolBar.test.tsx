import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editorStore'
import { ToolBar } from './ToolBar'

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true)
})

function strokeOnce() {
  const { terrain } = useEditorStore.getState()
  terrain.beginStroke({ tool: 'terrain', mode: 'raise' }, { radius: 4, strength: 1, falloff: 0 }, { x: 0, z: 0 })
  terrain.dab({ x: 0, z: 0 }, 0.1, false)
  terrain.endStroke()
}

describe('ToolBar', () => {
  it('lists the tools in order, with Terrain to Water enabled', () => {
    render(<ToolBar />)
    const tools = within(screen.getByRole('toolbar', { name: 'Tools' })).getAllByRole('button')
    expect(tools.map((b) => b.textContent)).toEqual(['Terrain', 'Paint', 'Path', 'River', 'Water', 'Caves', 'Zones', 'Props'])
    for (const b of tools.slice(0, 5)) expect(b).toBeEnabled()
    for (const b of tools.slice(5)) {
      expect(b).toBeDisabled()
      expect(b).toHaveAttribute('title', 'Coming in a later milestone')
    }
  })

  it('selects and deselects a tool', async () => {
    render(<ToolBar />)
    const terrain = screen.getByRole('button', { name: 'Terrain' })
    expect(terrain).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(terrain)
    expect(useEditorStore.getState().tool).toBe('terrain')
    expect(terrain).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Paint' }))
    expect(useEditorStore.getState().tool).toBe('paint')
    await userEvent.click(screen.getByRole('button', { name: 'Paint' }))
    expect(useEditorStore.getState().tool).toBeNull()
  })

  it('enables Undo and Redo from the history and runs them', async () => {
    render(<ToolBar />)
    const undo = screen.getByRole('button', { name: 'Undo' })
    const redo = screen.getByRole('button', { name: 'Redo' })
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()
    act(() => strokeOnce())
    expect(undo).toBeEnabled()
    await userEvent.click(undo)
    expect(useEditorStore.getState().canUndo).toBe(false)
    expect(redo).toBeEnabled()
    await userEvent.click(redo)
    expect(useEditorStore.getState().canUndo).toBe(true)
  })

  it('toggles scatter visibility', async () => {
    render(<ToolBar />)
    const toggle = screen.getByRole('button', { name: 'Scatter' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(toggle)
    expect(useEditorStore.getState().scatterVisible).toBe(false)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})
