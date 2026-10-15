import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExportDialog } from './ExportDialog'

describe('ExportDialog', () => {
  it('offers the grouping and options with the planned defaults', async () => {
    const onExport = vi.fn(async () => {})
    render(<ExportDialog onExport={onExport} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Export scene' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'One node per element' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'One mesh per chunk' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'One merged mesh' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Include collision meshes (-col)' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Include grass and reeds' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'One mesh per chunk' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include grass and reeds' }))
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(onExport).toHaveBeenCalledWith({ grouping: 'chunk', collision: true, includeGrass: true })
  })

  it('shows Exporting… and disables its buttons while exporting', async () => {
    let finish: () => void = () => {}
    const onExport = vi.fn(() => new Promise<void>((r) => (finish = r)))
    render(<ExportDialog onExport={onExport} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByText('Exporting…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    finish()
  })

  it('closes on Cancel and Escape', async () => {
    const onCancel = vi.fn()
    render(<ExportDialog onExport={vi.fn(async () => {})} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
