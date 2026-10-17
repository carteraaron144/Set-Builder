import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editorStore'
import { SettingsMenu } from './SettingsMenu'

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true)
})

describe('SettingsMenu', () => {
  it('starts closed, with the cave throttle off', async () => {
    expect(useEditorStore.getState().caveRemeshDelay).toBe(0)
    render(<SettingsMenu />)
    expect(screen.queryByLabelText('Cave remesh delay')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const select = screen.getByLabelText('Cave remesh delay') as HTMLSelectElement
    expect(select.value).toBe('0')
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Off', '30 ms', '60 ms', '120 ms', '240 ms'])
  })

  it('sets the delay in the store', async () => {
    render(<SettingsMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await userEvent.selectOptions(screen.getByLabelText('Cave remesh delay'), '120 ms')
    expect(useEditorStore.getState().caveRemeshDelay).toBe(120)
  })

  it('closes when the button is pressed again', async () => {
    render(<SettingsMenu />)
    const button = screen.getByRole('button', { name: 'Settings' })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(screen.queryByLabelText('Cave remesh delay')).toBeNull()
  })

  it('has a hide-caves-while-sculpting checkbox, off by default', async () => {
    expect(useEditorStore.getState().hideCavesWhileStroking).toBe(false)
    render(<SettingsMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const box = screen.getByLabelText('Ignore caves while sculpting') as HTMLInputElement
    expect(box.checked).toBe(false)
    await userEvent.click(box)
    expect(useEditorStore.getState().hideCavesWhileStroking).toBe(true)
  })
})

describe('SettingsMenu chunk grid', () => {
  it('toggles the chunk grid, off by default', async () => {
    expect(useEditorStore.getState().showChunkGrid).toBe(false)
    render(<SettingsMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await userEvent.click(screen.getByLabelText('Show chunk grid'))
    expect(useEditorStore.getState().showChunkGrid).toBe(true)
    await userEvent.click(screen.getByLabelText('Show chunk grid'))
    expect(useEditorStore.getState().showChunkGrid).toBe(false)
  })
})

describe('SettingsMenu grass overhangs', () => {
  it('toggles grass overhangs, off by default', async () => {
    expect(useEditorStore.getState().grassOverhangs).toBe(false)
    render(<SettingsMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const box = screen.getByLabelText('Grass overhangs') as HTMLInputElement
    expect(box.checked).toBe(false)
    await userEvent.click(box)
    expect(useEditorStore.getState().grassOverhangs).toBe(true)
  })
})
