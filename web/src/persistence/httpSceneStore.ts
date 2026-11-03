import { readSceneFile, writeSceneFile } from '../scene/sceneFile'
import type { SceneStore, SceneSummary } from './sceneStore'

/** The server can't be reached, or failed (5xx). */
export class ServerUnavailableError extends Error {
  constructor(message = "Couldn't reach the Set Builder server", options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ServerUnavailableError'
  }
}

/** The server refused the request (4xx other than a missing set). The message is the server's reason. */
export class ServerRejectedError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ServerRejectedError'
    this.status = status
  }
}

/** Saves sets to the server's /api/sets. The owner is the anonymous user in the server's cookie. */
export function createHttpSceneStore(fetchFn: typeof fetch = (...args) => fetch(...args), base = '/api/sets'): SceneStore {
  async function request(path: string, init: RequestInit = {}, allow404 = false): Promise<Response | undefined> {
    let response: Response
    try {
      response = await fetchFn(base + path, { credentials: 'same-origin', ...init })
    } catch (cause) {
      throw new ServerUnavailableError(undefined, { cause })
    }
    if (response.ok) return response
    if (response.status === 404 && allow404) return undefined
    if (response.status >= 500) throw new ServerUnavailableError()
    throw new ServerRejectedError(response.status, await problemDetail(response))
  }

  return {
    async save(scene, layers) {
      const form = new FormData()
      form.append('meta', new Blob([JSON.stringify({ name: scene.name, size: scene.size })], { type: 'application/json' }))
      form.append('file', new Blob([writeSceneFile(scene, layers) as BlobPart], { type: 'application/octet-stream' }))
      await request(`/${encodeURIComponent(scene.id)}`, { method: 'PUT', body: form })
    },
    async load(id) {
      const response = await request(`/${encodeURIComponent(id)}`, {}, true)
      if (!response) return undefined
      return readSceneFile(new Uint8Array(await response.arrayBuffer()))
    },
    async list() {
      const response = (await request(''))!
      const rows = (await response.json()) as SceneSummary[]
      return rows.map(({ id, name, size, updatedAt }) => ({ id, name, size, updatedAt }))
    },
    async remove(id) {
      await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' }, true)
    },
  }
}

async function problemDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === 'string' && body.detail) return body.detail
  } catch {
    // Not problem JSON.
  }
  return `The server refused the request (${response.status})`
}
