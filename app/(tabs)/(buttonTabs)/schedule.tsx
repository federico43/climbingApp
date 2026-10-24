import { useAuth } from "@/components/auth-context"
import { ScreenGradient } from "@/components/ScreenGradient"
import { Sheet, SheetButton, SheetOption } from "@/components/schedule/Sheet"
import { FeatureIntro } from "@/components/schedule/FeatureIntro"
import { GridBlock, HOUR_HEIGHT, WeekGrid } from "@/components/schedule/WeekGrid"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import {
  AddClassProblem, CAPACITY, CLASS_HOURS, GRID_END, GRID_START, MAX_CLASSES_PER_DAY, GymClass, addClassProblem, athleteWeek, busyDays, classLabel, formatTime, headcount,
  dateOf, openDays, parseSlot, restDayOk, slotKey, startFromOffset, weekDates, weekdayOf,
} from "@/utils/classSchedule"
import { cancelExtra, changeClass, refreshClassSchedule, saveUsualClasses, useClassSchedule } from "@/utils/classScheduleStore"
import { C } from "@/utils/theme"
import { useFocusEffect } from "expo-router"
import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Why a proposed time doesn't work: the whole 2h 30m class has to fit.
const NO_FIT: Record<AddClassProblem, string> = {
  max: "That day already has 2 classes.",
  overlap: "It runs into another class. Pick a free time.",
  blocked: "Your coach can't teach then.",
  late: "Classes have to end by 18:00.",
}

type Mode = { kind: "move" | "propose"; from: string } | { kind: "usual" } | null

// The athlete's week of classes, Google-Calendar style, opened from the
// "This week" card on Plan.
export default function ScheduleScreen() {
  const { userName } = useAuth()
  const me = userName || "you"
  const st = useClassSchedule()
  useFocusEffect(useCallback(() => { refreshClassSchedule() }, []))
  const wk = st.shown
  // From Saturday, once the coach has published next week, that's the one to plan.
  const nextWeek = st.shownNext
  const today = nextWeek ? 0 : weekdayOf(new Date())
  const dates = useMemo(() => weekDates(dateOf(wk.weekStart || "2000-01-03")), [wk.weekStart])
  const week = athleteWeek(wk.classes, wk.mine, wk.changes, wk.extra)
  const [mode, setMode] = useState<Mode>(null)
  // Usual classes being picked (mode "usual").
  const [usual, setUsual] = useState<string[]>([])
  const [sheet, setSheet] = useState<{ kind: "class" | "cant"; id: string } | null>(null)
  // The time picked for a proposal, still to be adjusted and sent.
  const [draft, setDraft] = useState<{ day: number; start: number } | null>(null)

  const cantId = sheet?.kind === "cant" ? sheet.id : null
  const cantClass = cantId ? wk.classes.find((c) => c.id === cantId) ?? null : null
  const entryFor = (id: string) => week.find((e) => e.cls.id === id)
  const fits = (c: { day: number }, except?: string) => c.day >= today && restDayOk(busyDays(week, except), c.day)

  const toneFor = (c: GymClass) => {
    if (mode?.kind === "usual") return usual.includes(slotKey(c)) ? "mine" : "other"
    const e = entryFor(c.id)
    if (e) return e.state === "skip" ? "skip" : e.state === "pending" ? "pending" : "mine"
    if (headcount(c, week) >= CAPACITY) return "full"
    if (mode?.kind === "move" && fits(c, mode.from)) return "pick"
    return "other"
  }

  const renderDay = (day: number) => (
    <>
      {wk.classes.filter((c) => c.day === day).map((c) => {
        const e = entryFor(c.id)
        const names = [...(e && e.state !== "skip" ? [me] : []), ...c.roster]
        return (
          <GridBlock
            key={c.id}
            start={c.start}
            tone={toneFor(c)}
            text={names.join(", ") || "—"}
            onPress={() => (mode?.kind === "usual" ? toggleUsual(c) : setSheet({ kind: "class", id: c.id }))}
          />
        )
      })}
      {week.filter((e) => e.proposal && e.cls.day === day).map((e) => (
        <GridBlock
          key={e.cls.id}
          start={e.cls.start}
          tone="pending"
          text={`${formatTime(e.cls.start)} proposed`}
          onPress={() => e.from && setSheet({ kind: "class", id: e.from })}
        />
      ))}
      {draft?.day === day && <GridBlock start={draft.start} tone="pick" text={formatTime(draft.start)} />}
    </>
  )

  const proposingFrom = mode?.kind === "propose" ? mode.from : null
  const movingFrom = mode?.kind === "move" ? mode.from : null
  // Days a class can still go to: a rest day around the others, and not a
  // day that already has its 2 classes.
  const daysFor = (from: string) =>
    openDays(busyDays(week, from), today).filter((d) => wk.classes.filter((c) => c.day === d).length < MAX_CLASSES_PER_DAY)
  const proposeDays = proposingFrom ? daysFor(proposingFrom) : []
  const proposeAt = (day: number, y: number) => {
    if (!proposingFrom) return
    if (day < today) return Alert.alert("That day already passed")
    if (!proposeDays.includes(day)) {
      return restDayOk(busyDays(week, proposingFrom), day)
        ? Alert.alert("That day is full", NO_FIT.max)
        : Alert.alert("Leave a rest day between classes")
    }
    // A tap only gets close; the time is fine-tuned in the sheet before sending.
    setDraft({ day, start: startFromOffset(y, HOUR_HEIGHT) })
  }
  const draftProblem = draft ? addClassProblem(wk.classes, wk.blocks, draft.day, draft.start) : null
  const sendDraft = async () => {
    if (!proposingFrom || !draft) return
    const sent = draft
    setDraft(null)
    setMode(null)
    if (await changeClass(proposingFrom, { status: "propose", ...sent })) {
      Alert.alert("Proposal sent", `${classLabel(sent)}. Your coach answers before the class.`)
    }
  }
  // Usual classes: one a day at most, with a rest day between them.
  const toggleUsual = (c: GymClass) => {
    const key = slotKey(c)
    if (usual.includes(key)) return setUsual(usual.filter((k) => k !== key))
    const days = usual.map((k) => parseSlot(k)!.day)
    if (!restDayOk(days, c.day)) return Alert.alert("Leave a rest day between classes")
    if (usual.length >= 3) return Alert.alert("Up to 3 classes a week")
    setUsual([...usual, key])
  }
  const saveUsual = async () => {
    if (await saveUsualClasses(usual)) setMode(null)
  }
  // The "I can't go" options that still have somewhere to go.
  const canMove = !!cantId && wk.classes.some((c) => !entryFor(c.id) && headcount(c, week) < CAPACITY && fits(c, cantId))
  const canPropose = !!cantId && daysFor(cantId).length > 0

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
        <SubScreenHeader
          title={nextWeek ? "Next week" : "This week"}
          subtitle={st.pkg ? `${st.pkg.left} sessions left · use by ${st.pkg.useBy}` : "No package yet. Ask your coach."}
        />
        <View style={s.top}>
          {st.status !== "ready" ? (
            st.status === "error"
              ? <Pressable onPress={() => refreshClassSchedule()}><Text style={s.note}>Couldn&apos;t load the classes. Tap to try again.</Text></Pressable>
              : <ActivityIndicator color={C.green} />
          ) : !wk.published ? (
            <Text style={s.note}>Your coach hasn&apos;t published this week&apos;s classes yet.</Text>
          ) : mode?.kind === "usual" ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>Tap the classes you go to every week ({usual.length} picked)</Text>
              <Pressable hitSlop={8} disabled={!usual.length || st.busy} onPress={saveUsual}>
                <Text style={[s.bannerSave, !usual.length && { opacity: 0.4 }]}>Save</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => setMode(null)}>
                <Text style={s.bannerCancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : mode ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>
                {mode.kind === "move" ? "Pick a class with the yellow outline" : "Tap a bright day near the time you want"}
              </Text>
              <Pressable hitSlop={8} onPress={() => { setMode(null); setDraft(null) }}>
                <Text style={s.bannerCancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : !st.defaults.length ? (
            <Pressable style={s.banner} onPress={() => { setUsual([]); setMode({ kind: "usual" }) }}>
              <Text style={s.bannerText}>Set your weekly schedule: pick the classes you go to every week</Text>
              <Text style={s.bannerSave}>Start</Text>
            </Pressable>
          ) : (
            <Pressable hitSlop={8} onPress={() => { setUsual(st.defaults); setMode({ kind: "usual" }) }}>
              <Text style={s.link}>
                Usual classes: {st.defaults.map((k) => parseSlot(k)).filter(Boolean).map((c) => classLabel(c!)).join(", ")} · Change
              </Text>
            </Pressable>
          )}
        </View>
        <WeekGrid
          dates={dates}
          today={nextWeek ? -1 : today}
          dimPast
          dimDays={proposingFrom ? [0, 1, 2, 3, 4, 5, 6].filter((d) => d >= today && !proposeDays.includes(d)) : []}
          onPressTime={proposingFrom ? proposeAt : undefined}
          renderDay={renderDay}
        />
      </SafeAreaView>

      <ClassSheet
        cls={sheet?.kind === "class" ? wk.classes.find((c) => c.id === sheet.id) ?? null : null}
        me={me}
        week={week}
        today={today}
        mode={mode}
        changedAway={sheet?.kind === "class" && ["move", "propose"].includes(wk.changes[sheet.id]?.status ?? "")}
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
              detail={canMove ? "Your coach approves the change" : "No class left this week with a rest day around it"}
              disabled={!canMove}
              onPress={() => { setMode({ kind: "move", from: cantId }); setSheet(null) }}
            />
            <SheetOption
              title="Propose another time"
              detail={canPropose ? "If no class fits, your coach decides" : "No day left this week with room and a rest day around it"}
              disabled={!canPropose}
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

      <Sheet
        visible={!!draft}
        title={draft ? `Propose ${classLabel(draft)} – ${formatTime(draft.start + CLASS_HOURS)}` : ""}
        subtitle="Adjust the time in half-hour steps"
        onClose={() => setDraft(null)}
      >
        {draft && (
          <>
            <View style={s.stepper}>
              <Pressable
                style={s.step}
                disabled={draft.start <= GRID_START}
                onPress={() => setDraft({ ...draft, start: draft.start - 0.5 })}
              >
                <Text style={[s.stepText, draft.start <= GRID_START && { opacity: 0.3 }]}>−30 min</Text>
              </Pressable>
              <Text style={s.stepTime}>{formatTime(draft.start)}</Text>
              <Pressable
                style={s.step}
                disabled={draft.start + CLASS_HOURS >= GRID_END}
                onPress={() => setDraft({ ...draft, start: draft.start + 0.5 })}
              >
                <Text style={[s.stepText, draft.start + CLASS_HOURS >= GRID_END && { opacity: 0.3 }]}>+30 min</Text>
              </Pressable>
            </View>
            {draftProblem && <Text style={s.hint}>{NO_FIT[draftProblem]}</Text>}
            <SheetButton label="Send proposal" disabled={!!draftProblem} onPress={sendDraft} />
            <SheetButton kind="line" label="Pick another time" onPress={() => setDraft(null)} />
          </>
        )}
      </Sheet>
    </ScreenGradient>
  )
}

function ClassSheet({
  cls, me, week, today, mode, changedAway, fits, onClose, onCant, onUndoSkip, onMoveHere,
}: {
  cls: GymClass | null
  me: string
  week: ReturnType<typeof athleteWeek>
  today: number
  mode: Mode
  changedAway: boolean // the athlete asked to move this class somewhere else
  fits: (c: GymClass, except?: string) => boolean
  onClose: () => void
  onCant: (id: string) => void
  onUndoSkip: (id: string) => void
  onMoveHere: (id: string) => void
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
  bannerSave: { color: C.green, fontSize: 13, fontWeight: "800" },
  link: { color: C.textSecondary, fontSize: 13, fontWeight: "600" },
  warn: {
    fontSize: 13, lineHeight: 19, color: C.yellow, backgroundColor: "rgba(254,215,102,0.08)",
    borderRadius: 12, padding: 12, overflow: "hidden",
  },
  note: { fontSize: 13, color: C.textSecondary, fontWeight: "600" },
  hint: { fontSize: 12, color: C.yellow, marginTop: -4 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  step: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  stepText: { color: C.textPrimary, fontSize: 14, fontWeight: "700" },
  stepTime: { color: C.textPrimary, fontSize: 28, fontWeight: "800" },
  person: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 13, fontWeight: "800", color: C.textSecondary },
  personName: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
})
