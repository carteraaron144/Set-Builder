// Test helper: loads the committed setbuilder-basics pack from disk through the real asset library.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { loadAssetLibrary, type AssetLibrary } from '../assets/assetLibrary'

const PACKS = resolve(__dirname, '../../../packs')

export function diskFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/asset-packs') return new Response(JSON.stringify([{ id: 'setbuilder-basics' }]))
    try {
      return new Response(readFileSync(resolve(PACKS, url.slice('/packs/'.length))))
    } catch {
      return new Response('not found', { status: 404 })
    }
  }) as typeof fetch
}

export function loadBasicsLibrary(): Promise<AssetLibrary> {
  return loadAssetLibrary({ fetch: diskFetch(), parseGlb: (b) => new GLTFLoader().parseAsync(b, '').then((g) => g.scene) })
}
