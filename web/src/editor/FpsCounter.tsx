import { useEffect, useState } from 'react'

const WINDOW_MS = 500

export function FpsCounter() {
  const [fps, setFps] = useState<number | null>(null)

  useEffect(() => {
    let id = 0
    let start: number | null = null
    let frames = 0
    const tick = (t: number) => {
      if (start === null) start = t
      else {
        frames++
        if (t - start >= WINDOW_MS) {
          setFps(Math.round((frames * 1000) / (t - start)))
          start = t
          frames = 0
        }
      }
      id = window.requestAnimationFrame(tick)
    }
    id = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(id)
  }, [])

  return (
    <div className="fps-counter" aria-label="Frames per second">
      {fps === null ? '--' : fps} FPS
    </div>
  )
}
