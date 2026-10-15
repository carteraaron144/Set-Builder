import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createScene } from '../scene/scene'
import { Viewport } from './Viewport'

describe('Viewport', () => {
  it('shows a clear message instead of a canvas without WebGPU or WebGL2', () => {
    // jsdom has neither navigator.gpu nor a WebGL2 context.
    const { container } = render(<Viewport scene={createScene({ size: 64 })} onBackend={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Set Builder needs a browser with WebGPU or WebGL2.')
    expect(container.querySelector('canvas')).toBeNull()
  })
})
