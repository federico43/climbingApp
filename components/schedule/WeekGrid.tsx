import { CLASS_HOURS, GRID_END, GRID_START, formatTime } from "@/utils/classSchedule"
import { K as C, KF } from "@/components/schedule/calTheme"
import * as Haptics from "expo-haptics"
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
// RefreshControl from gesture-handler: the react-native one never fires inside its ScrollView.
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { Gesture, GestureDetector, RefreshControl, ScrollView } from "react-native-gesture-handler"

// The smallest hour row; rows grow to fill the screen when there's room.
// Screens read taps on this scale (see onPressTime).
export const HOUR_HEIGHT = 46
const HANDLE = 14 // height of the resize handles on a block's edges
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i)
const LETTERS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
// Tablets and landscape: wider columns get bigger text and the full time.
export const BIG_SCREEN = 700
const Big = createContext(false)

// "7 AM", "12 PM", "6 PM" (Google Calendar's gutter).
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`

// Hours from midnight now, updated every minute (the mint "now" line).
function useNowHours(): number {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])
  return now.getHours() + now.getMinutes() / 60
}

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
  const big = useWindowDimensions().width >= BIG_SCREEN
  const nowH = useNowHours()
  const refresh = onRefresh && (async () => {
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  })
  return (
    <View style={{ flex: 1 }}>
      <View style={s.heads}>
        <View style={[s.gutter, big && { width: 52 }]} />
        {dates.map((d, i) => {
          const isToday = i === today
          const off = offDays.includes(i)
          return (
            <Pressable key={i} style={s.head} disabled={!onPressDay} onPress={() => onPressDay?.(i)}>
              <Text style={[s.letter, big && { fontSize: 12 }, isToday && { color: C.green }]}>{big ? LETTERS[i] : LETTERS[i][0]}</Text>
              <View style={[s.num, big && s.numBig, isToday && s.numToday]}>
                <Text style={[s.numText, big && { fontSize: 22 }, dimPast && i < today && { color: C.past }, isToday && s.numTextToday, off && s.numOff]}>{d.getDate()}</Text>
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
          <View style={[s.gutter, big && { width: 52 }]}>
            {HOURS.slice(1).map((h) => (
              <Text key={h} style={[s.hour, big && { fontSize: 12 }, { top: (h - GRID_START) * hh - 7 }]}>{hourLabel(h)}</Text>
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
                  <Big.Provider value={big}>
                    <ColumnDay.Provider value={day}>{renderDay(day)}</ColumnDay.Provider>
                  </Big.Provider>
                </HourHeight.Provider>
              </DragDay.Provider>
              {/* Google-Calendar "now" line across today. */}
              {day === today && nowH > GRID_START && nowH < GRID_END && (
                <View pointerEvents="none" style={[s.now, { top: (nowH - GRID_START) * hh }]}>
                  <View style={s.nowDot} />
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

export type Tone = "mine" | "open" | "other" | "full" | "pending" | "skip" | "pick" | "new" | "blocked"

// Diagonal hatch (full classes, blocked time): thin rotated lines, clipped.
function Hatch({ strong }: { strong?: boolean }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      {Array.from({ length: 24 }, (_, i) => (
        <View
          key={i}
          style={{
            position: "absolute", top: -40, left: i * 9 - 60, width: 4, height: 600,
            backgroundColor: strong ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.04)",
            transform: [{ rotate: "45deg" }],
          }}
        />
      ))}
    </View>
  )
}

// Seat dots: one per spot, filled when taken.
function Seats({ booked, cap, tone }: { booked: number; cap: number; tone: Tone }) {
  const on = tone === "mine" || tone === "new" ? C.onMint : C.textPrimary
  return (
    <View style={s.seats}>
      {Array.from({ length: cap }, (_, i) => (
        <View key={i} style={[s.seat, { borderColor: on }, i < booked && { backgroundColor: on }]} />
      ))}
    </View>
  )
}

// What a block says: a bold first line (the time), then one line per name
// or note. Old callers pass `text` with "\n" between lines.
function BlockText({ text, tone, hours, seats }: { text: string; tone: Tone; hours: number; seats?: { booked: number; cap: number } }) {
  const big = useContext(Big)
  const hh = useContext(HourHeight)
  const [first, ...rest] = text.split("\n")
  const size = big ? 13 : 10
  const lineH = size + 3
  // As many lines as fit in the block.
  const room = Math.max(0, Math.floor((hours * hh - 8 - (seats ? 10 : 0)) / lineH) - 1)
  return (
    <>
      {(tone === "full" || tone === "blocked") && <Hatch strong={tone === "full"} />}
      <Text numberOfLines={1} style={[s.blockTitle, { fontSize: size + 1, lineHeight: lineH + 1 }, toneText[tone]]}>{first}</Text>
      {seats && <Seats {...seats} tone={tone} />}
      {rest.slice(0, room).map((l, i) => (
        <Text key={i} numberOfLines={1} style={[s.blockText, { fontSize: size - 1, lineHeight: lineH }, toneText[tone], l.startsWith("·") && s.blockNote]}>
          {l.replace(/^·/, "")}
        </Text>
      ))}
    </>
  )
}

// A block on the grid, from `start` for `hours`. With `onDrop` it can be
// long-pressed and dragged; it reports how many days and hours it moved,
// snapped to the half hour. With `onResize` it also gets handles on its top
// and bottom edges to make it longer or shorter.
export function GridBlock({
  start,
  hours = CLASS_HOURS,
  tone,
  text,
  label,
  tag,
  seats,
  faded,
  onPress,
  onDrop,
  onResize,
}: {
  start: number
  hours?: number
  tone: Tone
  text: string
  label?: string                         // screen readers: the whole block in words
  tag?: string                           // small mint pill top-right, e.g. "1 req"
  seats?: { booked: number; cap: number } // seat dots under the title
  faded?: boolean                        // not a choice right now (move mode)
  onPress?: () => void
  onDrop?: (days: number, hours: number) => void
  onResize?: (start: number, end: number) => void
}) {
  const hh = useContext(HourHeight)
  const extras = (
    <>
      {tag ? <View style={s.tag}><Text style={s.tagText}>{tag}</Text></View> : null}
    </>
  )
  if (onDrop) {
    return (
      <DraggableBlock start={start} hours={hours} tone={tone} text={text} seats={seats} label={label} onPress={onPress} onDrop={onDrop} onResize={onResize}>
        {extras}
      </DraggableBlock>
    )
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      // Without an action, taps go through to the day column (e.g. to pick a time).
      pointerEvents={onPress ? "auto" : "none"}
      style={({ pressed }) => [
        s.block, tones[tone], { top: (start - GRID_START) * hh + 1, height: hours * hh - 3 },
        faded && { opacity: 0.25 }, pressed && { opacity: 0.75 },
      ]}
    >
      <BlockText text={text} tone={tone} hours={hours} seats={seats} />
      {extras}
    </Pressable>
  )
}

export const blockTime = (start: number) => formatTime(start)

function DraggableBlock({
  start, hours, tone, text, seats, label, children, onPress, onDrop, onResize,
}: {
  start: number
  hours: number
  tone: Tone
  text: string
  seats?: { booked: number; cap: number }
  label?: string
  children?: React.ReactNode
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
          accessible
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[
            s.block, tones[tone], { top, height },
            onResize && { paddingTop: 12 },
            (drag || resize) && s.dragging,
            drag && { transform: [{ translateX: drag.days * colWidth.current }, { translateY: drag.hours * hh }] },
          ]}
        >
          <BlockText
            tone={tone}
            hours={shownHours}
            seats={drag || resize ? undefined : seats}
            text={drag ? formatTime(start + drag.hours) : resize ? `${formatTime(resize.start)}\n${formatTime(resize.end)}` : text}
          />
          {!drag && !resize && children}
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

// Event states (spec §5.2): never colour alone, each also says what it is.
const tones = StyleSheet.create({
  mine: { backgroundColor: C.green },
  open: { backgroundColor: C.openBg, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  other: { backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border },
  full: { backgroundColor: "#1B1821", borderWidth: 1, borderColor: C.border },
  pending: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.green, borderStyle: "dashed" },
  skip: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.textMuted, borderStyle: "dashed" },
  pick: { backgroundColor: C.openBg, borderWidth: 2, borderColor: C.green, borderStyle: "dashed" },
  new: { backgroundColor: C.green, borderWidth: 2, borderColor: C.textPrimary },
  blocked: { backgroundColor: "#141118", borderWidth: 1, borderColor: C.border },
})
const toneText = StyleSheet.create({
  mine: { color: C.onMint },
  open: { color: C.textPrimary },
  other: { color: C.textSecondary },
  full: { color: C.textMuted },
  pending: { color: C.green },
  skip: { color: C.textMuted, textDecorationLine: "line-through" },
  pick: { color: C.textPrimary },
  new: { color: C.onMint },
  blocked: { color: C.textMuted },
})

const s = StyleSheet.create({
  // Left padding: thick screen-protector rims cover the screen's very edge.
  heads: { flexDirection: "row", paddingLeft: 12, paddingRight: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  gutter: { width: 34 },
  head: { flex: 1, alignItems: "center", gap: 2 },
  letter: { fontFamily: KF.mono, fontSize: 10.5, color: C.label, letterSpacing: 0.6 },
  num: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  numBig: { width: 40, height: 40, borderRadius: 20 },
  numToday: { backgroundColor: C.green },
  numText: { fontFamily: KF.title, fontSize: 18, color: C.textPrimary, fontVariant: ["tabular-nums"] },
  numTextToday: { color: C.onMint },
  numOff: { textDecorationLine: "line-through", color: C.textMuted },
  body: { flexDirection: "row", paddingLeft: 12, paddingRight: 6 },
  hour: { position: "absolute", right: 4, fontFamily: KF.mono, fontSize: 8.5, color: C.textMuted },
  col: { flex: 1, borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.05)" },
  line: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.07)" },
  now: { position: "absolute", left: -1, right: 0, height: 2, backgroundColor: C.green, zIndex: 20 },
  nowDot: { position: "absolute", left: -5, top: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: C.green },
  seats: { flexDirection: "row", gap: 3, marginTop: 2, marginBottom: 1 },
  seat: { width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
  tag: { position: "absolute", top: 2, right: 2, backgroundColor: C.green, borderRadius: 6, paddingHorizontal: 3, paddingVertical: 1 },
  tagText: { fontFamily: KF.mono, fontSize: 8.5, color: C.onMint },
  block: { position: "absolute", left: 1, right: 2, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 3, overflow: "hidden" },
  handle: { position: "absolute", left: 1, right: 1, height: HANDLE, alignItems: "center", justifyContent: "center" },
  grip: { width: 16, height: 3, borderRadius: 2, backgroundColor: C.textMuted },
  dragging: { opacity: 0.9, borderWidth: 2, borderColor: C.green, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  blockTitle: { fontFamily: KF.bold },
  blockText: { fontFamily: KF.body },
  blockNote: { opacity: 0.75, fontStyle: "italic" },
})
