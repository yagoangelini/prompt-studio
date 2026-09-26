export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

// Places the menu bar window next to the tray icon, on the side that faces the screen:
// below it for a menu bar at the top (macOS) and above it for a taskbar at the bottom
// (the Windows default). The result always fits inside the display's usable work area,
// which also covers side taskbars, icons near a screen edge and trays that report no position.
export const getMenuBarWindowBounds = (
  trayBounds: Bounds,
  workArea: Bounds,
  size: { width: number; height: number }
): Bounds => {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)

  const trayCenterX = trayBounds.x + trayBounds.width / 2
  const trayCenterY = trayBounds.y + trayBounds.height / 2
  const trayInTopHalf = trayCenterY < workArea.y + workArea.height / 2

  const x = trayCenterX - width / 2
  const y = trayInTopHalf ? trayBounds.y + trayBounds.height : trayBounds.y - height

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

  return {
    x: Math.round(clamp(x, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(y, workArea.y, workArea.y + workArea.height - height)),
    width,
    height,
  }
}
