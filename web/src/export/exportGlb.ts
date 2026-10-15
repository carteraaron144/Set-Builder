import type { Object3D } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

/** Writes a glTF 2.0 binary (.glb) of the object tree. */
export async function writeGlb(root: Object3D): Promise<Uint8Array> {
  const result = await new GLTFExporter().parseAsync(root, { binary: true })
  return new Uint8Array(result as ArrayBuffer)
}

export interface GltfJson {
  asset: { version: string; generator?: string }
  nodes: { name?: string; mesh?: number; children?: number[] }[]
  meshes: { name?: string; primitives: { attributes: Record<string, number>; material?: number }[] }[]
  materials?: { name?: string }[]
}

/** Parses a .glb's header and JSON chunk (for tests and checks). */
export function readGlbJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a glTF binary')
  const length = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('First chunk is not JSON')
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as GltfJson
}
