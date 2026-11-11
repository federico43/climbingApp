import { useAuth } from "@/components/auth-context"
import { ScreenGradient } from "@/components/ScreenGradient"
import { Sheet, SheetButton, SheetOption } from "@/components/schedule/Sheet"
import { FeatureIntro, IntroButton } from "@/components/schedule/FeatureIntro"
import { GridBlock, HOUR_HEIGHT, Tone, WeekGrid } from "@/components/schedule/WeekGrid"
import {
  DAYS_LONG, DetailRow, Legend, OpenSpot, PersonRow, RepeatChoice, WeekSwitch, longDay, monthTitle,
} from "@/components/schedule/CalendarBits"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import {
  AddClassProblem, CAPACITY, CLASS_HOURS, CLASSES_PER_DAY, GRID_END, GRID_START, GymClass, athleteWeek, busyDays, classDate, classLabel, formatTime,
  headcount, proposeProblem,
  dateOf, openDays, parseSlot, restDayOk, slotKey, startFromOffset, usualFits, weekDates, weekdayOf,
} from "@/utils/classSchedule"
import { cancelExtra, changeClass, joinClass, refreshClassSchedule, stopUsual, useClassSchedule } from "@/utils/classScheduleStore"
import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect } from "expo-router"
import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Why a proposed time doesn't work: the whole 2h 30m class has to fit.
const NO_FIT: Record<AddClassProblem, string> = {
  max: `That day already has ${CLASSES_PER_DAY} classes. Pick one of them instead.`,
  bigDays: `That day already has ${CLASSES_PER_DAY} classes. Pick one of them instead.`,
  overlap: "It runs into another class. Pick a free time.",
  blocked: "Your coach can't teach then.",
  late: `Classes have to end by ${GRID_END}:00.`,
}

type Mode = { kind: "move" | "propose"; from: string } | null

// The athlete's week of classes, laid out like Google Calendar, opened from
// the "This week" card on Plan. Tap a class with a free spot to join it (just
// this week or every week); tap one of yours if you can't go.
export default function ScheduleScreen() {
  const { userName } = useAuth()
  const me = userName || "you"
  const st = useClassSchedule()
  useFocusEffect(useCallback(() => { refreshClassSchedule() }, []))
  // From Saturday, once the coach has published next week, it opens on that one.
  const [pick, setPick] = useState<"this" | "next" | null>(null)
  const which = pick ?? (st.shownNext ? "next" : "this")
  const nextWeek = which === "next" && !!st.nextWeek
  const wk = nextWeek ? st.nextWeek! : st.thisWeek
  const today = nextWeek ? 0 : weekdayOf(new Date())
  const dates = useMemo(() => weekDates(dateOf(wk.weekStart || "2000-01-03")), [wk.weekStart])
  const week = athleteWeek(wk.classes, wk.mine, wk.changes, wk.extra)
  const [mode, setMode] = useState<Mode>(null)
  const [sheet, setSheet] = useState<{ kind: "class" | "cant"; id: string } | null>(null)
  // The time picked for a proposal, still to be adjusted and sent.
  const [draft, setDraft] = useState<{ day: number; start: number } | null>(null)

  const cantId = sheet?.kind === "cant" ? sheet.id : null
  const cantClass = cantId ? wk.classes.find((c) => c.id === cantId) ?? null : null
  const entryFor = (id: string) => week.find((e) => e.cls.id === id)
  const started = (c: { day: number; start: number }) => !!wk.weekStart && classDate(wk.weekStart, c).getTime() <= Date.now()
  const fits = (c: { day: number; start: number }, except?: string) => !started(c) && restDayOk(busyDays(week, except), c.day)
  const hasClasses = week.some((e) => e.state !== "skip")

  const toneFor = (c: GymClass): Tone => {
    const e = entryFor(c.id)
    if (e) return e.state === "skip" ? "skip" : e.state === "pending" ? "pending" : "mine"
    if (headcount(c, week) >= CAPACITY) return "full"
    if (mode?.kind === "move") return fits(c, mode.from) ? "pick" : "other"
    return !mode && fits(c) ? "open" : "other"
  }

  const renderDay = (day: number) => (
    <>
      {/* The coach's blocked times: nothing can be proposed there. */}
      {wk.blocks.filter((b) => b.day === day).map((b, i) => (
        <GridBlock
          key={`b${i}`}
          start={b.all ? GRID_START : b.start}
          hours={b.all ? GRID_END - GRID_START : b.end - b.start}
          tone="blocked"
          text="No classes"
        />
      ))}
      {wk.classes.filter((c) => c.day === day).map((c) => {
        const e = entryFor(c.id)
        const names = [...(e && e.state !== "skip" ? ["You"] : []), ...c.roster]
        const tone = toneFor(c)
        const free = CAPACITY - headcount(c, week)
        return (
          <GridBlock
            key={c.id}
            start={c.start}
            tone={tone}
            text={[
              formatTime(c.start),
              ...names,
              ...(tone === "open" || tone === "pick" ? [`·${free} free`] : tone === "full" ? ["·Full"] : []),
            ].join("\n")}
            onPress={() => setSheet({ kind: "class", id: c.id })}
          />
        )
      })}
      {week.filter((e) => e.proposal && e.cls.day === day).map((e) => (
        <GridBlock
          key={e.cls.id}
          start={e.cls.start}
          tone="pending"
          text={`${formatTime(e.cls.start)}\nYou\n·proposed`}
          onPress={() => e.from && setSheet({ kind: "class", id: e.from })}
        />
      ))}
      {draft?.day === day && <GridBlock start={draft.start} tone="pick" text={formatTime(draft.start)} />}
    </>
  )

  const proposingFrom = mode?.kind === "propose" ? mode.from : null
  const movingFrom = mode?.kind === "move" ? mode.from : null
  // Days a new time can go to: a rest day around the others, and fewer than
  // 2 classes that day (a third is the coach's call; pick an existing class).
  const daysFor = (from: string) =>
    openDays(busyDays(week, from), today).filter((d) => wk.classes.filter((c) => c.day === d).length < CLASSES_PER_DAY)
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
  const draftProblem = draft ? proposeProblem(wk.classes, wk.blocks, draft.day, draft.start) : null
  const sendDraft = async () => {
    if (!proposingFrom || !draft) return
    const sent = draft
    setDraft(null)
    setMode(null)
    if (await changeClass(proposingFrom, { status: "propose", ...sent })) {
      Alert.alert("Proposal sent", `${classLabel(sent)}. Your coach answers before the class.`)
    }
  }
  // The "I can't go" options that still have somewhere to go.
  const canMove = !!cantId && wk.classes.some((c) => !entryFor(c.id) && headcount(c, week) < CAPACITY && fits(c, cantId))
  const canPropose = !!cantId && daysFor(cantId).length > 0
  const usualText = st.defaults.map((k) => parseSlot(k)).filter(Boolean).map((c) => classLabel(c!)).join(" · ")
  const openCount = wk.classes.filter((c) => !entryFor(c.id) && headcount(c, week) < CAPACITY && fits(c)).length

  return (
    <ScreenGradient>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <FeatureIntro
          id="class-week-v3"
          pages={[
            { icon: "add-circle", title: "Tap a class to join", text: "Classes with a green bar on the left have a free spot. Tap one, choose just this week or every week, and you're in." },
            { icon: "calendar", title: "Can't go? Tap your class", text: "Your classes are solid green. Tap one and choose I can't go: move to another class, propose a time, or skip this week." },
          ]}
        />
        <SubScreenHeader
          title={monthTitle(dates)}
          subtitle={st.pkg ? `${st.pkg.left} sessions left · use by ${st.pkg.useBy}` : "No package yet. Ask your coach."}
          right={<IntroButton id="class-week-v3" />}
        />
        <View style={s.top}>
          <WeekSwitch
            value={nextWeek ? "next" : "this"}
            onChange={(w) => { setPick(w); setMode(null); setDraft(null) }}
            nextNote={st.nextWeek ? null : "Not published yet"}
          />
          {st.status !== "ready" ? (
            st.status === "error"
              ? <Pressable onPress={() => refreshClassSchedule()}><Text style={s.note}>Couldn&apos;t load the classes. Tap to try again.</Text></Pressable>
              : <ActivityIndicator color={C.green} />
          ) : !wk.published ? (
            <Text style={s.note}>Your coach hasn&apos;t published this week&apos;s classes yet.</Text>
          ) : mode ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>
                {mode.kind === "move" ? "Tap a class with the yellow border to move there" : "Tap a bright day near the time you want"}
              </Text>
              <Pressable hitSlop={8} onPress={() => { setMode(null); setDraft(null) }}>
                <Text style={s.bannerCancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : !hasClasses ? (
            // First visit (or a week with nothing booked): say exactly what to do.
            <View style={s.welcome}>
              <Ionicons name="hand-left-outline" size={22} color={C.green} />
              <View style={{ flex: 1 }}>
                <Text style={s.welcomeTitle}>{openCount ? "Pick your classes" : "No free spots left"}</Text>
                <Text style={s.welcomeText}>
                  {openCount
                    ? `Tap a class with a green bar (${openCount} with free spots) and press Join.`
                    : "Every class this week is full or too close to another. Ask your coach."}
                </Text>
              </View>
            </View>
          ) : usualText ? (
            <Text style={s.usual} numberOfLines={1}>
              <Ionicons name="repeat" size={13} color={C.textSecondary} /> Every week: {usualText}
            </Text>
          ) : null}
          <Legend keys={["mine", "open", "full", "pending"]} />
        </View>
        <WeekGrid
          dates={dates}
          today={nextWeek ? -1 : today}
          dimPast
          dimDays={proposingFrom ? [0, 1, 2, 3, 4, 5, 6].filter((d) => d >= today && !proposeDays.includes(d)) : []}
          onPressTime={proposingFrom ? proposeAt : undefined}
          onRefresh={refreshClassSchedule}
          renderDay={renderDay}
        />
      </SafeAreaView>

      <ClassSheet
        cls={sheet?.kind === "class" ? wk.classes.find((c) => c.id === sheet.id) ?? null : null}
        me={me}
        week={week}
        dates={dates}
        defaults={st.defaults}
        busy={st.busy}
        mode={mode}
        started={started}
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
  cls, me, week, dates, defaults, busy, mode, started, changedAway, fits, onClose, onCant, onUndoSkip, onMoveHere,
}: {
  cls: GymClass | null
  me: string
  week: ReturnType<typeof athleteWeek>
  dates: Date[]
  defaults: string[]
  busy: boolean
  mode: Mode
  started: (c: GymClass) => boolean
  changedAway: boolean // the athlete asked to move this class somewhere else
  fits: (c: GymClass, except?: string) => boolean
  onClose: () => void
  onCant: (id: string) => void
  onUndoSkip: (id: string) => void
  onMoveHere: (id: string) => void
}) {
  // Join: just this week or every week. Every week by default for someone
  // with no usual classes yet (a new athlete).
  const [every, setEvery] = useState<boolean | null>(null)
  if (!cls) return <Sheet visible={false} title="" onClose={onClose} />
  const e = week.find((x) => x.cls.id === cls.id)
  const inIt = !!e && e.state !== "skip"
  const count = headcount(cls, week)
  const full = !e && count >= CAPACITY
  const usual = defaults.includes(slotKey(cls))
  const gone = started(cls)
  const everyOff = usualFits(defaults, cls) ? null : defaults.length >= 3 ? "You already go 3 times a week" : "Too close to another class you go to every week"
  const repeat = (every ?? !defaults.length) && !everyOff
  const close = () => { setEvery(null); onClose() }

  let actions: React.ReactNode = null
  if (gone) {
    actions = <Text style={s.note}>This class has already started.</Text>
  } else if (e?.extra) {
    actions = <SheetButton kind="red" label={e.state === "pending" ? "Cancel request" : "Cancel extra class"} onPress={() => { cancelExtra(); close() }} />
  } else if (e?.state === "on") {
    actions = (
      <>
        <SheetButton kind="red" label="I can't go" onPress={() => { setEvery(null); onCant(cls.id) }} />
        {usual && <SheetButton kind="line" label="Stop repeating every week" onPress={() => { stopUsual(cls); close() }} />}
      </>
    )
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
  } else if (full) {
    actions = <Text style={s.note}>This class is full. Pick another one with a green bar.</Text>
  } else if (!fits(cls)) {
    actions = <Text style={s.hint}>You have a class the day before or after. Leave a rest day between classes.</Text>
  } else {
    actions = (
      <>
        <RepeatChoice
          every={repeat}
          onChange={setEvery}
          everyLabel={`Every ${DAYS_LONG[cls.day]} at ${formatTime(cls.start)}`}
          everyOff={everyOff}
        />
        <SheetButton
          label={busy ? "Joining…" : "Join class"}
          disabled={busy}
          onPress={async () => {
            if (await joinClass(cls.id, cls, repeat)) close()
          }}
        />
      </>
    )
  }
  return (
    <Sheet visible title={longDay(dates, cls.day)} onClose={close}>
      <DetailRow icon="time-outline" text={`${formatTime(cls.start)} – ${formatTime(cls.start + CLASS_HOURS)}`} sub={usual ? "Repeats every week" : undefined} />
      <DetailRow
        icon="people-outline"
        text={`${count} of ${CAPACITY} climbers`}
        sub={full ? "Full" : `${CAPACITY - count} free spot${CAPACITY - count === 1 ? "" : "s"}`}
      />
      <View>
        {inIt && <PersonRow name={me} you />}
        {cls.roster.map((u, i) => <PersonRow key={`${u}${i}`} name={u} />)}
        {Array.from({ length: Math.max(0, CAPACITY - count) }, (_, i) => <OpenSpot key={`o${i}`} />)}
      </View>
      {actions}
    </Sheet>
  )
}

const s = StyleSheet.create({
  top: { paddingHorizontal: 16, gap: 10, marginBottom: 10 },
  welcome: {
    flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14,
    backgroundColor: "rgba(111,207,151,0.10)", borderWidth: 1, borderColor: "rgba(111,207,151,0.35)",
  },
  welcomeTitle: { fontSize: 16, fontWeight: "800", color: C.textPrimary },
  welcomeText: { fontSize: 13.5, color: C.textSecondary, marginTop: 2, lineHeight: 19 },
  usual: { fontSize: 13, color: C.textSecondary, fontWeight: "600" },
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
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  step: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  stepText: { color: C.textPrimary, fontSize: 14, fontWeight: "700" },
  stepTime: { color: C.textPrimary, fontSize: 28, fontWeight: "800" },
})
