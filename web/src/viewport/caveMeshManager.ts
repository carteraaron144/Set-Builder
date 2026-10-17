import type { CaveMeshRequest, CaveMeshResponse, CaveMeshResult } from '../features/caveMesh'

/** Runs a request: Worker-backed in the app, in-process where there is no Worker. */
export type CaveMeshRunner = (req: CaveMeshRequest) => Promise<CaveMeshResponse>

interface Flight {
  id: number
  chunks: Set<number>
  /** Chunks whose result must be thrown away because their mesh is being replaced another way. */
  discarded: Set<number>
}

/**
 * Meshes chunks that caves reach off the main thread, with up to `workers` requests in flight. A chunk is never in
 * two requests at once, so an older mesh can't land after a newer one. A chunk requested again after its request
 * was sent still gets that result (a stroke re-dirties its chunks every frame, faster than a request returns) and is
 * then sent again; only `discard` drops results.
 */
export class CaveMeshManager {
  private readonly pending = new Set<number>()
  private readonly ready: CaveMeshResult[] = []
  private readonly flights = new Set<Flight>()
  private nextId = 1
  private disposed = false

  constructor(
    private readonly run: CaveMeshRunner,
    /** Copies the current ground into a request for these chunks. */
    private readonly build: (id: number, chunks: number[]) => CaveMeshRequest,
    private readonly workers = 1,
  ) {}

  request(chunks: Iterable<number>): void {
    for (const c of chunks) this.pending.add(c)
  }

  /** Forgets any queued, in-flight or arrived mesh for these chunks (their mesh is being replaced another way). */
  discard(chunks: Iterable<number>): void {
    const gone = new Set(chunks)
    for (const c of gone) {
      this.pending.delete(c)
      for (const f of this.flights) if (f.chunks.has(c)) f.discarded.add(c)
    }
    const keep = this.ready.filter((r) => !gone.has(r.chunk))
    this.ready.splice(0, this.ready.length, ...keep)
  }

  /** Call once per frame: shares the queued chunks that aren't already in flight among the idle workers. */
  pump(): void {
    if (this.disposed) return
    const idle = this.workers - this.flights.size
    if (idle <= 0) return
    const busy = new Set<number>()
    for (const f of this.flights) for (const c of f.chunks) busy.add(c)
    const sendable = [...this.pending].filter((c) => !busy.has(c)).sort((a, b) => a - b)
    if (sendable.length === 0) return
    const requests = Math.min(idle, sendable.length)
    const per = Math.ceil(sendable.length / requests)
    for (let r = 0; r < requests; r++) {
      const chunks = sendable.slice(r * per, (r + 1) * per)
      if (chunks.length === 0) break
      for (const c of chunks) this.pending.delete(c)
      this.send({ id: this.nextId++, chunks: new Set(chunks), discarded: new Set() })
    }
  }

  /** The meshes that have arrived since the last call. */
  take(): CaveMeshResult[] {
    return this.ready.splice(0)
  }

  dispose(): void {
    this.disposed = true
    this.flights.clear()
    this.ready.length = 0
  }

  private send(flight: Flight): void {
    this.flights.add(flight)
    this.run(this.build(flight.id, [...flight.chunks])).then(
      (res) => {
        if (this.disposed || !this.flights.delete(flight)) return
        for (const r of res.results) if (!flight.discarded.has(r.chunk)) this.ready.push(r)
      },
      (err: unknown) => {
        console.warn('Cave mesh request failed; retrying its chunks', err)
        if (this.disposed || !this.flights.delete(flight)) return
        for (const c of flight.chunks) if (!flight.discarded.has(c)) this.pending.add(c)
      },
    )
  }
}
