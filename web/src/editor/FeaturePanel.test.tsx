import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Spline } from '../features/features'
import { useEditorStore } from './editorStore'
import { FeaturePanel } from './FeaturePanel'

const road: Spline = {
  id: 'a',
  kind: 'path',
  style: 'dirt',
  width: 2,
  points: [
    { x: -10, z: 0 },
    { x: 10, z: 0 },
  ],
}

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true)
})

const state = () => useEditorStore.getState()

describe('FeaturePanel', () => {
  it('renders nothing for the brush tools', () => {
    act(() => state().setTool('terrain'))
    const { container } = render(<FeaturePanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('sets the style for new paths', async () => {
    act(() => state().setTool('path'))
    render(<FeaturePanel />)
    const group = screen.getByRole('radiogroup', { name: 'Style' })
    expect(within(group).getByRole('radio', { name: 'Dirt' })).toBeChecked()
    await userEvent.click(within(group).getByRole('radio', { name: 'Cobble' }))
    expect(state().pathStyle).toBe('cobble')
    expect(screen.queryByRole('spinbutton', { name: 'Width' })).toBeNull()
  })

  it('clamps the selected spline width to its range and commits once', () => {
    act(() => {
      state().terrain.commitFeatures({ splines: [road], ponds: [] })
      state().setTool('path')
      state().setSelection({ kind: 'spline', id: 'a' })
    })
    render(<FeaturePanel />)
    const width = screen.getByRole('spinbutton', { name: 'Width' })
    expect(width).toHaveValue(2)
    act(() => {
      fireEvent.change(width, { target: { value: '50' } })
    })
    expect(state().terrain.features.splines[0].width).toBe(8)
    expect(width).toHaveValue(8)
    act(() => state().undo())
    expect(state().terrain.features.splines[0].width).toBe(2)
    act(() => state().undo())
    expect(state().terrain.features.splines).toEqual([])
  })

  it('changes the selected path style, but offers no style for rivers', async () => {
    act(() => {
      state().terrain.commitFeatures({ splines: [road, { ...road, id: 'r', kind: 'river', width: 3 }], ponds: [] })
      state().setTool('path')
      state().setSelection({ kind: 'spline', id: 'a' })
    })
    const { unmount } = render(<FeaturePanel />)
    await userEvent.click(screen.getByRole('radio', { name: 'Cobble' }))
    expect(state().terrain.features.splines[0].style).toBe('cobble')
    unmount()
    act(() => {
      state().setTool('river')
      state().setSelection({ kind: 'spline', id: 'r' })
    })
    render(<FeaturePanel />)
    expect(screen.queryByRole('radiogroup', { name: 'Style' })).toBeNull()
    act(() => {
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Width' }), { target: { value: '0' } })
    })
    expect(state().terrain.features.splines[1].width).toBe(1)
  })
})
