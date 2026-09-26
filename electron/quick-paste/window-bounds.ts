import type { Bounds } from '../window-position'

// Quick paste window: centered on the usable area of the display (where the mouse is), never larger
// than it
export function getQuickPasteWindowBounds(workArea: Bounds, size: { width: number; height: number }): Bounds {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  }
}
