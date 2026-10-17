import { describe, expect, it } from 'vitest'
import type { CaveMeshRequest, CaveMeshResponse } from '../features/caveMesh'
import { CaveMeshManager } from './caveMeshManager'

const geo = { positions: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) }
const respond = (req: { id: number; chunks: number[] }): CaveMeshResponse => ({
  id: req.id,
  results: req.chunks.map((chunk) => ({ chunk, sdf: true, geometry: geo })),
})

function setup(workers = 1) {
  const sent: { req: CaveMeshRequest; resolve(r: CaveMeshResponse): void; reject(e: unknown): void }[] = []
  const run = (req: CaveMeshRequest) => new Promise<CaveMeshResponse>((resolve, reject) => sent.push({ req, resolve, reject }))
  const build = (id: number, chunks: number[]) => ({ id, chunks }) as CaveMeshRequest
  return { sent, manager: new CaveMeshManager(run, build, workers) }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('CaveMeshManager', () => {
  it('sends queued chunks in one request and delivers the results', async () => {
    const { sent, manager } = setup()
    manager.request([3, 1, 3])
    manager.pump()
    expect(sent).toHaveLength(1)
    expect(sent[0].req.chunks).toEqual([1, 3])
    sent[0].resolve(respond(sent[0].req))
    await flush()
    expect(manager.take().map((r) => r.chunk)).toEqual([1, 3])
    expect(manager.take()).toEqual([])
  })

  it('keeps one request in flight and sends later chunks after it returns', async () => {
    const { sent, manager } = setup()
    manager.request([1])
    manager.pump()
    manager.request([2])
    manager.pump()
    expect(sent).toHaveLength(1)
    sent[0].resolve(respond(sent[0].req))
    await flush()
    manager.pump()
    expect(sent).toHaveLength(2)
    expect(sent[1].req.chunks).toEqual([2])
  })

  it('still delivers a chunk dirtied again after its request was sent, then sends it again', async () => {
    const { sent, manager } = setup()
    manager.request([1, 2])
    manager.pump()
    manager.request([2]) // a stroke dirties it every frame, faster than a request returns
    sent[0].resolve(respond(sent[0].req))
    await flush()
    expect(manager.take().map((r) => r.chunk)).toEqual([1, 2])
    manager.pump()
    expect(sent[1].req.chunks).toEqual([2])
  })

  it('keeps delivering during a long run of re-dirtying', async () => {
    const { sent, manager } = setup()
    let delivered = 0
    for (let frame = 0; frame < 5; frame++) {
      manager.request([7])
      manager.pump()
      sent[sent.length - 1].resolve(respond(sent[sent.length - 1].req))
      await flush()
      delivered += manager.take().length
    }
    expect(delivered).toBe(5)
  })

  it('requeues the chunks of a failed request', async () => {
    const { sent, manager } = setup()
    manager.request([4])
    manager.pump()
    sent[0].reject(new Error('boom'))
    await flush()
    manager.pump()
    expect(sent[1].req.chunks).toEqual([4])
  })

  it('ignores results after dispose', async () => {
    const { sent, manager } = setup()
    manager.request([1])
    manager.pump()
    manager.dispose()
    sent[0].resolve(respond(sent[0].req))
    await flush()
    expect(manager.take()).toEqual([])
  })

  it('discards queued, in-flight and arrived meshes for chunks replaced another way', async () => {
    const { sent, manager } = setup()
    manager.request([1, 2])
    manager.pump()
    manager.request([3])
    manager.discard([2, 3])
    sent[0].resolve(respond(sent[0].req))
    await flush()
    expect(manager.take().map((r) => r.chunk)).toEqual([1])
    manager.request([4])
    manager.pump()
    sent[1].resolve(respond(sent[1].req))
    await flush()
    manager.discard([4])
    expect(manager.take()).toEqual([])
    manager.pump()
    expect(sent).toHaveLength(2)
  })

  describe('with several workers', () => {
    it('splits queued chunks across the idle workers', () => {
      const { sent, manager } = setup(2)
      manager.request([1, 2, 3, 4])
      manager.pump()
      expect(sent.map((s) => s.req.chunks)).toEqual([
        [1, 2],
        [3, 4],
      ])
    })

    it('uses fewer requests than workers when there are fewer chunks', () => {
      const { sent, manager } = setup(4)
      manager.request([5])
      manager.pump()
      expect(sent.map((s) => s.req.chunks)).toEqual([[5]])
    })

    it('never has a chunk in two requests at once, so an older mesh cannot land after a newer one', async () => {
      const { sent, manager } = setup(2)
      manager.request([1])
      manager.pump()
      manager.request([1, 2])
      manager.pump()
      expect(sent.map((s) => s.req.chunks)).toEqual([[1], [2]])
      sent[0].resolve(respond(sent[0].req))
      await flush()
      manager.pump()
      expect(sent.map((s) => s.req.chunks)).toEqual([[1], [2], [1]])
    })

    it('delivers results from every request and requeues only the failed one', async () => {
      const { sent, manager } = setup(2)
      manager.request([1, 2])
      manager.pump()
      sent[0].resolve(respond(sent[0].req))
      sent[1].reject(new Error('boom'))
      await flush()
      expect(manager.take().map((r) => r.chunk)).toEqual([1])
      manager.pump()
      expect(sent[2].req.chunks).toEqual([2])
    })

    it('discards across all requests in flight', async () => {
      const { sent, manager } = setup(2)
      manager.request([1, 2])
      manager.pump()
      manager.discard([2])
      sent.forEach((s) => s.resolve(respond(s.req)))
      await flush()
      expect(manager.take().map((r) => r.chunk)).toEqual([1])
    })
  })
})
