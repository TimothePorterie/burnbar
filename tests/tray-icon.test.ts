import { describe, expect, it } from 'vitest'
import { renderGaugeBitmap } from '../src/main/tray-icon'

const alpha = (bitmap: Buffer, x: number, y: number, scale: 1 | 2): number =>
  bitmap[((y * scale) * 18 * scale + x * scale) * 4 + 3]

describe('tray gauge bitmap', () => {
  it.each([1, 2] as const)('renders black BGRA pixels at scale %d', scale => {
    const bitmap = renderGaugeBitmap(50, 25, scale, false)
    expect(bitmap.length).toBe((18 * scale) ** 2 * 4)
    for (let offset = 0; offset < bitmap.length; offset += 4) {
      expect([...bitmap.subarray(offset, offset + 3)]).toEqual([0, 0, 0])
    }
    expect(alpha(bitmap, 0, 0, scale)).toBe(0)
    expect(alpha(bitmap, 9, 10, scale)).toBe(0)
    expect(alpha(bitmap, 4, 5, scale)).toBe(255)
    expect(alpha(bitmap, 12, 5, scale)).toBe(77)
    expect(alpha(bitmap, 3, 13, scale)).toBe(255)
    expect(alpha(bitmap, 7, 13, scale)).toBe(77)
  })

  it.each([1, 2] as const)('renders two empty rounded tracks without data at scale %d', scale => {
    const bitmap = renderGaugeBitmap(null, null, scale, false)
    expect(alpha(bitmap, 8, 5, scale)).toBe(77)
    expect(alpha(bitmap, 8, 13, scale)).toBe(77)
    expect(alpha(bitmap, 1, 3, scale)).toBe(0)
    expect(Math.max(...bitmap)).toBe(77)
    expect(bitmap.equals(renderGaugeBitmap(0, 0, scale, false))).toBe(true)
  })

  it('keeps the session empty when only the weekly quota is available', () => {
    const bitmap = renderGaugeBitmap(null, 100, 1, false)
    expect(alpha(bitmap, 8, 5, 1)).toBe(77)
    expect(alpha(bitmap, 8, 13, 1)).toBe(255)
  })

  it.each([1, 2] as const)('dims every pixel to 35 percent at scale %d', scale => {
    const normal = renderGaugeBitmap(100, 50, scale, false)
    const dimmed = renderGaugeBitmap(100, 50, scale, true)
    for (let offset = 3; offset < normal.length; offset += 4) {
      expect(Math.abs(dimmed[offset] - normal[offset] * 0.35)).toBeLessThanOrEqual(1)
    }
    expect(alpha(dimmed, 8, 5, scale)).toBe(89)
    expect(alpha(dimmed, 12, 13, scale)).toBe(27)
  })

  it('shows near-full critical quotas and clamps utilization to the track', () => {
    const critical = renderGaugeBitmap(90, 100, 1, false)
    expect(alpha(critical, 12, 5, 1)).toBe(255)
    expect(alpha(critical, 15, 13, 1)).toBe(255)
    expect(renderGaugeBitmap(-10, 120, 1, false).equals(renderGaugeBitmap(0, 100, 1, false))).toBe(true)
  })
})
