import { describe, expect, it, vi } from 'vitest'
import { createScene } from '../scene/scene'
import { readSceneFile, SceneFileError, writeSceneFile } from '../scene/sceneFile'
import { createFlatLayers } from '../terrain/layers'
import { createHttpSceneStore, ServerRejectedError, ServerUnavailableError } from './httpSceneStore'

const scene = createScene({ id: 'a1', size: 64, name: 'Canyon', now: new Date('2026-11-01T00:00:00Z'), seed: 1 })

function respond(status: number, body?: BodyInit, contentType?: string) {
  return new Response(body ?? null, { status, headers: contentType ? { 'Content-Type': contentType } : {} })
}

function storeWith(...responses: Array<Response | Error>) {
  const fetchFn = vi.fn<typeof fetch>()
  for (const r of responses) {
    if (r instanceof Error) fetchFn.mockRejectedValueOnce(r)
    else fetchFn.mockResolvedValueOnce(r)
  }
  return { store: createHttpSceneStore(fetchFn), fetchFn }
}

describe('HttpSceneStore', () => {
  it('save PUTs meta JSON and the scene file as multipart', async () => {
    const { store, fetchFn } = storeWith(respond(200, '{}', 'application/json'))
    const layers = createFlatLayers(64)
    await store.save(scene, layers)

    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/sets/a1')
    expect(init?.method).toBe('PUT')
    expect(init?.credentials).toBe('same-origin')
    const form = init?.body as FormData
    expect(JSON.parse(await (form.get('meta') as Blob).text())).toEqual({ name: 'Canyon', size: 64 })
    expect((form.get('meta') as Blob).type).toBe('application/json')
    const file = new Uint8Array(await (form.get('file') as Blob).arrayBuffer())
    expect(readSceneFile(file).scene).toEqual(scene)
  })

  it('load reads the scene file; 404 is undefined', async () => {
    const bytes = writeSceneFile(scene, createFlatLayers(64))
    const { store, fetchFn } = storeWith(respond(200, bytes as BodyInit, 'application/octet-stream'), respond(404))
    const loaded = await store.load('a1')
    expect(loaded?.scene).toEqual(scene)
    expect(loaded?.layers.heights.data.length).toBe(createFlatLayers(64).heights.data.length)
    expect(fetchFn.mock.calls[0][0]).toBe('/api/sets/a1')
    expect(await store.load('missing')).toBeUndefined()
  })

  it('load rejects with SceneFileError for a damaged file', async () => {
    const { store } = storeWith(respond(200, new Uint8Array([1, 2, 3]) as BodyInit))
    await expect(store.load('a1')).rejects.toBeInstanceOf(SceneFileError)
  })

  it('list maps the summaries', async () => {
    const body = JSON.stringify([{ id: 'b', name: 'B', size: 128, updatedAt: '2026-11-02T00:00:00Z' }])
    const { store, fetchFn } = storeWith(respond(200, body, 'application/json'))
    expect(await store.list()).toEqual([{ id: 'b', name: 'B', size: 128, updatedAt: '2026-11-02T00:00:00Z' }])
    expect(fetchFn.mock.calls[0][0]).toBe('/api/sets')
  })

  it('remove DELETEs and treats 404 as already removed', async () => {
    const { store, fetchFn } = storeWith(respond(204), respond(404))
    await store.remove('a1')
    await store.remove('a1')
    expect(fetchFn.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('network failures and 5xx are ServerUnavailableError', async () => {
    const { store } = storeWith(new TypeError('Failed to fetch'), respond(503))
    await expect(store.list()).rejects.toBeInstanceOf(ServerUnavailableError)
    await expect(store.list()).rejects.toBeInstanceOf(ServerUnavailableError)
  })

  it('other 4xx is ServerRejectedError with the problem detail', async () => {
    const problem = JSON.stringify({ status: 400, detail: 'Name must be 1 to 200 characters' })
    const { store } = storeWith(respond(400, problem, 'application/problem+json'), respond(413))
    const err = await store.save(scene, createFlatLayers(64)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServerRejectedError)
    expect((err as ServerRejectedError).status).toBe(400)
    expect((err as ServerRejectedError).message).toBe('Name must be 1 to 200 characters')
    const tooBig = await store.save(scene, createFlatLayers(64)).catch((e: unknown) => e)
    expect((tooBig as ServerRejectedError).status).toBe(413)
  })
})
