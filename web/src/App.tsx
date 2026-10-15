import { Viewport } from './viewport/Viewport'

export default function App() {
  return (
    <div className="app">
      <header className="top-bar">
        <span className="app-name">Set Builder</span>
      </header>
      <main className="viewport-area">
        <Viewport />
      </main>
    </div>
  )
}
