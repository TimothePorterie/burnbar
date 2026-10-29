function contains(x: number, y: number, top: number, width: number, height: number): boolean {
  if (width <= 0 || x < 1 || x > 1 + width || y < top || y > top + height) return false
  const radius = Math.min(width, height) / 2
  const dx = x - Math.max(1 + radius, Math.min(x, 1 + width - radius))
  const dy = y - Math.max(top + radius, Math.min(y, top + height - radius))
  return dx * dx + dy * dy <= radius * radius
}

export function renderGaugeBitmap(
  fiveHour: number | null,
  sevenDay: number | null,
  scale: 1 | 2,
  dimmed: boolean
): Buffer {
  const size = 18 * scale
  const bitmap = Buffer.alloc(size * size * 4)
  const bars = [
    { top: 3, height: 6, value: fiveHour },
    { top: 12, height: 3, value: sevenDay }
  ]
  const samples = 4

  for (const bar of bars) {
    const fillWidth = 16 * Math.max(0, Math.min(100, bar.value ?? 0)) / 100
    for (let y = bar.top * scale; y < (bar.top + bar.height) * scale; y++) {
      for (let x = scale; x < 17 * scale; x++) {
        let alpha = 0
        for (let sy = 0; sy < samples; sy++) {
          for (let sx = 0; sx < samples; sx++) {
            const px = (x + (sx + 0.5) / samples) / scale
            const py = (y + (sy + 0.5) / samples) / scale
            if (contains(px, py, bar.top, 16, bar.height)) {
              alpha += contains(px, py, bar.top, fillWidth, bar.height) ? 255 : 77
            }
          }
        }
        bitmap[(y * size + x) * 4 + 3] = Math.round(alpha / (samples * samples) * (dimmed ? 0.35 : 1))
      }
    }
  }

  return bitmap
}
