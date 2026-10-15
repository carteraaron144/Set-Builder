import type { PackManifest } from '../assets/packManifest'
import type { SceneSize } from '../scene/scene'
import { CHUNK_SIZE, chunkCount } from '../terrain/chunks'
import { BIOME_IDS, heightAt, type Heightmap, type TerrainLayers } from '../terrain/layers'
import type { Vec3 } from '../terrain/pick'
import { hash4, unit } from './hash'
import type { ScatterRule, ScatterRules } from './rules'

export interface ScatterInputs {
  layers: TerrainLayers
  seed: number
  rules: ScatterRules
  /** 1 m grid like the biome map; non-zero means no scatter. Null in M2. */
  exclusion: Uint8Array | null
}

/** What scatter needs to know about an asset ("<packId>/<assetId>"). */
export interface AssetInfo {
  footprint: number
  /** Width across (metres, before scale): from the collision box, else twice the footprint. */
  width: number
  lengthRange?: [number, number]
}

export interface Instance {
  rule: number
  x: number
  y: number
  z: number
  /** Rotation quaternion [x, y, z, w]. */
  quat: [number, number, number, number]
  /** Ground: uniform. Face: [width, length, width]. */
  scale: [number, number, number]
  priority: number
}

export interface ChunkScatter {
  chunk: number
  /** Sorted by rule, then priority (highest first). */
  instances: Instance[]
  capped: boolean
}

const DEG = Math.PI / 180
const FOOT_BAND = 0.75 // metres: face candidates must sit this close to their wall foot
const MARCH_STEP = 0.1 // metres, horizontal
const MARCH_MAX = 16 // metres, horizontal each way
const SALT = { x: 1, z: 2, priority: 3, keep: 4, yaw: 5, tilt: 6, tiltDir: 7, scale: 8, length: 9 }

export function assetInfoFrom(packs: { packId: string; manifest: PackManifest }[]): Record<string, AssetInfo> {
  const out: Record<string, AssetInfo> = {}
  for (const { packId, manifest } of packs)
    for (const a of manifest.assets) {
      const c = a.collision
      const width = typeof c === 'object' && 'box' in c ? Math.max(c.box[0], c.box[2]) : 2 * a.footprint
      out[`${packId}/${a.id}`] = { footprint: a.footprint, width, lengthRange: a.lengthRange }
    }
  return out
}

export function scatterMargin(rules: ScatterRules, assets: Record<string, AssetInfo>): number {
  const spacing = Math.max(0, ...rules.rules.map((r) => r.minSpacing))
  const footprint = Math.max(0, ...rules.rules.map((r) => assets[r.asset]?.footprint ?? 0))
  return spacing + 2 * footprint
}

export function chunkCap(rules: ScatterRules, size: SceneSize): number {
  return Math.floor(rules.maxInstances / chunkCount(size) ** 2)
}

function gradient(h: Heightmap, x: number, z: number, d = 0.25): [number, number] {
  return [(heightAt(h, x + d, z) - heightAt(h, x - d, z)) / (2 * d), (heightAt(h, x, z + d) - heightAt(h, x, z - d)) / (2 * d)]
}

/** One biome channel, bilinear (0..1), without allocating. */
function biomeWeight(b: TerrainLayers['biomes'], x: number, z: number, channel: number): number {
  const res = b.resolution
  const gx = Math.min(res - 1, Math.max(0, x + b.size / 2))
  const gz = Math.min(res - 1, Math.max(0, z + b.size / 2))
  const i0 = Math.min(res - 2, Math.floor(gx))
  const j0 = Math.min(res - 2, Math.floor(gz))
  const fx = gx - i0
  const fz = gz - j0
  const d = b.data
  const at = (i: number, j: number) => d[(j * res + i) * 4 + channel]
  return ((at(i0, j0) * (1 - fx) + at(i0 + 1, j0) * fx) * (1 - fz) + (at(i0, j0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1) * fx) * fz) / 255
}

const slopeAt = (h: Heightmap, x: number, z: number, d = 0.25) => Math.atan(Math.hypot(...gradient(h, x, z, d)))
/** Narrow window for wall marching, so foot and top land on the real slope edges. */
const WALL_WINDOW = 0.05

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}

/** The steep wall through (x, z): foot and top along the fall line, with its outward normal and uphill axis. */
export function measureWall(h: Heightmap, x: number, z: number, minSlopeDeg: number) {
  const min = minSlopeDeg * DEG
  const [gx, gz] = gradient(h, x, z)
  const g = Math.hypot(gx, gz)
  if (Math.atan(g) < min) return null
  // Walk until the slope eases; the narrow window keeps the overshoot past the real edge under 0.15 m.
  const dx = gx / g
  const dz = gz / g
  const half = h.size / 2
  const walk = (sign: number) => {
    let px = x
    let pz = z
    for (let d = 0; d < MARCH_MAX; d += MARCH_STEP) {
      const qx = px + sign * dx * MARCH_STEP
      const qz = pz + sign * dz * MARCH_STEP
      if (Math.abs(qx) > half || Math.abs(qz) > half) break
      px = qx
      pz = qz
      if (slopeAt(h, px, pz, WALL_WINDOW) < min) break
    }
    return { x: px, y: heightAt(h, px, pz), z: pz }
  }
  const foot = walk(-1)
  const top = walk(1)
  // Uphill fall-line tangent, measured with the narrow window halfway up the face (always on the real slope), keeps
  // pillars parallel to the face on ramps, cones and stepped walls. Falls back to the foot-to-top line.
  const [mx, mz] = gradient(h, (foot.x + top.x) / 2, (foot.z + top.z) / 2, WALL_WINDOW)
  const gm = Math.hypot(mx, mz)
  const up =
    gm > Math.tan(min) * 0.5
      ? normalize({ x: mx / gm, y: gm, z: mz / gm })
      : normalize({ x: top.x - foot.x, y: top.y - foot.y, z: top.z - foot.z })
  let n = normalize({ x: -gx, y: 1, z: -gz })
  const dot = n.x * up.x + n.y * up.y + n.z * up.z
  n = normalize({ x: n.x - up.x * dot, y: n.y - up.y * dot, z: n.z - up.z * dot })
  return { foot, top, height: top.y - foot.y, normal: n, up }
}

type Quat = [number, number, number, number]

const quatMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const axisAngle = (ax: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2)
  return [ax.x * s, ax.y * s, ax.z * s, Math.cos(angle / 2)]
}

/** Rotation taking +X, +Y, +Z to the given orthonormal basis. */
function basisQuat(xa: Vec3, ya: Vec3, za: Vec3): Quat {
  const m00 = xa.x, m01 = ya.x, m02 = za.x
  const m10 = xa.y, m11 = ya.y, m12 = za.y
  const m20 = xa.z, m21 = ya.z, m22 = za.z
  const tr = m00 + m11 + m22
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
}

interface Candidate {
  x: number
  z: number
  priority: number
  /** Face rules: the wall measured from the candidate. */
  wall?: NonNullable<ReturnType<typeof measureWall>>
}

/** Evaluates candidates lazily and caches them for one scatter call. */
class Field {
  private readonly cache = new Map<number, Candidate | null>()
  private readonly cell: number[]
  private readonly half: number
  private readonly inp: ScatterInputs
  private readonly assets: Record<string, AssetInfo>
  constructor(inp: ScatterInputs, assets: Record<string, AssetInfo>) {
    this.inp = inp
    this.assets = assets
    this.cell = inp.rules.rules.map((r) => r.minSpacing / Math.SQRT2)
    this.half = inp.layers.heights.size / 2
  }

  cellSize(rule: number) {
    return this.cell[rule]
  }

  footprint(rule: number) {
    return this.assets[this.inp.rules.rules[rule].asset]?.footprint ?? 0
  }

  /** The surviving candidate of a rule's cell, or null. */
  survivor(rule: number, ci: number, cj: number): Candidate | null {
    // Numeric key: cells stay within ±2048 of the origin for any scene size and spacing in use.
    const k = (rule * 4096 + ci + 2048) * 4096 + cj + 2048
    const hit = this.cache.get(k)
    if (hit !== undefined) return hit
    const c = this.evaluate(rule, ci, cj)
    this.cache.set(k, c)
    return c
  }

  private evaluate(rule: number, ci: number, cj: number): Candidate | null {
    const { seed, layers, exclusion, rules } = this.inp
    const r = rules.rules[rule]
    const cs = this.cell[rule]
    const h = (salt: number) => hash4(seed, rule, ci, cj, salt)
    const x = (ci + unit(h(SALT.x))) * cs
    const z = (cj + unit(h(SALT.z))) * cs
    if (x < -this.half || x >= this.half || z < -this.half || z >= this.half) return null
    if (exclusion) {
      const res = layers.biomes.resolution
      const i = Math.round(x + this.half)
      const j = Math.round(z + this.half)
      if (exclusion[j * res + i]) return null
    }
    const weight = r.biome === 'any' ? 1 : biomeWeight(layers.biomes, x, z, BIOME_IDS.indexOf(r.biome))
    if (unit(h(SALT.keep)) >= r.density * weight * cs * cs) return null
    const y = heightAt(layers.heights, x, z)
    if (y < r.minHeight || y > r.maxHeight) return null
    const priority = h(SALT.priority)
    if (r.placement === 'ground') {
      if (slopeAt(layers.heights, x, z) > r.maxSlopeDeg * DEG) return null
      return { x, z, priority }
    }
    const wall = measureWall(layers.heights, x, z, r.minSlopeDeg!)
    if (!wall || wall.height < r.minWallHeight!) return null
    if (Math.hypot(wall.foot.x - x, wall.foot.z - z) > FOOT_BAND) return null
    return { x, z, priority, wall }
  }

  /** Accepted: no higher-priority surviving neighbour within spacing, none of an earlier blocking rule within footprints. */
  accepted(rule: number, ci: number, cj: number, c: Candidate): boolean {
    const rules = this.inp.rules.rules
    const r = rules[rule]
    const cs = this.cell[rule]
    const reach = Math.ceil(r.minSpacing / cs)
    for (let dj = -reach; dj <= reach; dj++)
      for (let di = -reach; di <= reach; di++) {
        if (!di && !dj) continue
        const o = this.survivor(rule, ci + di, cj + dj)
        if (!o || Math.hypot(o.x - c.x, o.z - c.z) >= r.minSpacing) continue
        if (o.priority > c.priority || (o.priority === c.priority && (cj + dj) * 1e6 + ci + di > cj * 1e6 + ci)) return false
      }
    const fp = this.footprint(rule)
    for (let e = 0; e < rule; e++) {
      const other = rules[e]
      if (!other.blocking || (other.placement === 'face' && r.placement === 'face')) continue
      const reachDist = fp + this.footprint(e)
      const ocs = this.cell[e]
      const i0 = Math.floor((c.x - reachDist) / ocs)
      const i1 = Math.floor((c.x + reachDist) / ocs)
      const j0 = Math.floor((c.z - reachDist) / ocs)
      const j1 = Math.floor((c.z + reachDist) / ocs)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const o = this.survivor(e, i, j)
          if (o && Math.hypot(o.x - c.x, o.z - c.z) < reachDist) return false
        }
    }
    return true
  }

  instance(rule: number, ci: number, cj: number, c: Candidate): Instance {
    const { seed, layers, rules } = this.inp
    const r = rules.rules[rule]
    const h = (salt: number) => unit(hash4(seed, rule, ci, cj, salt))
    const s = r.scale[0] + (r.scale[1] - r.scale[0]) * h(SALT.scale)
    if (r.placement === 'ground') {
      const yaw = axisAngle({ x: 0, y: 1, z: 0 }, h(SALT.yaw) * Math.PI * 2)
      const dir = h(SALT.tiltDir) * Math.PI * 2
      const tilt = axisAngle({ x: Math.cos(dir), y: 0, z: Math.sin(dir) }, h(SALT.tilt) * r.maxTiltDeg * DEG)
      return { rule, x: c.x, y: heightAt(layers.heights, c.x, c.z), z: c.z, quat: quatMul(tilt, yaw), scale: [s, s, s], priority: c.priority }
    }
    const w = c.wall!
    const sink = r.sinkDepth!
    const info = this.assets[r.asset]
    const [lo, hi] = info?.lengthRange ?? [0.5, 100]
    const length = Math.min(hi, Math.max(lo, (w.height + sink) * (0.7 + 0.3 * h(SALT.length))))
    // Basis: Y along the wall's fall line, Z out of the wall, X along the wall.
    const ya = w.up
    const za = w.normal
    const xa = normalize({ x: ya.y * za.z - ya.z * za.y, y: ya.z * za.x - ya.x * za.z, z: ya.x * za.y - ya.y * za.x })
    const lean = axisAngle(za, (h(SALT.tilt) * 2 - 1) * r.maxTiltDeg * DEG)
    const spin = axisAngle(ya, (h(SALT.yaw) * 2 - 1) * r.maxTiltDeg * DEG)
    const quat = quatMul(quatMul(lean, spin), basisQuat(xa, ya, za))
    // Base: sinkDepth below the foot along the axis. The axis sits 40% of the pillar's radius inside the face, so its
    // back is embedded (no gap) and its front stands proud.
    const push = 0.4 * (((info?.width ?? 0.7) / 2) * s)
    return {
      rule,
      x: w.foot.x - ya.x * sink - za.x * push,
      y: w.foot.y - ya.y * sink - za.y * push,
      z: w.foot.z - ya.z * sink - za.z * push,
      quat,
      scale: [s, length, s],
      priority: c.priority,
    }
  }
}

/** All accepted instances whose candidate lies in the half-open world rect [x0, x1) × [z0, z1). Uncapped. */
export function scatterRect(inp: ScatterInputs, x0: number, z0: number, x1: number, z1: number, assets: Record<string, AssetInfo>): Instance[] {
  const field = new Field(inp, assets)
  const out: Instance[] = []
  inp.rules.rules.forEach((rule, ri) => {
    if (!assets[rule.asset]) return
    const cs = field.cellSize(ri)
    for (let cj = Math.floor(z0 / cs); cj <= Math.floor(z1 / cs); cj++)
      for (let ci = Math.floor(x0 / cs); ci <= Math.floor(x1 / cs); ci++) {
        const c = field.survivor(ri, ci, cj)
        if (!c || c.x < x0 || c.x >= x1 || c.z < z0 || c.z >= z1) continue
        if (field.accepted(ri, ci, cj, c)) out.push(field.instance(ri, ci, cj, c))
      }
  })
  return out
}

export function scatterChunk(inp: ScatterInputs, chunk: number, assets: Record<string, AssetInfo>): ChunkScatter {
  const size = inp.layers.heights.size
  const n = chunkCount(size)
  const x0 = -size / 2 + (chunk % n) * CHUNK_SIZE
  const z0 = -size / 2 + Math.floor(chunk / n) * CHUNK_SIZE
  const all = scatterRect(inp, x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE, assets)
  all.sort((a, b) => a.rule - b.rule || b.priority - a.priority)
  const cap = chunkCap(inp.rules, size)
  return { chunk, instances: all.length > cap ? all.slice(0, cap) : all, capped: all.length > cap }
}

export type { ScatterRule }
