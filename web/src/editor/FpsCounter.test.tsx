import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FpsCounter } from './FpsCounter'

let now = 0
let callbacks: Array<(t: number) => void> = []

beforeEach(() => {
  now = 0
  callbacks = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => callbacks.push(cb))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

function frames(count: number, dt: number) {
  for (let i = 0; i < count; i++) {
    now += dt
    const cb = callbacks.shift()
    act(() => cb?.(now))
  }
}

describe('FpsCounter', () => {
  it('starts with a placeholder', () => {
    render(<FpsCounter />)
    expect(screen.getByLabelText('Frames per second').textContent).toBe('-- FPS')
  })

  it('shows frames counted over each half second', () => {
    render(<FpsCounter />)
    frames(1, 0) // establishes the baseline
    frames(30, 16.667) // ~500 ms at 60 fps
    expect(screen.getByLabelText('Frames per second').textContent).toBe('60 FPS')
  })

  it('stops requesting frames when unmounted', () => {
    const { unmount } = render(<FpsCounter />)
    unmount()
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
  })
})
