import { useAuth } from "@/components/auth-context"
import { ScreenGradient } from "@/components/ScreenGradient"
import { Sheet, SheetButton, SheetOption } from "@/components/schedule/Sheet"
import { FeatureIntro } from "@/components/schedule/FeatureIntro"
import { GridBlock, HOUR_HEIGHT, WeekGrid } from "@/components/schedule/WeekGrid"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import {
  CAPACITY, CLASS_HOURS, GymClass, athleteWeek, busyDays, classLabel, formatTime, headcount,
  WEEK_DAYS, mondayOf, restDayOk, startFromOffset, weekDates, weekdayOf,
} from "@/utils/classSchedule"
import { cancelExtra, changeClass, requestExtra, useClassSchedule } from "@/utils/classScheduleStore"
import { C } from "@/utils/theme"
import { useMemo, useState } from "react"
import { Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

type Mode = { kind: "move" | "propose"; from: string } | null

// The athlete's week of classes, Google-Calendar style, opened from the
// "This week" card on Plan. UI only for now: example data, nothing saved.
export default function ScheduleScreen() {
  const { userName } = useAuth()
  const me = userName || "you"
  const st = useClassSchedule()
  const now = new Date()
  const today = weekdayOf(now)
  const dates = useMemo(() => weekDates(mondayOf(new Date())), [])
  const week = athleteWeek(st.classes, st.mine, st.changes, st.extra)
  const [mode, setMode] = useState<Mode>(null)
  const [sheet, setSheet] = useState<{ kind: "class" | "cant"; id: string } | null>(null)

  const cantId = sheet?.kind === "cant" ? sheet.id : null
  const cantClass = cantId ? st.classes.find((c) => c.id === cantId) ?? null : null
  const entryFor = (id: string) => week.find((e) => e.cls.id === id)
  const fits = (c: { day: number }, except?: string) => c.day >= today && restDayOk(busyDays(week, except), c.day)

  const toneFor = (c: GymClass) => {
    const e = entryFor(c.id)
    if (e) return e.state === "skip" ? "skip" : e.state === "pending" ? "pending" : "mine"
    if (headcount(c, week) >= CAPACITY) return "full"
    if (mode?.kind === "move" && fits(c, mode.from)) return "pick"
    return "other"
  }

  const renderDay = (day: number) => (
    <>
      {st.classes.filter((c) => c.day === day).map((c) => {
        const e = entryFor(c.id)
        const names = [...(e && e.state !== "skip" ? [me] : []), ...c.roster]
        return (
          <GridBlock
            key={c.id}
            start={c.start}
            tone={toneFor(c)}
            text={names.join(", ") || "—"}
            onPress={() => setSheet({ kind: "class", id: c.id })}
          />
        )
      })}
      {week.filter((e) => e.proposal && e.cls.day === day).map((e) => (
        <GridBlock key={e.cls.id} start={e.cls.start} tone="pending" text={`${formatTime(e.cls.start)} proposed`} />
      ))}
    </>
  )

  const proposingFrom = mode?.kind === "propose" ? mode.from : null
  const movingFrom = mode?.kind === "move" ? mode.from : null
  const proposeAt = (day: number, y: number) => {
    if (!proposingFrom) return
    if (day < today) return Alert.alert("That day already passed")
    if (!restDayOk(busyDays(week, proposingFrom), day)) return Alert.alert("Leave a rest day between classes")
    const start = startFromOffset(y, HOUR_HEIGHT)
    changeClass(proposingFrom, { status: "propose", day, start })
    setMode(null)
    Alert.alert("Proposal sent", `${WEEK_DAYS[day]} ${formatTime(start)}. Your coach answers before the class.`)
  }

  return (
    <ScreenGradient>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <FeatureIntro
          id="class-week-v2"
          pages={[
            { icon: "people", title: "See who's going", text: "Your classes are green. Tap any class to see who's in it. Each class has room for 4." },
            { icon: "swap-horizontal", title: "Missed a class? Make it up", text: "Tell your coach early so someone else can take your spot. Then pick another class this week, or propose a new time (never the day before or after another class). If you can't make it up this week, move it to a later week, up to 2 per package." },
            { icon: "checkmark-done", title: "Your coach approves", text: "Changes show in yellow until your coach answers. No answer before the class means no change." },
          ]}
        />
        <SubScreenHeader title="This week" subtitle={`${st.sessionsLeft} sessions left · use by ${st.useBy}`} />
        <View style={s.top}>
          {mode && (
            <View style={s.banner}>
              <Text style={s.bannerText}>
                {mode.kind === "move" ? "Pick a class with the yellow outline" : "Tap a free time to propose it"}
              </Text>
              <Pressable hitSlop={8} onPress={() => setMode(null)}>
                <Text style={s.bannerCancel}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
        <WeekGrid
          dates={dates}
          today={today}
          dimPast
          onPressTime={proposingFrom ? proposeAt : undefined}
          renderDay={renderDay}
        />
      </SafeAreaView>

      <ClassSheet
        cls={sheet?.kind === "class" ? st.classes.find((c) => c.id === sheet.id) ?? null : null}
        me={me}
        week={week}
        today={today}
        mode={mode}
        extraUsed={!!st.extra}
        changedAway={sheet?.kind === "class" && ["move", "propose"].includes(st.changes[sheet.id]?.status ?? "")}
        fits={fits}
        onClose={() => setSheet(null)}
        onCant={(id) => {
          // iOS won't present a sheet while the previous one is still closing.
          setSheet(null)
          setTimeout(() => setSheet({ kind: "cant", id }), 400)
        }}
        onUndoSkip={(id) => { changeClass(id, null); setSheet(null) }}
        onMoveHere={(to) => {
          if (movingFrom) changeClass(movingFrom, { status: "move", to })
          setMode(null)
          setSheet(null)
        }}
        onExtra={(id) => { requestExtra(id); setSheet(null) }}
      />

      <Sheet
        visible={!!cantClass}
        title={cantClass ? `Can't make ${classLabel(cantClass)}?` : ""}
        onClose={() => setSheet(null)}
      >
        {cantId && (
          <>
            <Text style={s.warn}>
              Let your coach know early: each class has {CAPACITY} spots, and yours can go to someone who can come.
              Make it up this week, or move it to a later week (2 per package).
            </Text>
            <SheetOption
              title="Move to another class"
              detail="Your coach approves the change"
              onPress={() => { setMode({ kind: "move", from: cantId }); setSheet(null) }}
            />
            <SheetOption
              title="Propose another time"
              detail="If no class fits, your coach decides"
              onPress={() => { setMode({ kind: "propose", from: cantId }); setSheet(null) }}
            />
            <SheetOption
              title="I won't go this week"
              detail="It moves to a later week, up to 2 of your 8. After that you lose it. Your coach is told"
              onPress={() => { changeClass(cantId, { status: "skip" }); setSheet(null) }}
            />
          </>
        )}
      </Sheet>
    </ScreenGradient>
  )
}

function ClassSheet({
  cls, me, week, today, mode, extraUsed, changedAway, fits, onClose, onCant, onUndoSkip, onMoveHere, onExtra,
}: {
  cls: GymClass | null
  me: string
  week: ReturnType<typeof athleteWeek>
  today: number
  mode: Mode
  extraUsed: boolean
  changedAway: boolean // the athlete asked to move this class somewhere else
  fits: (c: GymClass, except?: string) => boolean
  onClose: () => void
  onCant: (id: string) => void
  onUndoSkip: (id: string) => void
  onMoveHere: (id: string) => void
  onExtra: (id: string) => void
}) {
  if (!cls) return <Sheet visible={false} title="" onClose={onClose} />
  const e = week.find((x) => x.cls.id === cls.id)
  const roster = [...(e && e.state !== "skip" ? [me] : []), ...cls.roster]
  const full = !e && headcount(cls, week) >= CAPACITY
  let actions: React.ReactNode = null
  if (e?.extra && cls.day >= today) {
    actions = <SheetButton kind="red" label={e.state === "pending" ? "Cancel request" : "Cancel extra class"} onPress={() => { cancelExtra(); onClose() }} />
  } else if (e?.state === "on" && cls.day >= today) {
    actions = <SheetButton kind="red" label="I can't go" onPress={() => onCant(cls.id)} />
  } else if (e?.state === "pending") {
    actions = (
      <>
        <Text style={s.note}>Waiting for your coach. If they don&apos;t answer before the class, it stays as it was.</Text>
        <SheetButton kind="line" label="Cancel request" onPress={() => onUndoSkip(e.from ?? cls.id)} />
      </>
    )
  } else if (changedAway) {
    actions = (
      <>
        <Text style={s.note}>You asked to move this class. Waiting for your coach.</Text>
        <SheetButton kind="line" label="Keep this class" onPress={() => onUndoSkip(cls.id)} />
      </>
    )
  } else if (e?.state === "skip") {
    actions = <SheetButton kind="line" label="I can go after all" onPress={() => onUndoSkip(cls.id)} />
  } else if (mode?.kind === "move") {
    const ok = !full && fits(cls, mode.from)
    actions = (
      <>
        <SheetButton label="Move here" disabled={!ok} onPress={() => onMoveHere(cls.id)} />
        {!ok && <Text style={s.hint}>{full ? "This class is full." : "Leave a rest day between classes."}</Text>}
      </>
    )
  } else if (!e && cls.day >= today && !full) {
    const ok = !extraUsed && fits(cls)
    actions = (
      <>
        <SheetButton kind="line" label="Add as an extra class" disabled={!ok} onPress={() => onExtra(cls.id)} />
        <Text style={s.hint}>
          {extraUsed
            ? "You already have an extra class this week."
            : !fits(cls) ? "Leave a rest day between classes." : "One extra a week. Your coach approves it and it uses a session."}
        </Text>
      </>
    )
  }
  return (
    <Sheet
      visible
      title={`${classLabel(cls)} – ${formatTime(cls.start + CLASS_HOURS)}`}
      subtitle={`${roster.length} of ${CAPACITY} climbers${full ? " · Full" : ""}`}
      onClose={onClose}
    >
      <View>
        {roster.length ? roster.map((u) => (
          <View key={u} style={s.person}>
            <View style={s.avatar}><Text style={s.avatarText}>{u[0]?.toUpperCase()}</Text></View>
            <Text style={s.personName}>{u}</Text>
          </View>
        )) : <Text style={s.note}>No one yet.</Text>}
      </View>
      {actions}
    </Sheet>
  )
}

const s = StyleSheet.create({
  top: { paddingHorizontal: 16, gap: 8, marginBottom: 10 },
  banner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
    backgroundColor: "rgba(254,215,102,0.10)", borderWidth: 1, borderColor: "rgba(254,215,102,0.35)",
    borderRadius: 12, padding: 12,
  },
  bannerText: { flex: 1, color: C.yellow, fontSize: 13, fontWeight: "600" },
  bannerCancel: { color: C.textSecondary, fontSize: 13, fontWeight: "700" },
  warn: {
    fontSize: 13, lineHeight: 19, color: C.yellow, backgroundColor: "rgba(254,215,102,0.08)",
    borderRadius: 12, padding: 12, overflow: "hidden",
  },
  note: { fontSize: 13, color: C.textSecondary, fontWeight: "600" },
  hint: { fontSize: 12, color: C.yellow, marginTop: -4 },
  person: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 13, fontWeight: "800", color: C.textSecondary },
  personName: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
})
