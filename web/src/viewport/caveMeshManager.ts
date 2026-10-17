import type { CaveMeshRequest, CaveMeshResponse, CaveMeshResult } from '../features/caveMesh'

/** Runs a request: Worker-backed in the app, in-process where there is no Worker. */
export type CaveMeshRunner = (req: CaveMeshRequest) => Promise<CaveMeshResponse>

/**
 * Meshes chunks that caves reach off the main thread. Keeps at most one request in flight and drops results for
 * chunks requested again after theirs was sent (they are sent again).
 */
export class CaveMeshManager {
  private readonly pending = new Set<number>()
  private readonly ready: CaveMeshResult[] = []
  private inFlight: { id: number; chunks: Set<number>; dirtied: Set<number> } | null = null
  private nextId = 1
  private disposed = false

  constructor(
    private readonly run: CaveMeshRunner,
    /** Copies the current ground into a request for these chunks. */
    private readonly build: (id: number, chunks: number[]) => CaveMeshRequest,
  ) {}

  request(chunks: Iterable<number>): void {
    for (const c of chunks) {
      this.pending.add(c)
      if (this.inFlight?.chunks.has(c)) this.inFlight.dirtied.add(c)
    }
  }

  /** Forgets any queued, in-flight or arrived mesh for these chunks (their mesh is being replaced another way). */
  discard(chunks: Iterable<number>): void {
    const gone = new Set(chunks)
    for (const c of gone) {
      this.pending.delete(c)
      this.inFlight?.dirtied.add(c)
    }
    const keep = this.ready.filter((r) => !gone.has(r.chunk))
    this.ready.splice(0, this.ready.length, ...keep)
  }

  /** Call once per frame: sends the queued chunks if nothing is in flight. */
  pump(): void {
    if (this.disposed || this.inFlight || this.pending.size === 0) return
    const chunks = [...this.pending].sort((a, b) => a - b)
    this.pending.clear()
    const flight = { id: this.nextId++, chunks: new Set(chunks), dirtied: new Set<number>() }
    this.inFlight = flight
    this.run(this.build(flight.id, chunks)).then(
      (res) => {
        if (this.disposed || this.inFlight !== flight) return
        this.inFlight = null
        for (const r of res.results) if (!flight.dirtied.has(r.chunk)) this.ready.push(r)
      },
      (err: unknown) => {
        console.warn('Cave mesh request failed; retrying its chunks', err)
        if (this.disposed || this.inFlight !== flight) return
        this.inFlight = null
        for (const c of flight.chunks) this.pending.add(c)
      },
    )
  }

  /** The meshes that have arrived since the last call. */
  take(): CaveMeshResult[] {
    return this.ready.splice(0)
  }

  dispose(): void {
    this.disposed = true
    this.inFlight = null
    this.ready.length = 0
  }
}
