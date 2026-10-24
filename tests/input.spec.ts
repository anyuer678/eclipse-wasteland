import { describe, it, expect } from 'vitest'
import { Input } from '../src/play/input'

type Internals = {
  onKeyDown(e: KeyboardEvent): void
  onKeyUp(e: KeyboardEvent): void
  onMouseDown(e: MouseEvent): void
  onBlur(): void
}
const call = (i: Input, fn: keyof Internals, e?: unknown) =>
  (i as unknown as Internals)[fn](e as KeyboardEvent & MouseEvent)

const key = (code: string, prevented: string[] = []): KeyboardEvent =>
  ({ code, preventDefault: () => prevented.push(code) }) as unknown as KeyboardEvent

describe('Input 浏览器默认行为与失焦', () => {
  it('Tab/空格/方向键阻止默认行为，普通键不拦截', () => {
    const i = new Input()
    const prevented: string[] = []
    for (const code of ['Tab', 'Space', 'ArrowUp', 'ArrowDown']) call(i, 'onKeyDown', key(code, prevented))
    call(i, 'onKeyDown', key('Digit3', prevented))
    expect(prevented).toEqual(['Tab', 'Space', 'ArrowUp', 'ArrowDown'])
    expect(i.pressed('Tab')).toBe(true)
    call(i, 'onKeyUp', key('Tab'))
    expect(i.pressed('Tab')).toBe(false)
  })

  it('主菜单关闭拦截时保留 Tab 焦点导航', () => {
    const i = new Input()
    i.captureDefaultKeys = false
    const prevented: string[] = []
    call(i, 'onKeyDown', key('Tab', prevented))
    call(i, 'onKeyDown', key('Space', prevented))
    expect(prevented).toEqual([])
    expect(i.pressed('Tab')).toBe(true)
  })

  it('失焦清空按键与鼠标，避免 Tab/移动键卡住', () => {
    const i = new Input()
    call(i, 'onKeyDown', key('Tab'))
    call(i, 'onKeyDown', key('KeyW'))
    call(i, 'onMouseDown', { button: 0 })
    expect(i.pressed('KeyW')).toBe(true)
    expect(i.mouseButton(0)).toBe(true)
    call(i, 'onBlur')
    expect(i.pressed('KeyW')).toBe(false)
    expect(i.pressed('Tab')).toBe(false)
    expect(i.mouseButton(0)).toBe(false)
  })
})
