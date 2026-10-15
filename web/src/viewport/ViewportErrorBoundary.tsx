import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Keeps a renderer failure (e.g. GPU init or device loss) inside the viewport so the editor stays usable. */
export class ViewportErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Viewport failed', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="viewport viewport-unsupported" role="alert">
        Set Builder couldn't start 3D rendering in this browser. You can still Save or Download your scene.
      </div>
    )
  }
}
