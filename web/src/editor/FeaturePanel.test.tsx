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
      state().terrain.commitFeatures({ splines: [road], ponds: [], caves: [] })
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
      state().terrain.commitFeatures({ splines: [road, { ...road, id: 'r', kind: 'river', width: 3 }], ponds: [], caves: [] })
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

describe('FeaturePanel for ponds', () => {
  const select = (level: number) =>
    act(() => {
      state().terrain.commitFeatures({ splines: [], ponds: [{ id: 'p', seed: { x: 0, z: 0 }, level }], caves: [] })
      state().setTool('water')
      state().setSelection({ kind: 'pond', id: 'p' })
    })

  it('spans the level slider over the ground height ± 10 m and commits once', () => {
    select(1)
    render(<FeaturePanel />)
    const level = screen.getByRole('slider', { name: 'Level' })
    expect(level).toHaveAttribute('min', '-10')
    expect(level).toHaveAttribute('max', '10')
    act(() => {
      fireEvent.change(level, { target: { value: '-2' } })
    })
    expect(state().terrain.features.ponds[0].level).toBe(-2)
    act(() => state().undo())
    expect(state().terrain.features.ponds[0].level).toBe(1)
  })

  it('says when the level is capped at the spill height', () => {
    select(1)
    const { unmount } = render(<FeaturePanel />)
    // Flat ground: any water would reach the scene edge.
    expect(screen.getByText('Capped at the spill height')).toBeInTheDocument()
    unmount()
    select(-1)
    render(<FeaturePanel />)
    expect(screen.queryByText('Capped at the spill height')).toBeNull()
  })

  it('deletes the selected pond', async () => {
    select(1)
    render(<FeaturePanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(state().terrain.features.ponds).toEqual([])
    expect(state().selection).toBeNull()
  })
})

describe('Cave panel', () => {
  const tunnel = {
    id: 'c',
    radius: 2,
    points: [
      { x: -10, y: 2, z: 0, chamber: 0 },
      { x: 10, y: 0, z: 0, chamber: 0 },
    ],
  }
  const select = (point: number | null) =>
    act(() => {
      state().terrain.commitFeatures({ splines: [], ponds: [], caves: [tunnel] })
      state().setTool('cave')
      state().setSelection({ kind: 'cave', id: 'c', point })
    })
  const cave = () => state().terrain.features.caves[0]

  it('shows only the hint with nothing selected', () => {
    act(() => state().setTool('cave'))
    render(<FeaturePanel />)
    expect(screen.getByRole('region', { name: 'Caves' })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('edits the tunnel radius, clamped, as one undo entry', () => {
    select(null)
    render(<FeaturePanel />)
    expect(screen.queryByRole('spinbutton', { name: 'Height' })).toBeNull()
    const radius = screen.getByRole('spinbutton', { name: 'Tunnel radius' })
    act(() => {
      fireEvent.change(radius, { target: { value: '9' } })
    })
    expect(cave().radius).toBe(4)
    expect(radius).toHaveValue(4)
    act(() => state().undo())
    expect(cave().radius).toBe(2)
  })

  it("edits the selected point's height and chamber, each as one undo entry", async () => {
    select(1)
    render(<FeaturePanel />)
    act(() => {
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Height' }), { target: { value: '-3' } })
    })
    expect(cave().points[1].y).toBe(-3)
    expect(cave().points[0].y).toBe(2)
    expect(screen.queryByRole('spinbutton', { name: 'Chamber radius' })).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Chamber' }))
    expect(cave().points[1].chamber).toBe(6)
    act(() => {
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Chamber radius' }), { target: { value: '10' } })
    })
    expect(cave().points[1].chamber).toBe(10)
    act(() => state().undo())
    expect(cave().points[1].chamber).toBe(6)
    act(() => state().undo())
    expect(cave().points[1].chamber).toBe(0)
    act(() => state().undo())
    expect(cave().points[1].y).toBe(0)
  })

  it('deletes the selected cave', async () => {
    select(0)
    render(<FeaturePanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(state().terrain.features.caves).toEqual([])
    expect(state().selection).toBeNull()
  })
})
