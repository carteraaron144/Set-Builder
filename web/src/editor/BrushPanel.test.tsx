import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { BrushPanel } from './BrushPanel'
import { useEditorStore } from './editorStore'

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true)
})

describe('BrushPanel', () => {
  it('renders nothing without a tool', () => {
    const { container } = render(<BrushPanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers the terrain modes', async () => {
    act(() => useEditorStore.getState().setTool('terrain'))
    render(<BrushPanel />)
    const group = screen.getByRole('radiogroup', { name: 'Terrain mode' })
    const modes = within(group).getAllByRole('radio')
    expect(modes.map((r) => r.closest('label')?.textContent)).toEqual(['Raise', 'Lower', 'Smooth', 'Flatten', 'Noise', 'Terrace'])
    expect(within(group).getByRole('radio', { name: 'Raise' })).toBeChecked()
    await userEvent.click(within(group).getByRole('radio', { name: 'Flatten' }))
    expect(useEditorStore.getState().terrainMode).toBe('flatten')
  })

  it('offers the biomes as coloured swatches', async () => {
    act(() => useEditorStore.getState().setTool('paint'))
    render(<BrushPanel />)
    const group = screen.getByRole('radiogroup', { name: 'Biome' })
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      'Meadow',
      'Forest',
      'Rocky',
      'Swamp',
    ])
    expect(within(group).getByRole('radio', { name: 'Forest' })).toBeChecked()
    const swatch = within(group).getByRole('radio', { name: 'Swamp' }).closest('label')!.querySelector('.swatch') as HTMLElement
    expect(swatch.style.background).toBe('rgb(93, 107, 69)')
    await userEvent.click(within(group).getByRole('radio', { name: 'Swamp' }))
    expect(useEditorStore.getState().biome).toBe('swamp')
  })

  it('shows and sets size, strength and falloff', () => {
    act(() => useEditorStore.getState().setTool('terrain'))
    render(<BrushPanel />)
    const size = screen.getByRole('slider', { name: 'Size' })
    expect(size).toHaveAttribute('min', '1')
    expect(size).toHaveAttribute('max', '50')
    expect(screen.getByText('8 m')).toBeInTheDocument()
    expect(screen.getAllByText('50%')).toHaveLength(2)
    fireEvent.change(size, { target: { value: '20' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Strength' }), { target: { value: '0.8' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Falloff' }), { target: { value: '0.25' } })
    expect(useEditorStore.getState().brush).toEqual({ radius: 20, strength: 0.8, falloff: 0.25 })
    expect(screen.getByText('20 m')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('toggles invert', async () => {
    act(() => useEditorStore.getState().setTool('paint'))
    render(<BrushPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Invert (Alt)' }))
    expect(useEditorStore.getState().invertToggle).toBe(true)
  })

  it('shows a Step slider for the terrace mode', async () => {
    act(() => useEditorStore.getState().setTool('terrain'))
    render(<BrushPanel />)
    expect(screen.queryByRole('slider', { name: 'Step' })).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'Terrace' }))
    const step = screen.getByRole('slider', { name: 'Step' })
    expect(step).toHaveAttribute('min', '0.5')
    expect(step).toHaveAttribute('max', '5')
    expect(screen.getByText('1.5 m')).toBeInTheDocument()
    fireEvent.change(step, { target: { value: '2.5' } })
    expect(useEditorStore.getState().terraceStep).toBe(2.5)
  })
})
