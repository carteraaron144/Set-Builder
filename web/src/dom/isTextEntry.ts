/** Input types that don't take typed text: editor and camera keys keep working while they have focus. */
const NON_TEXT_INPUTS = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']

const TEXT_ENTRY = [
  `input:not(${NON_TEXT_INPUTS.map((t) => `[type="${t}"]`).join(',')})`,
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ')

/** True for fields that take typed text, where editor and camera keys must not act. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.matches(TEXT_ENTRY)
}
