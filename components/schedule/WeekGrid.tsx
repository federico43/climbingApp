import { CLASS_HOURS, GRID_END, GRID_START, formatTime } from "@/utils/classSchedule"
import { C } from "@/utils/theme"
import * as Haptics from "expo-haptics"
import React, { createContext, useContext, useMemo, useRef, useState } from "react"
// RefreshControl from gesture-handler: the react-native one never fires inside its ScrollView.
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Gesture, GestureDetector, RefreshControl, ScrollView } from "react-native-gesture-handler"

// The smallest hour row; rows grow to fill the screen when there's room.
// Screens read taps on this scale (see onPressTime).
export const HOUR_HEIGHT = 46
const HANDLE = 14 // height of the resize handles on a block's edges
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i)
const LETTERS = ["M", "T", "W", "T", "F", "S", "S"]

// The day column whose block is being dragged, raised so the block shows
// above the columns to its right.
const DragDay = createContext<(day: number | null) => void>(() => {})
const ColumnDay = createContext(0)
const HourHeight = createContext(HOUR_HEIGHT)

// One week, Google-Calendar style: 7 day columns, 6:00 to 20:00.
export function WeekGrid({
  dates,
  today = -1,
  dimPast = false,
  offDays = [],
  dimDays = [],
  onPressDay,
  onPressTime,
  onRefresh,
  renderDay,
}: {
  dates: Date[]
  today?: number                  // highlighted day, -1 for none
  dimPast?: boolean               // fade the days before `today`
  offDays?: number[]              // struck-through day numbers (blocked days)
  dimDays?: number[]              // faded days (e.g. ones the athlete can't pick)
  onPressDay?: (day: number) => void
  onPressTime?: (day: number, y: number) => void   // y on the HOUR_HEIGHT scale
  onRefresh?: () => Promise<unknown>               // pull down to reload
  renderDay: (day: number) => React.ReactNode
}) {
  const [dragDay, setDragDay] = useState<number | null>(null)
  const [hh, setHh] = useState(HOUR_HEIGHT)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = onRefresh && (async () => {
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  })
  return (
    <View style={{ flex: 1 }}>
      <View style={s.heads}>
        <View style={s.gutter} />
        {dates.map((d, i) => {
          const isToday = i === today
          const off = offDays.includes(i)
          return (
            <Pressable key={i} style={s.head} disabled={!onPressDay} onPress={() => onPressDay?.(i)}>
              <Text style={[s.letter, isToday && { color: C.green }]}>{LETTERS[i]}</Text>
              <View style={[s.num, isToday && s.numToday]}>
                <Text style={[s.numText, isToday && s.numTextToday, off && s.numOff]}>{d.getDate()}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={dragDay === null}
        onLayout={(e) => setHh(Math.max(HOUR_HEIGHT, Math.floor(e.nativeEvent.layout.height / HOURS.length)))}
        refreshControl={refresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.green} /> : undefined}
      >
        <View style={[s.body, { height: HOURS.length * hh }]}>
          <View style={s.gutter}>
            {HOURS.slice(1).map((h) => (
              <Text key={h} style={[s.hour, { top: (h - GRID_START) * hh - 6 }]}>{h}:00</Text>
            ))}
          </View>
          {dates.map((_, day) => (
            <Pressable
              key={day}
              style={[s.col, ((dimPast && day < today) || dimDays.includes(day)) && { opacity: 0.45 }, dragDay === day && { zIndex: 10 }]}
              disabled={!onPressTime}
              onPress={(e) => onPressTime?.(day, (e.nativeEvent.locationY * HOUR_HEIGHT) / hh)}
            >
              {HOURS.map((h) => (
                <View key={h} pointerEvents="none" style={[s.line, { top: (h - GRID_START) * hh }]} />
              ))}
              <DragDay.Provider value={setDragDay}>
                <HourHeight.Provider value={hh}>
                  <ColumnDay.Provider value={day}>{renderDay(day)}</ColumnDay.Provider>
                </HourHeight.Provider>
              </DragDay.Provider>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

type Tone = "mine" | "other" | "full" | "pending" | "skip" | "pick" | "blocked"

// A block on the grid, from `start` for `hours`. With `onDrop` it can be
// long-pressed and dragged; it reports how many days and hours it moved,
// snapped to the half hour. With `onResize` it also gets handles on its top
// and bottom edges to make it longer or shorter.
export function GridBlock({
  start,
  hours = CLASS_HOURS,
  tone,
  text,
  onPress,
  onDrop,
  onResize,
}: {
  start: number
  hours?: number
  tone: Tone
  text: string
  onPress?: () => void
  onDrop?: (days: number, hours: number) => void
  onResize?: (start: number, end: number) => void
}) {
  const hh = useContext(HourHeight)
  if (onDrop) return <DraggableBlock start={start} hours={hours} tone={tone} text={text} onPress={onPress} onDrop={onDrop} onResize={onResize} />
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      // Without an action, taps go through to the day column (e.g. to pick a time).
      pointerEvents={onPress ? "auto" : "none"}
      style={[s.block, tones[tone], { top: (start - GRID_START) * hh + 1, height: hours * hh - 3 }]}
    >
      <Text style={[s.blockText, toneText[tone]]}>{text}</Text>
    </Pressable>
  )
}

export const blockTime = (start: number) => formatTime(start)

function DraggableBlock({
  start, hours, tone, text, onPress, onDrop, onResize,
}: {
  start: number
  hours: number
  tone: Tone
  text: string
  onPress?: () => void
  onDrop: (days: number, hours: number) => void
  onResize?: (start: number, end: number) => void
}) {
  const setDragDay = useContext(DragDay)
  const day = useContext(ColumnDay)
  const hh = useContext(HourHeight)
  const colWidth = useRef(0)
  const [drag, setDrag] = useState<{ days: number; hours: number } | null>(null)
  const [resize, setResize] = useState<{ start: number; end: number } | null>(null)
  // The grid re-renders while dragging (new callbacks each time); keep the
  // same gesture so the drag isn't cut off.
  const handlers = useRef({ onPress, onDrop, onResize })
  handlers.current = { onPress, onDrop, onResize }

  // Snapped to whole days and half hours, kept inside the grid.
  const snap = (dx: number, dy: number) => ({
    days: Math.max(-day, Math.min(6 - day, colWidth.current ? Math.round(dx / colWidth.current) : 0)),
    hours: Math.max(GRID_START - start, Math.min(GRID_END - hours - start, Math.round(dy / (hh / 2)) / 2)),
  })

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activateAfterLongPress(300)
      .onStart(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
        setDragDay(day)
        setDrag({ days: 0, hours: 0 })
      })
      .onUpdate((e) => {
        const next = snap(e.translationX, e.translationY)
        setDrag((d) => (d && d.days === next.days && d.hours === next.hours ? d : next))
      })
      .onEnd((e) => {
        const moved = snap(e.translationX, e.translationY)
        // Reset first: an alert from onDrop can swallow onFinalize.
        setDrag(null)
        setDragDay(null)
        if (moved.days || moved.hours) handlers.current.onDrop(moved.days, moved.hours)
      })
      .onFinalize(() => {
        setDrag(null)
        setDragDay(null)
      })
    const tap = Gesture.Tap().runOnJS(true).onEnd((_e, ok) => { if (ok) handlers.current.onPress?.() })

    // Edge handles: drag right away (no long press), half an hour at a time,
    // at least half an hour long and inside the grid.
    const end = start + hours
    const edge = (which: "top" | "bottom") => {
      const span = (dy: number) => {
        const d = Math.round(dy / (hh / 2)) / 2
        return which === "top"
          ? { start: Math.max(GRID_START, Math.min(end - 0.5, start + d)), end }
          : { start, end: Math.min(GRID_END, Math.max(start + 0.5, end + d)) }
      }
      return Gesture.Pan()
        .runOnJS(true)
        .minDistance(1)
        .onStart(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
          setDragDay(day)
          setResize({ start, end })
        })
        .onUpdate((e) => {
          const next = span(e.translationY)
          setResize((r) => {
            if (r && r.start === next.start && r.end === next.end) return r
            Haptics.selectionAsync().catch(() => {})
            return next
          })
        })
        .onEnd((e) => {
          const next = span(e.translationY)
          setResize(null)
          setDragDay(null)
          if (next.start !== start || next.end !== end) handlers.current.onResize?.(next.start, next.end)
        })
        .onFinalize(() => {
          setResize(null)
          setDragDay(null)
        })
    }
    const top = edge("top")
    const bottom = edge("bottom")
    return { block: Gesture.Exclusive(pan, tap), top, bottom }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, start, hours, hh])

  const shownStart = resize?.start ?? start
  const shownHours = resize ? resize.end - resize.start : hours
  const top = (shownStart - GRID_START) * hh + 1
  const height = shownHours * hh - 3

  return (
    <>
      <GestureDetector gesture={gesture.block}>
        <View
          onLayout={(e) => { colWidth.current = e.nativeEvent.layout.width + 2 }}
          // Keep the tap from also reaching the day column underneath.
          onStartShouldSetResponder={() => true}
          style={[
            s.block, tones[tone], { top, height },
            onResize && { paddingTop: 12 },
            (drag || resize) && s.dragging,
            drag && { transform: [{ translateX: drag.days * colWidth.current }, { translateY: drag.hours * hh }] },
          ]}
        >
          <Text style={[s.blockText, toneText[tone]]}>
            {drag ? formatTime(start + drag.hours) : resize ? `${formatTime(resize.start)}\n${formatTime(resize.end)}` : text}
          </Text>
        </View>
      </GestureDetector>
      {/* Siblings on top of the block, not inside it, so a touch on an edge
          never reaches the block's own move and tap gestures. */}
      {onResize && !drag && (
        <>
          <GestureDetector gesture={gesture.top}>
            <View style={[s.handle, { top }]}><View style={s.grip} /></View>
          </GestureDetector>
          <GestureDetector gesture={gesture.bottom}>
            <View style={[s.handle, { top: top + height - HANDLE }]}><View style={s.grip} /></View>
          </GestureDetector>
        </>
      )}
    </>
  )
}

const tones = StyleSheet.create({
  mine: { backgroundColor: C.green },
  other: { backgroundColor: "#2F3A35" },
  full: { backgroundColor: "#26282A" },
  pending: { backgroundColor: C.yellow },
  skip: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border },
  pick: { backgroundColor: "#2F3A35", borderWidth: 2, borderColor: C.yellow },
  blocked: { backgroundColor: "#202224", borderWidth: 1, borderColor: C.border, borderStyle: "dashed" },
})
const toneText = StyleSheet.create({
  mine: { color: "#10251A" },
  other: { color: C.textSecondary },
  full: { color: C.textMuted },
  pending: { color: "#3A2E00" },
  skip: { color: C.textMuted, textDecorationLine: "line-through" },
  pick: { color: C.textPrimary },
  blocked: { color: C.textMuted },
})

const s = StyleSheet.create({
  heads: { flexDirection: "row", paddingRight: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  gutter: { width: 30 },
  head: { flex: 1, alignItems: "center", gap: 2 },
  letter: { fontSize: 11, fontWeight: "700", color: C.textSecondary },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  numToday: { backgroundColor: C.green },
  numText: { fontSize: 17, fontWeight: "500", color: C.textSecondary, fontVariant: ["tabular-nums"] },
  numTextToday: { color: "#10251A", fontWeight: "800" },
  numOff: { textDecorationLine: "line-through", color: C.textMuted },
  body: { flexDirection: "row", paddingRight: 6 },
  hour: { position: "absolute", right: 3, fontSize: 9, color: C.textMuted, fontVariant: ["tabular-nums"] },
  col: { flex: 1, borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.05)" },
  line: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.05)" },
  block: { position: "absolute", left: 1, right: 1, borderRadius: 5, padding: 3, overflow: "hidden" },
  handle: { position: "absolute", left: 1, right: 1, height: HANDLE, alignItems: "center", justifyContent: "center" },
  grip: { width: 16, height: 3, borderRadius: 2, backgroundColor: C.textMuted },
  dragging: { opacity: 0.9, borderWidth: 2, borderColor: C.green, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  blockText: { fontSize: 9, fontWeight: "700", lineHeight: 11 },
})
