import { useEffect, useState } from "react"
import { Image } from "react-native"

/**
 * Returns the natural pixel dimensions of an image source.
 * Works for both bundled assets (require()) and dynamic { uri } sources.
 */
export function useImageSize(imageSource: any): { nw: number; nh: number } {
  const [size, setSize] = useState<{ nw: number; nh: number }>(() => {
    // For bundled assets resolveAssetSource is synchronous — seed the state
    // immediately so the first layout pass already has correct dimensions.
    if (imageSource && typeof imageSource !== "object") {
      try {
        const a = Image.resolveAssetSource(imageSource)
        if (a?.width && a?.height) return { nw: a.width, nh: a.height }
      } catch {}
    } else if (imageSource && !imageSource.uri) {
      // require() returns a number or an object without a uri
      try {
        const a = Image.resolveAssetSource(imageSource)
        if (a?.width && a?.height) return { nw: a.width, nh: a.height }
      } catch {}
    }
    return { nw: 1, nh: 1 }
  })

  useEffect(() => {
    if (!imageSource) return

    const isUri = typeof imageSource === "object" && !!imageSource.uri

    if (isUri) {
      Image.getSize(
        imageSource.uri,
        (w, h) => setSize({ nw: w, nh: h }),
        () => setSize({ nw: 1, nh: 1 })
      )
    } else {
      try {
        const a = Image.resolveAssetSource(imageSource)
        if (a?.width && a?.height) setSize({ nw: a.width, nh: a.height })
      } catch {}
    }
  }, [imageSource?.uri ?? imageSource])

  return size
}
