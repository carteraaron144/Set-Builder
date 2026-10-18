import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePackManifest } from '../assets/packManifest'
import type { SceneSize } from '../scene/scene'
import { paint } from '../terrain/brush'
import { CHUNK_SIZE, chunkCount } from '../terrain/chunks'
import { createFlatLayers, heightAt, type TerrainLayers } from '../terrain/layers'
import { parseRules, rulesFor, type ScatterRules } from './rules'
import { assetInfoFrom, chunkCap, measureWall, scatterChunk, scatterMargin, scatterRect, type Instance, type ScatterInputs, type SurfaceLevels } from './scatter'

const manifest = parsePackManifest(JSON.parse(readFileSync(resolve(__dirname, '../../../packs/setbuilder-basics/pack.json'), 'utf8')))
const assets = assetInfoFrom([{ packId: 'setbuilder-basics', manifest }])
const RULES = rulesFor(2)

function layers(size: SceneSize, biome: 0 | 1 | 2 | 3 = 0): TerrainLayers {
  const l = createFlatLayers(size)
  if (biome) for (let o = 0; o < l.biomes.data.length; o += 4) l.biomes.data.set(biome === 1 ? [0, 255, 0, 0] : biome === 2 ? [0, 0, 255, 0] : [0, 0, 0, 255], o)
  return l
}
const inputs = (l: TerrainLayers, rules: ScatterRules = RULES, seed = 7, exclusion: Uint8Array | null = null): ScatterInputs => ({ layers: l, seed, rules, exclusion })
const all = (inp: ScatterInputs) => {
  const n = chunkCount(inp.layers.heights.size)
  return Array.from({ length: n * n }, (_, c) => scatterChunk(inp, c, assets))
}
const flat = (cs: { instances: Instance[] }[]) => cs.flatMap((c) => c.instances)
const key = (i: Instance) => `${i.rule}:${i.x.toFixed(4)}:${i.z.toFixed(4)}`
const ruleIndex = (asset: string, biome?: string, rules: ScatterRules = RULES) =>
  rules.rules.findIndex((r) => r.asset === `setbuilder-basics/${asset}` && (!biome || r.biome === biome))
const deg = (r: number) => (r * 180) / Math.PI

/** Writes heights with f(x, z) in world metres. */
function shape(l: TerrainLayers, f: (x: number, z: number) => number) {
  const { resolution: res, size } = l.heights
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) l.heights.data[j * res + i] = f(-size / 2 + i * 0.5, -size / 2 + j * 0.5)
}

const groundOnly = (scale = 1): ScatterRules =>
  parseRules({ maxInstances: 1e9, rules: RULES.rules.filter((r) => r.placement === 'ground').map((r) => ({ ...r, density: Math.min(r.density * scale, 2 / r.minSpacing ** 2) })) })

describe('scatter', () => {
  it('is deterministic and depends on the seed', () => {
    const l = layers(64, 1)
    expect(scatterChunk(inputs(l), 1, assets)).toEqual(scatterChunk(inputs(l), 1, assets))
    expect(flat([scatterChunk(inputs(l, RULES, 8), 1, assets)]).map(key)).not.toEqual(flat([scatterChunk(inputs(l), 1, assets)]).map(key))
  })

  it('has no seams: chunk by chunk equals one pass over the whole scene', () => {
    const l = layers(128, 1)
    paint(l.biomes, 'meadow', { radius: 20, strength: 1, falloff: 0.5 }, { x: 10, z: -5, dt: 0.3, invert: false })
    const inp = inputs(l, groundOnly())
    const chunked = flat(all(inp)).map(key).sort()
    const whole = scatterRect(inp, -64, -64, 64, 64, assets).map(key).sort()
    expect(chunked).toEqual(whole)
    expect(new Set(chunked).size).toBe(chunked.length)
  })

  it('keeps each rule apart by its spacing and each instance in one chunk', () => {
    const l = layers(64, 1)
    const inp = inputs(l, groundOnly())
    const results = all(inp)
    const items = flat(results)
    for (let r = 0; r < inp.rules.rules.length; r++) {
      const pts = items.filter((i) => i.rule === r)
      const s = inp.rules.rules[r].minSpacing
      for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) expect(Math.hypot(pts[a].x - pts[b].x, pts[a].z - pts[b].z)).toBeGreaterThanOrEqual(s - 1e-9)
    }
    for (const c of results)
      for (const i of c.instances) {
        const n = chunkCount(64)
        const cx = c.chunk % n
        const cz = Math.floor(c.chunk / n)
        expect(i.x).toBeGreaterThanOrEqual(-32 + cx * CHUNK_SIZE)
        expect(i.x).toBeLessThan(-32 + (cx + 1) * CHUNK_SIZE)
        expect(i.z).toBeGreaterThanOrEqual(-32 + cz * CHUNK_SIZE)
        expect(i.z).toBeLessThan(-32 + (cz + 1) * CHUNK_SIZE)
      }
  })

  it('changes only nearby chunks after a paint stroke', () => {
    const l = layers(128, 0)
    const before = all(inputs(l)).map((c) => c.instances.map(key).join())
    paint(l.biomes, 'forest', { radius: 6, strength: 1, falloff: 0 }, { x: -50, z: -50, dt: 1, invert: false })
    const after = all(inputs(l)).map((c) => c.instances.map(key).join())
    const changed = after.map((v, i) => (v !== before[i] ? i : -1)).filter((i) => i >= 0)
    expect(changed).toContain(0)
    const margin = scatterMargin(RULES, assets)
    for (const c of changed) {
      const cx = c % 4
      const cz = Math.floor(c / 4)
      const dx = Math.max(0, -64 + cx * 32 - (-50 + 6))
      const dz = Math.max(0, -64 + cz * 32 - (-50 + 6))
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(margin)
      expect(cx <= 1 && cz <= 1).toBe(true)
    }
  })

  it('follows biome weights', () => {
    const meadow = flat(all(inputs(layers(64, 0))))
    expect(meadow.some((i) => i.rule === ruleIndex('pine'))).toBe(false)
    const l = layers(64, 0)
    paint(l.biomes, 'forest', { radius: 10, strength: 1, falloff: 0 }, { x: 0, z: 0, dt: 1, invert: false })
    const pines = flat(all(inputs(l))).filter((i) => i.rule === ruleIndex('pine'))
    expect(pines.length).toBeGreaterThan(0)
    for (const p of pines) expect(Math.hypot(p.x, p.z)).toBeLessThan(11)
  })

  it('places a regression-stable number of grass tufts on uniform meadow', () => {
    const ground = groundOnly()
    const r = ruleIndex('grass-tuft', 'meadow', ground)
    const n = flat(all(inputs(layers(64, 0), ground))).filter((i) => i.rule === r).length
    const expected = ground.rules[r].density * 64 * 64
    expect(n).toBeGreaterThan(expected * 0.5)
    expect(n).toBeLessThan(expected * 1.15)
    expect(n).toBe(GRASS_ON_64M_MEADOW)
  })

  it('respects slope and height limits and the exclusion mask', () => {
    const ramp = layers(64, 1)
    shape(ramp, (x) => x)
    const steep = flat(all(inputs(ramp)))
    expect(steep.some((i) => RULES.rules[i.rule].asset.endsWith('pine'))).toBe(false)
    const rocky = layers(64, 2)
    shape(rocky, (x) => x)
    expect(flat(all(inputs(rocky))).some((i) => RULES.rules[i.rule].asset.endsWith('rock-large'))).toBe(true)

    const swamp = layers(64, 3)
    shape(swamp, (x) => (x + 32) * 0.15)
    const reeds = flat(all(inputs(swamp))).filter((i) => i.rule === ruleIndex('reeds'))
    expect(reeds.length).toBeGreaterThan(0)
    for (const i of reeds) expect(i.y).toBeLessThanOrEqual(2)

    const mask = new Uint8Array(65 * 65)
    for (let j = 0; j < 65; j++) for (let i = 0; i < 32; i++) mask[j * 65 + i] = 1
    const masked = flat(all(inputs(layers(64, 1), RULES, 7, mask)))
    expect(masked.length).toBeGreaterThan(0)
    for (const i of masked) expect(i.x).toBeGreaterThanOrEqual(-1)
  })

  it('caps dense chunks deterministically, keeping earlier rules first', () => {
    const ground = groundOnly()
    const pine = ground.rules[ruleIndex('pine', 'forest', ground)]
    const grass = { ...ground.rules[ruleIndex('grass-tuft', 'forest', ground)], minSpacing: 0.3, density: 22 }
    expect(chunkCap(parseRules({ maxInstances: 100000, rules: [pine, grass] }), 256)).toBe(1562)
    const dense = parseRules({ maxInstances: 100000, rules: [pine, grass] })
    const l = layers(256, 1)
    const a = scatterChunk(inputs(l, dense), 27, assets)
    expect(a.capped).toBe(true)
    expect(a.instances).toHaveLength(1562)
    expect(scatterChunk(inputs(l, dense), 27, assets)).toEqual(a)
    const rulesSeen = a.instances.map((i) => i.rule)
    expect(rulesSeen).toEqual([...rulesSeen].sort((x, y) => x - y))
    expect(rulesSeen[0]).toBe(0)
    expect(rulesSeen.filter((r) => r === 0).length).toBeGreaterThan(5)
  })

  it('places ground instances on the ground with jitter in range', () => {
    const l = layers(64, 1)
    shape(l, (x, z) => Math.sin(x / 9) * 2 + Math.cos(z / 7))
    for (const i of flat(all(inputs(l)))) {
      const r = RULES.rules[i.rule]
      if (r.placement !== 'ground') continue
      expect(i.y).toBeCloseTo(heightAt(l.heights, i.x, i.z), 5)
      expect(i.scale[0]).toBeGreaterThanOrEqual(r.scale[0] - 1e-9)
      expect(i.scale[0]).toBeLessThanOrEqual(r.scale[1] + 1e-9)
      expect(i.scale[1]).toBe(i.scale[0])
      const [qx, qy, qz, qw] = i.quat
      // Tilt = angle between the rotated up axis and +Y.
      const upY = 1 - 2 * (qx * qx + qz * qz)
      expect(deg(Math.acos(Math.min(1, upY)))).toBeLessThanOrEqual(r.maxTiltDeg + 1e-6)
      expect(Math.hypot(qx, qy, qz, qw)).toBeCloseTo(1)
    }
  })
})

describe('face placement', () => {
  const faceRules = RULES.rules.map((r, i) => (r.placement === 'face' ? i : -1)).filter((i) => i >= 0)
  const rotate = (q: number[], v: number[]) => {
    const [x, y, z, w] = q
    const [vx, vy, vz] = v
    const ix = w * vx + y * vz - z * vy
    const iy = w * vy + z * vx - x * vz
    const iz = w * vz + x * vy - y * vx
    const iw = -x * vx - y * vy - z * vz
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]
  }

  function cliff(f: (x: number, z: number) => number) {
    const l = layers(64, 0)
    shape(l, f)
    return { l, items: flat(all(inputs(l))).filter((i) => faceRules.includes(i.rule)) }
  }

  const walls: [string, (x: number, z: number) => number, number][] = [
    ['vertical 10 m wall', (x) => (x < 0 ? 0 : 10), 10],
    ['70° wall', (x) => Math.min(10, Math.max(0, x * Math.tan((70 * Math.PI) / 180))), 10],
    ['curved cliff (steep cone)', (x, z) => Math.min(10, Math.max(0, (12 - Math.hypot(x, z)) * 4)), 10],
  ]

  it.each(walls)('covers a %s with embedded pillars only on the wall', (_label, f, height) => {
    const { l, items } = cliff(f)
    expect(items.length).toBeGreaterThan(10)
    for (const i of items) {
      const r = RULES.rules[i.rule]
      const a = assets[r.asset]
      const up = rotate(i.quat, [0, 1, 0])
      const n = rotate(i.quat, [0, 0, 1])
      const L = i.scale[1]
      expect(L).toBeGreaterThanOrEqual(Math.min(a.lengthRange![1], (height + 0.4) * 0.7) - 0.6)
      expect(L).toBeLessThanOrEqual(Math.max(a.lengthRange![0], (height + 0.4) * 1.0) + 0.6)
      const half = (a.width / 2) * i.scale[0]
      for (let t = 0.6; t < L - 0.6; t += 0.5) {
        const p = [i.x + up[0] * t, i.y + up[1] * t, i.z + up[2] * t]
        // Back line: the axis offset by the pillar's radius toward the wall must be embedded (no gap behind it).
        const back = [p[0] - n[0] * half * 0.9, p[1] - n[1] * half * 0.9, p[2] - n[2] * half * 0.9]
        expect(back[1], 'back line inside the wall').toBeLessThanOrEqual(heightAt(l.heights, back[0], back[2]) + 0.05)
        // The pillar's own front face (its radius out from the axis) must stand proud of the wall: visible, not buried.
        const front = [p[0] + n[0] * half * 0.9, p[1] + n[1] * half * 0.9, p[2] + n[2] * half * 0.9]
        expect(front[1], 'front outside the wall').toBeGreaterThan(heightAt(l.heights, front[0], front[2]) - 0.05)
      }
    }
  })

  it('leans pillars along the uphill fall line on a 70° wall', () => {
    const { items } = cliff(walls[1][1])
    const fall = [Math.cos((70 * Math.PI) / 180), Math.sin((70 * Math.PI) / 180), 0]
    for (const i of items) {
      const up = rotate(i.quat, [0, 1, 0])
      expect(deg(Math.acos(Math.min(1, up[0] * fall[0] + up[1] * fall[1] + up[2] * fall[2])))).toBeLessThan(9)
    }
  })

  it('overlaps neighbouring pillars along a wall', () => {
    const { items } = cliff(walls[0][1])
    const width = (i: Instance) => assets[RULES.rules[i.rule].asset].width * i.scale[0]
    const along = items.filter((i) => Math.abs(i.z) < 25).sort((a, b) => a.z - b.z)
    // Priority rejection keeps chunks seam-free but can't guarantee gap-free cover: most neighbours overlap, no wide gaps.
    let overlapping = 0
    for (let k = 1; k < along.length; k++) {
      const gap = along[k].z - along[k - 1].z
      expect(gap).toBeLessThan(1.5)
      if (gap < (width(along[k]) + width(along[k - 1])) / 2) overlapping++
    }
    expect(overlapping / (along.length - 1)).toBeGreaterThanOrEqual(0.95)
  })

  it('leaves terrace risers and walls under 3 m bare, and keeps ground rules off faces', () => {
    expect(cliff((x) => Math.floor(Math.max(0, x + 20) / 4) * 1.5).items).toHaveLength(0)
    expect(cliff((x) => (x < 0 ? 0 : 2.5)).items).toHaveLength(0)
    const l = layers(64, 1)
    shape(l, (x) => (x < 0 ? 0 : 10))
    for (const i of flat(all(inputs(l)))) {
      const r = RULES.rules[i.rule]
      if (r.placement === 'ground') expect(Math.abs(i.x)).toBeGreaterThan(0.5)
    }
  })

  it('gives the same pillars chunk by chunk as in one pass across a chunk border', () => {
    const l = layers(64, 0)
    shape(l, (x) => (x < 0 ? 0 : 20))
    const faceOnly = parseRules({ maxInstances: 1e9, rules: RULES.rules.filter((r) => r.placement === 'face') })
    const inp = inputs(l, faceOnly)
    const chunked = flat(all(inp)).map(key).sort()
    expect(chunked.length).toBeGreaterThan(20)
    expect(chunked).toEqual(scatterRect(inp, -32, -32, 32, 32, assets).map(key).sort())
  })

  it('measures a vertical step', () => {
    const l = layers(64, 0)
    shape(l, (x) => (x < 0 ? 0 : 10))
    const w = measureWall(l.heights, 0.1, 3, 60)!
    expect(w.height).toBeGreaterThan(9.5)
    expect(w.height).toBeLessThan(10.5)
    expect(deg(Math.acos(w.up.y))).toBeLessThan(5)
    expect(measureWall(l.heights, -10, 3, 60)).toBeNull()
  })
})

describe('scatter on sculpted levels', () => {
  const levelsFor = (ys: number[]): SurfaceLevels => {
    const y = new Float32Array(65 * 65 * ys.length)
    ys.forEach((v, l) => y.fill(v, l * 65 * 65, (l + 1) * 65 * 65))
    return { ci: 0, cj: 0, levels: ys.length, y }
  }
  const rules = groundOnly()

  it('is unchanged by an empty levels map, and by one level that follows the heightmap', () => {
    const l = layers(64, 1)
    const base = scatterChunk(inputs(l, rules), 0, assets)
    expect(scatterChunk({ ...inputs(l, rules), levels: new Map() }, 0, assets)).toEqual(base)
    expect(scatterChunk({ ...inputs(l, rules), levels: new Map([[0, levelsFor([0])]]) }, 0, assets)).toEqual(base)
  })

  it('places ground rules on every level, each level keeping its spacing', () => {
    const l = layers(64, 1)
    const res = scatterChunk({ ...inputs(l, rules), levels: new Map([[0, levelsFor([10, 0])]]) }, 0, assets)
    const high = res.instances.filter((i) => i.y === 10)
    const low = res.instances.filter((i) => i.y === 0)
    expect(high.length).toBeGreaterThan(5)
    expect(low.length).toBeGreaterThan(5)
    expect(res.instances.length).toBe(high.length + low.length)
    for (const set of [high, low])
      for (let a = 0; a < set.length; a++)
        for (let b = a + 1; b < set.length; b++)
          if (set[a].rule === set[b].rule) expect(Math.hypot(set[a].x - set[b].x, set[a].z - set[b].z)).toBeGreaterThanOrEqual(rules.rules[set[a].rule].minSpacing - 1e-9)
  })

  it('skips a level whose corners are missing or differ by more than a metre', () => {
    const l = layers(64, 1)
    const lv = levelsFor([10, 0])
    lv.y.fill(NaN, 65 * 65) // no lower level anywhere
    const none = scatterChunk({ ...inputs(l, rules), levels: new Map([[0, lv]]) }, 0, assets)
    expect(none.instances.every((i) => i.y === 10)).toBe(true)
    const steep = levelsFor([0])
    for (let k = 0; k < steep.y.length; k++) steep.y[k] = (k % 2) * 2
    expect(scatterChunk({ ...inputs(l, rules), levels: new Map([[0, steep]]) }, 0, assets).instances).toEqual([])
  })
})

const GRASS_ON_64M_MEADOW = 439
