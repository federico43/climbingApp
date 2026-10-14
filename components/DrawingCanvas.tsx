import { Stroke } from "@/services/videoStorage"
import { Image } from "expo-image"
import { ReactNode, useEffect, useRef, useState } from "react"
import { StyleSheet, View, ViewStyle } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Svg, { Path } from "react-native-svg"

function pathD(points: { x: number; y: number }[], w: number, h: number): string {
  if (points.length === 0) return ""
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * w} ${p.y * h}`).join(" ")
}

interface Props {
  // A static photo backdrop. Omit and pass `children` instead to draw over a
  // live video (e.g. a VideoView) — the aspect-fit math below is identical
  // either way.
  imageUri?: string
  children?: ReactNode
  naturalSize?: { w: number; h: number } | null
  strokes: Stroke[]
  onStrokesChange?: (strokes: Stroke[]) => void
  color?: string
  editable?: boolean
  style?: ViewStyle
  // Purely diagnostic — tags this instance's geometry logging (see the
  // effect below) so two separate mounts of the same clip/aspect (e.g.
  // CoachFeedbackRecorder's "recording" canvas vs its "reviewing" one) can
  // be told apart in the 🐞 log overlay when comparing computed geometry.
  debugLabel?: string
}

// Freehand strokes drawn over either a static photo or a live video. Strokes
// are stored as fractional (0-1) coordinates relative to the backdrop so they
// redraw crisply regardless of the viewer's screen size — the same
// convention the spray-wall hold-placement feature uses for its markers.
export function DrawingCanvas({
  imageUri, children, naturalSize, strokes, onStrokesChange, color = "#FF3B30", editable = true, style, debugLabel,
}: Props) {
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [liveStroke, setLiveStroke] = useState<{ x: number; y: number }[] | null>(null)
  // Mirrors liveStroke so onEnd can read the finished stroke synchronously —
  // calling onStrokesChange (which sets state in the parent) from inside a
  // setLiveStroke updater is a React violation ("update during render" of a
  // different component); reading a ref instead sidesteps that entirely.
  const liveStrokeRef = useRef<{ x: number; y: number }[] | null>(null)

  const aspect = naturalSize && naturalSize.h > 0 ? naturalSize.w / naturalSize.h : 16 / 9
  let imgW = containerSize.w
  let imgH = imgW / aspect
  if (imgH > containerSize.h && containerSize.h > 0) {
    imgH = containerSize.h
    imgW = imgH * aspect
  }
  const imgLeft = (containerSize.w - imgW) / 2
  const imgTop = (containerSize.h - imgH) / 2

  // Diagnostic only — see debugLabel above. Logs whenever the computed
  // geometry actually changes, so two instances that are supposed to be
  // laid out identically (same aspect, same absolute-fill container) can be
  // diffed directly instead of assumed equal from reading the code.
  useEffect(() => {
    if (!debugLabel) return
    console.log(
      `[feedback] DrawingCanvas[${debugLabel}] container=${containerSize.w}x${containerSize.h}`,
      `naturalSize=${naturalSize?.w}x${naturalSize?.h} aspect=${aspect.toFixed(4)}`,
      `img=${imgW.toFixed(2)}x${imgH.toFixed(2)} at (${imgLeft.toFixed(2)},${imgTop.toFixed(2)})`
    )
  }, [debugLabel, containerSize.w, containerSize.h, naturalSize?.w, naturalSize?.h, aspect, imgW, imgH, imgLeft, imgTop])

  // x/y here are already local to the gesture-attached box below, so no
  // offset subtraction is needed — just normalize to 0-1.
  function toFraction(x: number, y: number) {
    if (imgW <= 0 || imgH <= 0) return null
    return { x: Math.min(1, Math.max(0, x / imgW)), y: Math.min(1, Math.max(0, y / imgH)) }
  }

  const pan = Gesture.Pan()
    .enabled(editable)
    .minDistance(0)
    .runOnJS(true)
    .onBegin((e) => {
      const p = toFraction(e.x, e.y)
      if (p) {
        liveStrokeRef.current = [p]
        setLiveStroke(liveStrokeRef.current)
      }
    })
    .onUpdate((e) => {
      const p = toFraction(e.x, e.y)
      if (p) {
        liveStrokeRef.current = liveStrokeRef.current ? [...liveStrokeRef.current, p] : [p]
        setLiveStroke(liveStrokeRef.current)
      }
    })
    .onEnd(() => {
      const finished = liveStrokeRef.current
      if (finished && finished.length > 1 && onStrokesChange) {
        onStrokesChange([...strokes, { color, points: finished }])
      }
      liveStrokeRef.current = null
      setLiveStroke(null)
    })

  return (
    <View
      style={[styles.container, style]}
      onLayout={(e) => setContainerSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {imgW > 0 && (
        <GestureDetector gesture={pan}>
          <View style={{ position: "absolute", left: imgLeft, top: imgTop, width: imgW, height: imgH }}>
            {imageUri ? <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="fill" /> : children}
            <Svg style={StyleSheet.absoluteFill} width={imgW} height={imgH}>
              {strokes.map((s, i) => (
                <Path
                  key={i}
                  d={pathD(s.points, imgW, imgH)}
                  stroke={s.color}
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {liveStroke && (
                <Path
                  d={pathD(liveStroke, imgW, imgH)}
                  stroke={color}
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </Svg>
          </View>
        </GestureDetector>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
})
