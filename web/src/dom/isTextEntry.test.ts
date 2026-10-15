import { describe, expect, it } from 'vitest'
import { isTextEntry } from './isTextEntry'

const el = (html: string) => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.firstElementChild
}

describe('isTextEntry', () => {
  it.each(['<input>', '<input type="text">', '<input type="number">', '<input type="search">', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"></div>'])(
    'is true for %s',
    (html) => expect(isTextEntry(el(html))).toBe(true),
  )

  it.each(['<input type="range">', '<input type="radio">', '<input type="checkbox">', '<input type="button">', '<button></button>', '<canvas></canvas>'])(
    'is false for %s',
    (html) => expect(isTextEntry(el(html))).toBe(false),
  )

  it('is false for non-elements', () => {
    expect(isTextEntry(window)).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})
