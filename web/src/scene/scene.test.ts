import { describe, expect, it } from 'vitest'
import { createScene, GENERATOR_VERSION, renameScene, SCENE_FORMAT_VERSION, SCENE_SIZES } from './scene'

const NOW = new Date('2026-10-15T12:00:00Z')

describe('createScene', () => {
  it('builds a scene from explicit values', () => {
    expect(createScene({ size: 128, now: NOW, id: 'a', seed: 7 })).toEqual({
      formatVersion: 2,
      generatorVersion: 1,
      id: 'a',
      name: 'Untitled scene',
      size: 128,
      seed: 7,
      createdAt: '2026-10-15T12:00:00.000Z',
      updatedAt: '2026-10-15T12:00:00.000Z',
    })
  })

  it('generates a UUID id and a 32-bit unsigned integer seed', () => {
    const s = createScene({ size: 64 })
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(Number.isInteger(s.seed)).toBe(true)
    expect(s.seed).toBeGreaterThanOrEqual(0)
    expect(s.seed).toBeLessThan(2 ** 32)
  })

  it('trims names and caps them at 80 characters', () => {
    expect(createScene({ size: 64, name: '  Forest  ' }).name).toBe('Forest')
    expect(createScene({ size: 64, name: 'x'.repeat(100) }).name).toBe('x'.repeat(80))
  })

  it('uses the default name for empty or blank names', () => {
    expect(createScene({ size: 64, name: '' }).name).toBe('Untitled scene')
    expect(createScene({ size: 64, name: '   ' }).name).toBe('Untitled scene')
  })

  it('exposes the sizes and format version', () => {
    expect(SCENE_SIZES).toEqual([64, 128, 256])
    expect(SCENE_FORMAT_VERSION).toBe(2)
    expect(GENERATOR_VERSION).toBe(1)
  })
})

describe('renameScene', () => {
  it('changes only name and updatedAt', () => {
    const s = createScene({ size: 128, now: NOW, id: 'a', seed: 7 })
    const later = new Date('2026-10-16T08:30:00Z')
    expect(renameScene(s, '  Canyon ', later)).toEqual({
      ...s,
      name: 'Canyon',
      updatedAt: '2026-10-16T08:30:00.000Z',
    })
  })
})
