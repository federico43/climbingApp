import { useAuth } from "@/components/auth-context"
import { ScreenGradient } from "@/components/ScreenGradient"
import { Sheet, SheetButton, SheetOption } from "@/components/schedule/Sheet"
import { FeatureIntro } from "@/components/schedule/FeatureIntro"
import { GridBlock, HOUR_HEIGHT, WeekGrid } from "@/components/schedule/WeekGrid"
import { SettingsButton } from "@/components/SettingsButton"
import {
  AddClassProblem, BlockedTime, CAPACITY, CLASS_HOURS, GRID_END, GRID_START, MAX_CLASSES_PER_DAY, WEEK_DAYS,
  addClassProblem, formatTime, mondayOf, startFromOffset, weekDates,
} from "@/utils/classSchedule"
import {
  addNextClass, answerRequest, blockDay, blockTime, moveBlock, moveNextClass, pendingRequests, publishWeek, removeNextClass, unblock,
  unblockDay, useClassSchedule,
} from "@/utils/classScheduleStore"
import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { useMemo, useState } from "react"
import { Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const PROBLEM: Record<AddClassProblem, string> = {
  max: `This day already has ${MAX_CLASSES_PER_DAY} classes`,
  overlap: "Overlaps another class",
  blocked: "You blocked this time",
  late: `Classes end by ${GRID_END}:00`,
}

type SheetState =
  | { kind: "slot"; day: number; start: number }
  | { kind: "day"; day: number }
  | { kind: "class"; id: string }
  | { kind: "block"; block: BlockedTime }
  | { kind: "requests" }
  | null

// Coach tab: plan next week's classes (max 2 a day), block the times you
// can't teach, answer athletes' requests. UI only for now: example data.
export default function ClassesScreen() {
  const { userName } = useAuth()
  const st = useClassSchedule()
  const dates = useMemo(() => {
    const monday = mondayOf(new Date())
    monday.setDate(monday.getDate() + 7)
    return weekDates(monday)
  }, [])
  const [sheet, setSheet] = useState<SheetState>(null)
  const requests = pendingRequests(st, userName || "athlete")
  const dayBlocked = (d: number) => st.blocks.some((b) => b.day === d && b.all)
  const range = `${MONTHS[dates[0].getMonth()]} ${dates[0].getDate()} – ${MONTHS[dates[6].getMonth()]} ${dates[6].getDate()}`
  const dayName = (d: number) => `${WEEK_DAYS[d]} ${dates[d].getDate()}`

  const renderDay = (day: number) => {
    if (dayBlocked(day)) {
      return <GridBlock start={GRID_START} hours={GRID_END - GRID_START} tone="blocked" text="Blocked" onPress={() => setSheet({ kind: "day", day })} />
    }
    return (
      <>
        {st.blocks.filter((b) => b.day === day).map((b, i) => (
          <GridBlock
            key={`b${i}`}
            start={b.start}
            hours={b.end - b.start}
            tone="blocked"
            text="Blocked"
            onPress={() => setSheet({ kind: "block", block: b })}
            onDrop={(days, hours) => {
              const to = clampDay(b.day + days)
              const start = Math.max(GRID_START, Math.min(GRID_END - (b.end - b.start), b.start + hours))
              const problem = moveBlock(b, to, start)
              if (problem) Alert.alert("Can't move it there", problem === "class" ? "There's a class at that time." : "That day is blocked.")
            }}
          />
        ))}
        {st.nextClasses.filter((c) => c.day === day).map((c) => (
          <GridBlock
            key={c.id}
            start={c.start}
            tone="other"
            text={`${formatTime(c.start)}\n${c.roster.length}/${CAPACITY}`}
            onPress={() => setSheet({ kind: "class", id: c.id })}
            onDrop={(days, hours) => {
              const start = Math.max(GRID_START, Math.min(GRID_END - CLASS_HOURS, c.start + hours))
              const problem = moveNextClass(c.id, clampDay(c.day + days), start)
              if (problem) Alert.alert("Can't move it there", PROBLEM[problem])
            }}
          />
        ))}
      </>
    )
  }

  const slot = sheet?.kind === "slot" ? sheet : null
  const slotProblem = slot ? addClassProblem(st.nextClasses, st.blocks, slot.day, slot.start) : null
  // A class already sits in (part of) this time: remove it before blocking.
  const slotHasClass = !!slot && st.nextClasses.some((c) => c.day === slot.day && c.start < slot.start + CLASS_HOURS && slot.start < c.start + CLASS_HOURS)
  const dayS = sheet?.kind === "day" ? sheet : null
  const cls = sheet?.kind === "class" ? st.nextClasses.find((c) => c.id === sheet.id) ?? null : null

  return (
    <ScreenGradient>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <FeatureIntro
          id="coach-classes"
          pages={[
            { icon: "calendar", title: "Plan next week", text: `Tap a free time to add a 2h 30m class. Hold a class and drag it to move it. Up to ${MAX_CLASSES_PER_DAY} classes a day. Every Saturday we remind you to do it.` },
            { icon: "ban", title: "Block what you can't teach", text: "Tap a time to block it, or tap a day at the top to block all of it. Hold a blocked time to drag it. Athletes can't propose times there." },
            { icon: "chatbubbles", title: "Answer requests", text: "Athletes ask to move, propose a time or add an extra class. Requests you don't answer before the class are declined." },
            { icon: "send", title: "Publish the week", text: "When it looks right, publish it and your athletes get a notification to confirm their classes." },
          ]}
        />
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Next week</Text>
            <Text style={s.subtitle}>{range} · max {MAX_CLASSES_PER_DAY} classes a day</Text>
          </View>
          <SettingsButton />
        </View>
        <View style={s.top}>
          {requests.length > 0 && (
            <Pressable style={s.requests} onPress={() => setSheet({ kind: "requests" })}>
              <Text style={s.requestsText}>
                {requests.length} request{requests.length > 1 ? "s" : ""} waiting
              </Text>
              <Ionicons name="chevron-forward" size={16} color={C.yellow} />
            </Pressable>
          )}
        </View>
        <WeekGrid
          dates={dates}
          offDays={DAYS.filter(dayBlocked)}
          onPressDay={(day) => setSheet({ kind: "day", day })}
          onPressTime={(day, y) => {
            if (dayBlocked(day)) return setSheet({ kind: "day", day })
            setSheet({ kind: "slot", day, start: startFromOffset(y, HOUR_HEIGHT) })
          }}
          renderDay={renderDay}
        />
        <View style={s.footer}>
          <SheetButton
            label={st.published ? "Published · athletes notified" : "Publish week"}
            disabled={st.published}
            onPress={publishWeek}
          />
        </View>
      </SafeAreaView>

      <Sheet
        visible={!!slot}
        title={slot ? `${dayName(slot.day)} · ${formatTime(slot.start)} – ${formatTime(slot.start + CLASS_HOURS)}` : ""}
        onClose={() => setSheet(null)}
      >
        {slot && (
          <>
            <SheetOption
              title="Add a class"
              detail={slotProblem ? PROBLEM[slotProblem] : "Athletes can sign up for it"}
              disabled={!!slotProblem}
              onPress={() => { addNextClass(slot.day, slot.start); setSheet(null) }}
            />
            <SheetOption
              title="Block this time"
              detail={slotHasClass ? "Remove the class here first" : "No classes or proposals here"}
              disabled={slotHasClass}
              onPress={() => { blockTime(slot.day, slot.start); setSheet(null) }}
            />
          </>
        )}
      </Sheet>

      <Sheet visible={!!dayS} title={dayS ? dayName(dayS.day) : ""} onClose={() => setSheet(null)}>
        {dayS && dayBlocked(dayS.day) ? (
          <SheetOption title="Unblock the day" onPress={() => { unblockDay(dayS.day); setSheet(null) }} />
        ) : dayS ? (
          <SheetOption
            title="Block the whole day"
            detail={st.nextClasses.some((c) => c.day === dayS.day) ? "Remove its classes first" : "No classes or proposals this day"}
            disabled={st.nextClasses.some((c) => c.day === dayS.day)}
            onPress={() => { blockDay(dayS.day); setSheet(null) }}
          />
        ) : null}
      </Sheet>

      <Sheet
        visible={sheet?.kind === "block"}
        title="Blocked time"
        subtitle={sheet?.kind === "block" ? `${dayName(sheet.block.day)} · ${formatTime(sheet.block.start)} – ${formatTime(sheet.block.end)}` : ""}
        onClose={() => setSheet(null)}
      >
        <SheetButton kind="line" label="Unblock" onPress={() => { if (sheet?.kind === "block") unblock(sheet.block); setSheet(null) }} />
      </Sheet>

      <Sheet
        visible={!!cls}
        title={cls ? `${dayName(cls.day)} · ${formatTime(cls.start)} – ${formatTime(cls.start + CLASS_HOURS)}` : ""}
        subtitle={cls ? `${cls.roster.length} of ${CAPACITY} climbers` : ""}
        onClose={() => setSheet(null)}
      >
        {cls && (cls.roster.length
          ? <Text style={s.names}>{cls.roster.join(", ")}</Text>
          : <Text style={s.names}>No one yet.</Text>)}
        <SheetButton kind="red" label="Remove class" onPress={() => { if (cls) removeNextClass(cls.id); setSheet(null) }} />
        {cls && cls.roster.length > 0 && <Text style={s.hint}>Its athletes get a notification.</Text>}
      </Sheet>

      <Sheet
        visible={sheet?.kind === "requests"}
        title="Requests"
        subtitle="Declined on their own if you don't answer before the class."
        onClose={() => setSheet(null)}
      >
        {requests.map((r) => (
          <View key={r.key} style={s.req}>
            <View style={{ flex: 1 }}>
              <Text style={s.reqWho}>{r.who}</Text>
              <Text style={s.reqText}>{r.text}</Text>
            </View>
            <Pressable style={[s.reqBtn, s.reqNo]} onPress={() => answerRequest(r.key, false)}>
              <Text style={s.reqNoText}>Decline</Text>
            </Pressable>
            <Pressable style={[s.reqBtn, s.reqYes]} onPress={() => answerRequest(r.key, true)}>
              <Text style={s.reqYesText}>Accept</Text>
            </Pressable>
          </View>
        ))}
        {requests.length === 0 && <Text style={s.names}>All answered.</Text>}
      </Sheet>
    </ScreenGradient>
  )
}

const DAYS = [0, 1, 2, 3, 4, 5, 6]
const clampDay = (d: number) => Math.max(0, Math.min(6, d))

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 12 },
  title: { fontSize: 28, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontWeight: "500", color: C.textSecondary, marginTop: 2 },
  top: { paddingHorizontal: 16, gap: 8, marginBottom: 10 },
  requests: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(254,215,102,0.10)", borderWidth: 1, borderColor: "rgba(254,215,102,0.35)",
    borderRadius: 12, padding: 12,
  },
  requestsText: { color: C.yellow, fontSize: 14, fontWeight: "700" },
  footer: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  names: { fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  hint: { fontSize: 12, color: C.textSecondary, marginTop: -4 },
  req: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border },
  reqWho: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  reqText: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  reqBtn: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  reqNo: { borderWidth: 1, borderColor: C.border },
  reqYes: { backgroundColor: C.green },
  reqNoText: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  reqYesText: { fontSize: 13, fontWeight: "800", color: "#10251A" },
})
