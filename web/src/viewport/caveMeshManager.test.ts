import { describe, expect, it } from 'vitest'
import type { CaveMeshRequest, CaveMeshResponse } from '../features/caveMesh'
import { CaveMeshManager } from './caveMeshManager'

const geo = { positions: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) }
const respond = (req: { id: number; chunks: number[] }): CaveMeshResponse => ({
  id: req.id,
  results: req.chunks.map((chunk) => ({ chunk, sdf: true, geometry: geo })),
})

function setup() {
  const sent: { req: CaveMeshRequest; resolve(r: CaveMeshResponse): void; reject(e: unknown): void }[] = []
  const run = (req: CaveMeshRequest) => new Promise<CaveMeshResponse>((resolve, reject) => sent.push({ req, resolve, reject }))
  const build = (id: number, chunks: number[]) => ({ id, chunks }) as CaveMeshRequest
  return { sent, manager: new CaveMeshManager(run, build) }
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

  it('drops a result for a chunk dirtied after its request was sent, and asks for it again', async () => {
    const { sent, manager } = setup()
    manager.request([1, 2])
    manager.pump()
    manager.request([2])
    sent[0].resolve(respond(sent[0].req))
    await flush()
    expect(manager.take().map((r) => r.chunk)).toEqual([1])
    manager.pump()
    expect(sent[1].req.chunks).toEqual([2])
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
})
