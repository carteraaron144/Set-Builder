// Builds the generated "setbuilder-basics" placeholder pack in code (used by scripts/makeBasicsPack.ts and tests).
// Runtime imports are only from 'three' so Node can run the script with type stripping.
import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import type { PackAsset, PaletteSlot } from './packManifest'

export interface BasicsModel {
  asset: PackAsset
  object: Group
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic per-position jitter so shared corners of non-indexed geometry move together (no cracks). */
function jitter(g: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const pos = g.getAttribute('position')
  const offsets = new Map<string, [number, number, number]>()
  const rand = mulberry32(seed)
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`
    let o = offsets.get(key)
    if (!o) {
      o = [(rand() - 0.5) * amount, (rand() - 0.5) * amount, (rand() - 0.5) * amount]
      offsets.set(key, o)
    }
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2])
  }
  return g
}

function mesh(name: string, slot: PaletteSlot, g: BufferGeometry): Mesh {
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  const material = new MeshStandardMaterial({ name: slot })
  const m = new Mesh(g, material)
  m.name = name
  return m
}

/** Shifts all meshes so the group's lowest point is at y = 0. */
function standOnGround(group: Group): Group {
  let min = Infinity
  group.traverse((o) => {
    if (o instanceof Mesh) {
      const p = o.geometry.getAttribute('position')
      for (let i = 0; i < p.count; i++) min = Math.min(min, p.getY(i))
    }
  })
  group.traverse((o) => o instanceof Mesh && o.geometry.translate(0, -min, 0))
  return group
}

function group(...meshes: Mesh[]): Group {
  const g = new Group()
  g.add(...meshes)
  return standOnGround(g)
}

function blades(count: number, minH: number, maxH: number, width: number, spread: number, seed: number): BufferGeometry {
  const rand = mulberry32(seed)
  const p: number[] = []
  for (let b = 0; b < count; b++) {
    const a = (b / count) * Math.PI * 2 + rand() * 0.5
    const h = minH + rand() * (maxH - minH)
    const lean = spread * (0.5 + rand() * 0.5)
    const cx = Math.cos(a) * 0.04
    const cz = Math.sin(a) * 0.04
    const tx = cx + Math.cos(a) * lean
    const tz = cz + Math.sin(a) * lean
    const px = -Math.sin(a) * width
    const pz = Math.cos(a) * width
    // Tapered quad: wide base, narrow tip.
    const v = [
      [cx - px, 0, cz - pz],
      [cx + px, 0, cz + pz],
      [tx + px * 0.2, h, tz + pz * 0.2],
      [tx - px * 0.2, h, tz - pz * 0.2],
    ]
    p.push(...v[0], ...v[1], ...v[2], ...v[0], ...v[2], ...v[3])
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(p, 3))
  return g
}

/** A tapered, faceted n-sided prism with bevelled ends, base at y = 0, height h. */
function prism(n: number, r: number, h: number, x: number, z: number, twist: number): BufferGeometry {
  const rTop = r * 0.8
  const rings: [number, number][] = [
    [r * 0.75, 0], // bottom cap edge
    [r, 0.06], // bottom bevel
    [rTop, h - 0.08], // top of the shaft
    [rTop * 0.6, h], // top cap edge
  ]
  const p: number[] = []
  const at = (ring: number, k: number) => {
    const [rr, y] = rings[ring]
    const a = twist + (k / n) * Math.PI * 2
    return [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr]
  }
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n
    // Bottom cap (facing down) and top cap (facing up) as fans.
    p.push(x, 0, z, ...at(0, k), ...at(0, k1))
    p.push(x, h, z, ...at(3, k1), ...at(3, k))
    // Three bands of quads between the rings.
    for (let ring = 0; ring < 3; ring++) {
      const a = at(ring, k)
      const b = at(ring, k1)
      const c = at(ring + 1, k1)
      const d = at(ring + 1, k)
      p.push(...a, ...c, ...b, ...a, ...d, ...c)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(p, 3))
  return g
}

function pillar(id: string, prisms: [number, number, number, number, number][], footprint: number): BasicsModel {
  const object = group(...prisms.map(([n, r, h, x, z], i) => mesh(`prism-${i}`, 'stone', prism(n, r, h, x, z, i * 0.7))))
  let w = 0
  for (const [, r, , x, z] of prisms) w = Math.max(w, Math.abs(x) + r, Math.abs(z) + r)
  return {
    asset: { id, file: `models/${id}.glb`, kind: 'cliff', footprint, collision: { box: [2 * w, 1, 2 * w] }, lengthRange: [2, 18] },
    object,
  }
}

const tree = (id: string, footprint: number, collision: PackAsset['collision']): PackAsset => ({
  id,
  file: `models/${id}.glb`,
  kind: 'tree',
  footprint,
  collision,
})

/** The placeholder pack's models, in pack order. Deterministic. */
export function basicsModels(): BasicsModel[] {
  const pine = group(
    mesh('trunk', 'bark', new CylinderGeometry(0.12, 0.18, 1.6, 6).translate(0, 0.8, 0)),
    mesh('crown-1', 'pine', new ConeGeometry(1.6, 3, 7).translate(0, 2.7, 0)),
    mesh('crown-2', 'pine', new ConeGeometry(1.25, 2.6, 7).translate(0, 4.1, 0)),
    mesh('crown-3', 'pine', new ConeGeometry(0.85, 2.2, 7).translate(0, 5.5, 0)),
  )
  const broadleaf = group(
    mesh('trunk', 'bark', new CylinderGeometry(0.16, 0.24, 2.8, 6).translate(0, 1.4, 0)),
    mesh('crown', 'leaf', jitter(new IcosahedronGeometry(1.9, 0), 0.5, 11).scale(1, 0.85, 1).translate(0, 4.3, 0)),
    mesh('crown-side', 'leaf', jitter(new IcosahedronGeometry(1.1, 0), 0.3, 12).translate(0.9, 3.6, 0.5)),
  )
  const rockLarge = group(mesh('rock', 'stone', jitter(new IcosahedronGeometry(1.1, 0), 0.35, 21).scale(1.15, 0.65, 1)))
  const rockSmall = group(mesh('rock', 'stone', jitter(new IcosahedronGeometry(0.42, 0), 0.14, 22).scale(1, 0.7, 1.1)))
  const bush = group(
    mesh('bush', 'leaf', jitter(new IcosahedronGeometry(0.75, 0), 0.25, 31).scale(1, 0.7, 1)),
    mesh('bush-side', 'leaf', jitter(new IcosahedronGeometry(0.5, 0), 0.18, 32).scale(1, 0.75, 1).translate(0.45, -0.05, 0.2)),
  )
  const grass = group(mesh('blades', 'grass', blades(10, 0.3, 0.5, 0.035, 0.12, 41)))
  const reeds = group(mesh('blades', 'reed', blades(12, 1.0, 1.5, 0.03, 0.18, 51)))

  const rock = (id: string, footprint: number, object: Group): BasicsModel => {
    const p = (object.children[0] as Mesh).geometry
    p.computeBoundingBox()
    const s = p.boundingBox!.getSize(p.boundingBox!.min.clone())
    return { asset: { id, file: `models/${id}.glb`, kind: 'rock', footprint, collision: { box: [s.x, s.y, s.z] } }, object }
  }

  return [
    { asset: tree('pine', 1.8, { cylinder: [0.2, 6.6] }), object: pine },
    { asset: tree('broadleaf', 2.2, { cylinder: [0.25, 6.2] }), object: broadleaf },
    rock('rock-large', 1.2, rockLarge),
    rock('rock-small', 0.45, rockSmall),
    { asset: { id: 'bush', file: 'models/bush.glb', kind: 'bush', footprint: 0.8, collision: 'none' }, object: bush },
    { asset: { id: 'grass-tuft', file: 'models/grass-tuft.glb', kind: 'grass', footprint: 0.25, collision: 'none' }, object: grass },
    { asset: { id: 'reeds', file: 'models/reeds.glb', kind: 'plant', footprint: 0.3, collision: 'none' }, object: reeds },
    pillar('pillar-single', [[7, 0.35, 1, 0, 0]], 0.4),
    pillar('pillar-pair', [[6, 0.32, 1, -0.2, 0], [5, 0.26, 0.72, 0.32, 0.1]], 0.6),
    pillar('pillar-cluster-3', [[5, 0.3, 1, 0, 0], [6, 0.26, 0.78, 0.42, 0.15], [5, 0.22, 0.6, -0.3, 0.3]], 0.7),
    pillar(
      'pillar-cluster-5',
      [[5, 0.3, 1, 0, 0], [5, 0.26, 0.82, 0.45, 0.1], [5, 0.24, 0.66, -0.38, 0.22], [5, 0.22, 0.9, 0.1, -0.42], [5, 0.2, 0.55, -0.15, 0.48]],
      0.9,
    ),
  ]
}
