// Hold radius normalization.
//
// Legacy holds store `radius` as an absolute pixel value sized for the screen
// they were placed on — so a route built on a wide desktop browser renders
// with proportionally huge circles on a phone. New holds store `radius` as a
// fraction of the displayed image width (0–1).
//
// At render time we accept BOTH formats and return the current pixel size:
//   - `radius <= 1` → treat as fraction, return `radius * imgW`
//   - `radius >  1` → treat as legacy pixels at the reference width below

export const LEGACY_REFERENCE_WIDTH = 400

export function getDisplayRadius(hold: { radius: number }, imgW: number): number {
  if (!imgW || imgW <= 0) return Math.max(2, hold.radius)
  if (hold.radius <= 1) {
    return hold.radius * imgW
  }
  return (hold.radius / LEGACY_REFERENCE_WIDTH) * imgW
}

// Convert a pixel radius (e.g. from a slider) into a fraction for storage.
export function pixelsToFractionRadius(pixels: number, imgW: number): number {
  if (!imgW || imgW <= 0) return 0.05
  return pixels / imgW
}
