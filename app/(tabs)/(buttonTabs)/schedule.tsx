import { useAuth } from "@/components/auth-context"
import { ScreenGradient } from "@/components/ScreenGradient"
import { Sheet, SheetButton, SheetOption } from "@/components/schedule/Sheet"
import { FeatureIntro, IntroButton, useIntroSeen } from "@/components/schedule/FeatureIntro"
import { UsualSetup } from "@/components/schedule/UsualSetup"
import { GridBlock, HOUR_HEIGHT, WeekGrid } from "@/components/schedule/WeekGrid"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import {
  AddClassProblem, CAPACITY, CLASS_HOURS, CLASSES_PER_DAY, GRID_END, GRID_START, GymClass, athleteWeek, busyDays, classLabel, formatTime,
  classesToJoin, headcount, missingUsual, proposeProblem,
  dateOf, openDays, parseSlot, restDayOk, slotKey, startFromOffset, weekDates, weekdayOf,
} from "@/utils/classSchedule"
import { cancelExtra, changeClass, refreshClassSchedule, requestExtra, saveUsualClasses, useClassSchedule } from "@/utils/classScheduleStore"
import { setFixedAnswer, useFixedAnswer } from "@/utils/fixedScheduleAnswer"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect } from "expo-router"
import { useCallback, useEffect, useMemo, useState } from "react"
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

// "No class at your usual time" closed for a week, on this phone.
const MISSING_KEY = (user: string, weekStart: string) => `missing-usual-seen:${user}:${weekStart}`

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
  // The fixed-schedule screen: shown until the athlete answers, and from "Change".
  const answer = useFixedAnswer(st.me)
  const [editing, setEditing] = useState(false)
  const setup = editing || (st.status === "ready" && !st.defaults.length && answer === null)
  // Still finding out whether to show it: hold the intro pop-up back meanwhile.
  const deciding = !st.defaults.length && (st.status !== "ready" || answer === undefined)
  const introSeen = useIntroSeen("class-week-v2")
  const [sheet, setSheet] = useState<{ kind: "class" | "cant"; id: string } | null>(null)
  // The time picked for a proposal, still to be adjusted and sent.
  const [draft, setDraft] = useState<{ day: number; start: number } | null>(null)

  const cantId = sheet?.kind === "cant" ? sheet.id : null
  const cantClass = cantId ? wk.classes.find((c) => c.id === cantId) ?? null : null
  const entryFor = (id: string) => week.find((e) => e.cls.id === id)
  const fits = (c: { day: number }, except?: string) => c.day >= today && restDayOk(busyDays(week, except), c.day)

  // Usual times still ahead with no class this week → offer the ones there are.
  const missing = wk.published && !wk.extra ? missingUsual(st.defaults, wk.classes, week, today) : []
  const joinable = missing.length ? classesToJoin(wk.classes, week, today, missing[0]) : []
  const missingId = missing.length ? `${wk.weekStart}:${missing.map(slotKey).join(",")}` : ""
  const [showMissing, setShowMissing] = useState(false)
  useEffect(() => {
    // Never on top of another pop-up: wait for the intro, the setup screen and
    // any sheet, and give iOS a moment after a Modal closes.
    if (!missingId || setup || deciding || !introSeen || sheet || mode || showMissing) return
    let live = true
    const t = setTimeout(() => {
      AsyncStorage.getItem(MISSING_KEY(st.me, wk.weekStart))
        .then((v) => { if (live && v !== missingId) setShowMissing(true) })
        .catch(() => {})
    }, 600)
    return () => { live = false; clearTimeout(t) }
  }, [missingId, setup, deciding, introSeen, sheet, mode, showMissing, st.me, wk.weekStart])
  const closeMissing = () => {
    setShowMissing(false)
    AsyncStorage.setItem(MISSING_KEY(st.me, wk.weekStart), missingId).catch(() => {})
  }
  const joinInstead = async (c: GymClass) => {
    closeMissing()
    if (await requestExtra(c.id)) {
      setTimeout(() => Alert.alert("Request sent", `${classLabel(c)}. Your coach answers before the class.`), 500)
    }
  }

  const toneFor = (c: GymClass) => {
    const e = entryFor(c.id)
    if (e) return e.state === "skip" ? "skip" : e.state === "pending" ? "pending" : "mine"
    if (headcount(c, week) >= CAPACITY) return "full"
    if (mode?.kind === "move" && fits(c, mode.from)) return "pick"
    return "other"
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
          text="Blocked"
        />
      ))}
      {wk.classes.filter((c) => c.day === day).map((c) => {
        const e = entryFor(c.id)
        const names = [...(e && e.state !== "skip" ? ["You"] : []), ...c.roster]
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
  const saveUsual = async (slots: string[]) => {
    if (await saveUsualClasses(slots)) {
      setFixedAnswer(st.me, null)
      setEditing(false)
    }
  }
  const answerNo = () => {
    setFixedAnswer(st.me, "no")
    setEditing(false)
  }
  // The "I can't go" options that still have somewhere to go.
  const canMove = !!cantId && wk.classes.some((c) => !entryFor(c.id) && headcount(c, week) < CAPACITY && fits(c, cantId))
  const canPropose = !!cantId && daysFor(cantId).length > 0

  return (
    <ScreenGradient>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {!setup && !deciding && <FeatureIntro
          id="class-week-v2"
          pages={[
            { icon: "people", title: "See who's going", text: "Your classes are green. Tap any class to see who's in it. Each class has room for 4." },
            { icon: "swap-horizontal", title: "Missed a class? Make it up", text: "Tell your coach early so someone else can take your spot. Then pick another class this week, or propose a new time (never the day before or after another class). If you can't make it up this week, move it to a later week, up to 2 per package." },
            { icon: "checkmark-done", title: "Your coach approves", text: "Changes show in yellow until your coach answers. No answer before the class means no change." },
          ]}
        />}
        <SubScreenHeader
          title={nextWeek ? "Next week" : "This week"}
          subtitle={st.pkg ? `${st.pkg.left} sessions left · use by ${st.pkg.useBy}` : "No package yet. Ask your coach."}
          right={setup ? undefined : <IntroButton id="class-week-v2" />}
        />
        {setup ? (
          <UsualSetup
            initial={st.defaults}
            classes={wk.classes}
            busy={st.busy}
            askFirst={!editing}
            onNo={answerNo}
            onSave={saveUsual}
            onCancel={() => setEditing(false)}
          />
        ) : (<>
        <View style={s.top}>
          {st.status !== "ready" ? (
            st.status === "error"
              ? <Pressable onPress={() => refreshClassSchedule()}><Text style={s.note}>Couldn&apos;t load the classes. Tap to try again.</Text></Pressable>
              : <ActivityIndicator color={C.green} />
          ) : !wk.published ? (
            <Text style={s.note}>Your coach hasn&apos;t published this week&apos;s classes yet.</Text>
          ) : mode ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>
                {mode.kind === "move" ? "Pick a class with the yellow outline" : "Tap a bright day near the time you want"}
              </Text>
              <Pressable hitSlop={8} onPress={() => { setMode(null); setDraft(null) }}>
                <Text style={s.bannerCancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.usualRow}>
              <Text style={s.link} numberOfLines={1}>
                {st.defaults.length
                  ? `Fixed schedule: ${st.defaults.map((k) => parseSlot(k)).filter(Boolean).map((c) => classLabel(c!)).join(", ")}`
                  : "No fixed schedule: tap a class to join it"}
              </Text>
              <Pressable style={s.pill} hitSlop={6} onPress={() => setEditing(true)}>
                <Ionicons name="create-outline" size={14} color={C.green} />
                <Text style={s.pillText}>{st.defaults.length ? "Change" : "Set one"}</Text>
              </Pressable>
            </View>
          )}
          {st.status === "ready" && wk.published && !mode && <Legend />}
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
        </>)}
      </SafeAreaView>

      <Sheet
        visible={showMissing && !setup}
        title="No class at your usual time"
        subtitle={`Your coach has no class ${missing.map(classLabel).join(" or ")} this week.`}
        onClose={closeMissing}
      >
        {joinable.length ? (
          <>
            <Text style={s.lead}>These are this week&apos;s classes with room. Tap one to ask your coach for it:</Text>
            {joinable.slice(0, 6).map((c) => (
              <SheetOption
                key={c.id}
                title={`${classLabel(c)} – ${formatTime(c.start + CLASS_HOURS)}`}
                detail={`${headcount(c, week)} of ${CAPACITY} climbers`}
                onPress={() => joinInstead(c)}
              />
            ))}
          </>
        ) : (
          <Text style={s.lead}>There&apos;s no class with room this week that leaves a rest day around your other classes. Ask your coach.</Text>
        )}
        <SheetButton kind="line" label="Not now" onPress={closeMissing} />
      </Sheet>

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

// What the colours on the week mean.
function Legend() {
  const items: [string, object][] = [
    ["Yours", { backgroundColor: C.green }],
    ["Others", { backgroundColor: "#2F3A35", borderWidth: 1, borderColor: "rgba(111,207,151,0.45)" }],
    ["Waiting", { backgroundColor: C.yellow }],
    ["Full", { backgroundColor: "#26282A", borderWidth: 1, borderColor: C.border }],
  ]
  return (
    <View style={s.legend}>
      {items.map(([label, style]) => (
        <View key={label} style={s.legendItem}>
          <View style={[s.swatch, style]} />
          <Text style={s.legendText}>{label}</Text>
        </View>
      ))}
    </View>
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
  bannerText: { flex: 1, color: C.yellow, fontSize: 15, fontWeight: "700" },
  bannerCancel: { color: C.textPrimary, fontSize: 15, fontWeight: "700" },
  bannerSave: { color: C.green, fontSize: 13, fontWeight: "800" },
  link: { flex: 1, color: C.textPrimary, fontSize: 14, fontWeight: "600" },
  lead: { fontSize: 14, color: C.textPrimary, lineHeight: 20 },
  legend: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  usualRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: "rgba(111,207,151,0.45)",
    backgroundColor: "rgba(111,207,151,0.10)", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12,
  },
  pillText: { color: C.green, fontSize: 13, fontWeight: "800" },
  warn: {
    fontSize: 13, lineHeight: 19, color: C.yellow, backgroundColor: "rgba(254,215,102,0.08)",
    borderRadius: 12, padding: 12, overflow: "hidden",
  },
  note: { fontSize: 14, color: C.textPrimary, fontWeight: "600" },
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
