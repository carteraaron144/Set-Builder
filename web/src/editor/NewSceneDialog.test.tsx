import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NewSceneDialog } from './NewSceneDialog'

describe('NewSceneDialog', () => {
  it('creates a heightmap map unless Volumetric is chosen', async () => {
    const onCreate = vi.fn()
    render(<NewSceneDialog onCreate={onCreate} onCancel={() => {}} />)
    expect(screen.getByRole('radio', { name: /Heightmap/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenLastCalledWith('', 128, 'heightmap')
    await userEvent.click(screen.getByRole('radio', { name: /Volumetric/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenLastCalledWith('', 128, 'volumetric')
  })
})
