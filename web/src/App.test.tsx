import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./viewport/Viewport', () => ({
  Viewport: () => <div data-testid="viewport" />,
}))

describe('App', () => {
  it('shows the app name in the top bar', () => {
    render(<App />)
    expect(screen.getByText('Set Builder')).toBeInTheDocument()
  })
})
