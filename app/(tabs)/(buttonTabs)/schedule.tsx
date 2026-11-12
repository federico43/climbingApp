import { useAuth } from "@/components/auth-context"

import { Sheet, SheetButton, SheetOption } from "@/components/schedule/Sheet"
import { IntroButton, useIntroSeen } from "@/components/schedule/FeatureIntro"
import { SpotlightTour, TourSpot } from "@/components/schedule/SpotlightTour"
import { UsualSetup } from "@/components/schedule/UsualSetup"
import { GridBlock, HOUR_HEIGHT, Tone, WeekGrid } from "@/components/schedule/WeekGrid"
import {
  CalendarHeader, DAYS_LONG, Legend, OpenSpot, PersonRow, RepeatChoice, longDay, monthName,
} from "@/components/schedule/CalendarBits"
import {
  AddClassProblem, CAPACITY, CHANGE_DEADLINE_H, MAX_CARRY, WEEK_DAYS, CLASS_HOURS, CLASSES_PER_DAY, GRID_END, GRID_START, GymClass, athleteWeek, busyDays, classDate, classLabel, formatTime,
  classesToJoin, headcount, missingUsual, proposeProblem,
  dateOf, openDays, parseSlot, restDayOk, slotKey, startFromOffset, usualFits, weekDates, weekdayOf,
} from "@/utils/classSchedule"
import { cancelExtra, changeClass, joinClass, refreshClassSchedule, saveUsualClasses, stopUsual, useClassSchedule } from "@/utils/classScheduleStore"
import { setFixedAnswer, useFixedAnswer } from "@/utils/fixedScheduleAnswer"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { K as C, KF } from "@/components/schedule/calTheme"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect, useRouter } from "expo-router"
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

// The athlete's week of classes, laid out like Google Calendar, opened from
// the "This week" card on Plan. Tap a class with a free spot to join it (just
// this week or every week); tap one of yours if you can't go.
export default function ScheduleScreen() {
  const { userName } = useAuth()
  const me = userName || "you"
  const st = useClassSchedule()
  const router = useRouter()
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
  // The fixed-schedule screen: shown until the athlete answers, and from "Change".
  const answer = useFixedAnswer(st.me)
  const [editing, setEditing] = useState(false)
  const setup = editing || (st.status === "ready" && !st.defaults.length && answer === null)
  // Still finding out whether to show it: hold the intro pop-up back meanwhile.
  const deciding = !st.defaults.length && (st.status !== "ready" || answer === undefined)
  const introSeen = useIntroSeen("class-week-tour")
  const [sheet, setSheet] = useState<{ kind: "class"; id: string } | { kind: "book" } | null>(null)
  // Move mode: the class picked to move to, confirmed with the bottom button.
  const [moveTo, setMoveTo] = useState<string | null>(null)
  // The time picked for a proposal, still to be adjusted and sent.
  const [draft, setDraft] = useState<{ day: number; start: number } | null>(null)

  const entryFor = (id: string) => week.find((e) => e.cls.id === id)
  const started = (c: { day: number; start: number }) => !!wk.weekStart && classDate(wk.weekStart, c).getTime() <= Date.now()
  const fits = (c: { day: number; start: number }, except?: string) => !started(c) && restDayOk(busyDays(week, except), c.day)
  const hasClasses = week.some((e) => e.state !== "skip")
  // Changes are free until CHANGE_DEADLINE_H before the class; after that
  // they're requests to the coach.
  const deadlineOf = (c: { day: number; start: number }) => new Date(classDate(wk.weekStart, c).getTime() - CHANGE_DEADLINE_H * 3600000)
  const lateFor = (c: { day: number; start: number }) => !!wk.weekStart && deadlineOf(c).getTime() <= Date.now()

  // Usual times still ahead with no class this week → offer the ones there are.
  const missing = wk.published && !wk.extra ? missingUsual(st.defaults, wk.classes, week, today) : []
  const joinable = missing.length ? classesToJoin(wk.classes, week, today, missing[0]).filter((c) => !started(c)) : []
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
    if (await joinClass(c.id, c, false)) {
      setTimeout(() => Alert.alert("You're in", `${classLabel(c)} – ${formatTime(c.start + CLASS_HOURS)}.`), 500)
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

  const movingFrom = mode?.kind === "move" ? mode.from : null
  const validTarget = (c: GymClass) => !!movingFrom && !entryFor(c.id) && headcount(c, week) < CAPACITY && fits(c, movingFrom)
  const toneFor = (c: GymClass): Tone => {
    if (movingFrom) {
      if (c.id === moveTo) return "new"
      if (c.id === movingFrom) return "skip"
      if (validTarget(c)) return "pick"
    }
    const e = entryFor(c.id)
    if (e) return e.state === "skip" ? "skip" : e.state === "pending" ? "pending" : "mine"
    if (headcount(c, week) >= CAPACITY) return "full"
    return !mode && fits(c) ? "open" : "other"
  }
  // What a block says, first line first (spec: state word, then time).
  const blockLines = (c: GymClass, tone: Tone): string[] => {
    const time = formatTime(c.start)
    const free = CAPACITY - headcount(c, week)
    if (tone === "new") return ["New", time]
    if (movingFrom && c.id === movingFrom) return ["From", time]
    if (tone === "mine") return ["You", time, ...(st.defaults.includes(slotKey(c)) ? ["·Fixed"] : []), ...c.roster]
    if (tone === "pending") return ["Pending", time]
    if (tone === "skip") return ["Not going", time]
    if (tone === "full") return ["Full", time, ...c.roster]
    if (tone === "open" || tone === "pick") return ["Open", time, `·${free} left`, ...c.roster]
    return [time, ...c.roster]
  }
  const blockLabel = (c: GymClass, tone: Tone) =>
    `${longDay(dates, c.day)}, ${formatTime(c.start)} to ${formatTime(c.start + CLASS_HOURS)}, ${
      tone === "mine" ? "your class" : tone === "full" ? "full" : tone === "pending" ? "waiting for your coach" : `${CAPACITY - headcount(c, week)} spots left`
    }, ${headcount(c, week)} of ${CAPACITY} booked`

  const renderDay = (day: number) => (
    <>
      {/* The coach's blocked times: nothing can be proposed there. */}
      {wk.blocks.filter((b) => b.day === day).map((b, i) => (
        <GridBlock
          key={`b${i}`}
          start={b.all ? GRID_START : b.start}
          hours={b.all ? GRID_END - GRID_START : b.end - b.start}
          tone="blocked"
          text="BLOCKED"
          label="Coach away"
        />
      ))}
      {wk.classes.filter((c) => c.day === day).map((c) => {
        const tone = toneFor(c)
        return (
          <GridBlock
            key={c.id}
            start={c.start}
            tone={tone}
            text={blockLines(c, tone).join("\n")}
            label={blockLabel(c, tone)}
            faded={!!movingFrom && tone !== "pick" && tone !== "new" && c.id !== movingFrom}
            onPress={() => {
              if (!movingFrom) return setSheet({ kind: "class", id: c.id })
              if (validTarget(c)) setMoveTo(c.id)
            }}
          />
        )
      })}
      {week.filter((e) => e.proposal && e.cls.day === day).map((e) => (
        <GridBlock
          key={e.cls.id}
          start={e.cls.start}
          tone="pending"
          text={`Pending\n${formatTime(e.cls.start)}\n·proposed`}
          onPress={() => e.from && setSheet({ kind: "class", id: e.from })}
        />
      ))}
      {draft?.day === day && <GridBlock start={draft.start} tone="pick" text={formatTime(draft.start)} />}
    </>
  )

  const proposingFrom = mode?.kind === "propose" ? mode.from : null
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
  // Where one of your classes can go: an open class, or a new time.
  const canMoveFrom = (id: string) => wk.classes.some((c) => !entryFor(c.id) && headcount(c, week) < CAPACITY && fits(c, id))
  const canProposeFrom = (id: string) => daysFor(id).length > 0
  const exitMode = () => { setMode(null); setDraft(null); setMoveTo(null) }
  const moveFromClass = movingFrom ? wk.classes.find((c) => c.id === movingFrom) ?? null : null
  const moveToClass = moveTo ? wk.classes.find((c) => c.id === moveTo) ?? null : null
  const confirmMove = async () => {
    if (!movingFrom || !moveToClass) return
    const to = moveToClass
    const late = !!moveFromClass && lateFor(moveFromClass)
    exitMode()
    if (await changeClass(movingFrom, { status: "move", to: to.id })) {
      Alert.alert(
        late ? "Sent to your coach" : "Moved",
        late
          ? `Less than ${CHANGE_DEADLINE_H} h before your class, so your coach confirms. You keep your class until then.`
          : `You're in ${longDay(dates, to.day)} at ${formatTime(to.start)}. This week only, your usual classes stay.`,
      )
    }
  }
  const openToBook = wk.classes.filter((c) => !entryFor(c.id) && headcount(c, week) < CAPACITY && fits(c))
  const booked = week.filter((e) => e.state === "on").length
  const pendingN = week.filter((e) => e.state === "pending").length
  const usualText = st.defaults.map((k) => parseSlot(k)).filter(Boolean).map((c) => classLabel(c!)).join(" · ")
  const openCount = openToBook.length

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <SpotlightTour
          id="class-week-tour"
          ready={!setup && !deciding && st.status === "ready"}
          steps={[
            { target: "a-header", title: "Your week", text: "It works like a calendar. Use ‹ › to switch between this week and next, and Today to come back." },
            { target: "a-grid", title: "Tap Open to join", text: "Solid mint classes are yours. A class that says Open has a free spot: tap it, choose just this week or every week, and you're in." },
            { target: "a-grid", title: "Can't go? Tap your class", text: `Move it to an open class, propose another time, or cancel it. Changes are free until ${CHANGE_DEADLINE_H} h before the class; after that your coach decides.` },
            { target: "a-top", title: "Your fixed times", text: "The classes you go to every week. Change them here whenever your schedule changes." },
            { target: "a-fab", title: "Book in one tap", text: "The + lists every open class that fits around yours." },
            { target: "a-legend", title: "What the colours mean", text: "Mint is yours, dashed means waiting for your coach, hatched means full or blocked." },
            { target: "a-info", title: "See this again", text: "Tap here any time to replay this tour." },
          ]}
        />
        <TourSpot name="a-header">
        <CalendarHeader
          title={monthName(dates)}
          onBack={() => router.back()}
          week={nextWeek ? "next" : "this"}
          canNext={!!st.nextWeek}
          onWeek={(w) => { setPick(w); exitMode() }}
          right={setup ? undefined : <TourSpot name="a-info"><IntroButton id="class-week-tour" /></TourSpot>}
          summary={[
            `${booked} booked`,
            ...(pendingN ? [`${pendingN} pending`] : []),
            st.pkg ? `${st.pkg.left} sessions left` : "No package",
          ].join(" · ")}
        />
        </TourSpot>
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
        <TourSpot name="a-top" style={s.top}>
          {st.status !== "ready" ? (
            st.status === "error"
              ? <Pressable onPress={() => refreshClassSchedule()}><Text style={s.note}>Couldn&apos;t load the classes. Tap to try again.</Text></Pressable>
              : <ActivityIndicator color={C.green} />
          ) : !wk.published ? (
            <Text style={s.note}>Your coach hasn&apos;t published this week&apos;s classes yet.</Text>
          ) : mode ? (
            <View style={s.banner}>
              <Text style={s.bannerTitle}>{mode.kind === "move" ? "MOVE CLASS" : "PROPOSE A TIME"}</Text>
              <Text style={s.bannerText}>
                {mode.kind === "move" ? "Tap a class with a dashed mint outline. This week only, your usual classes stay." : "Tap a bright day near the time you want. Your coach confirms; you keep your class until then."}
              </Text>
              <Pressable hitSlop={8} onPress={exitMode}>
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
                    ? `Tap a class that says Open (${openCount} this week) and press Join, or use the + button.`
                    : "Every class this week is full or too close to another. Ask your coach."}
                </Text>
              </View>
            </View>
          ) : (
            <View style={s.usualRow}>
              <Ionicons name="repeat" size={15} color={C.textSecondary} />
              <Text style={s.usual} numberOfLines={1}>
                {usualText ? `Every week: ${usualText}` : "No fixed schedule"}
              </Text>
              <Pressable style={s.pill} hitSlop={6} onPress={() => setEditing(true)}>
                <Ionicons name="create-outline" size={14} color={C.green} />
                <Text style={s.pillText}>{usualText ? "Change" : "Set one"}</Text>
              </Pressable>
            </View>
          )}
        </TourSpot>
        <TourSpot name="a-grid" style={{ flex: 1 }}>
        <WeekGrid
          dates={dates}
          today={nextWeek ? -1 : today}
          dimPast
          dimDays={proposingFrom ? [0, 1, 2, 3, 4, 5, 6].filter((d) => d >= today && !proposeDays.includes(d)) : []}
          onPressTime={proposingFrom ? proposeAt : undefined}
          onRefresh={refreshClassSchedule}
          renderDay={renderDay}
        />
        </TourSpot>
        {movingFrom ? (
          <View style={s.moveBar}>
            <View style={s.fromTo}>
              <View style={[s.ft, s.ftFrom]}>
                <Text style={s.ftLabel}>FROM</Text>
                <Text style={s.ftText}>{moveFromClass ? `${WEEK_DAYS[moveFromClass.day]} ${dates[moveFromClass.day].getDate()} · ${formatTime(moveFromClass.start)}` : "–"}</Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={C.textMuted} />
              <View style={[s.ft, s.ftTo, moveToClass && { borderStyle: "solid" }]}>
                <Text style={s.ftLabel}>TO</Text>
                <Text style={s.ftText}>{moveToClass ? `${WEEK_DAYS[moveToClass.day]} ${dates[moveToClass.day].getDate()} · ${formatTime(moveToClass.start)}` : "Pick a class"}</Text>
              </View>
            </View>
            <SheetButton
              label={moveToClass ? `Move to ${WEEK_DAYS[moveToClass.day]} ${dates[moveToClass.day].getDate()} · ${formatTime(moveToClass.start)}` : "Pick a class to move to"}
              disabled={!moveToClass || st.busy}
              onPress={confirmMove}
            />
          </View>
        ) : (
          <TourSpot name="a-legend"><Legend keys={["mine", "open", "full", "pending", "blocked"]} /></TourSpot>
        )}
        </>)}
      </SafeAreaView>

      {/* Book an open class (Google Calendar's "+"). */}
      {!setup && !mode && wk.published && st.status === "ready" && (
        <TourSpot name="a-fab" style={s.fab}>
          <Pressable style={s.fabIn} onPress={() => setSheet({ kind: "book" })} accessibilityLabel="Book an open class">
            <Ionicons name="add" size={30} color={C.onMint} />
          </Pressable>
        </TourSpot>
      )}
      <Sheet visible={sheet?.kind === "book"} title="Book an open class" subtitle="Classes with a free spot that leave a rest day around yours." onClose={() => setSheet(null)}>
        {openToBook.length ? openToBook.map((c) => (
          <SheetOption
            key={c.id}
            title={`${longDay(dates, c.day)} · ${formatTime(c.start)} – ${formatTime(c.start + CLASS_HOURS)}`}
            detail={`${CAPACITY - headcount(c, week)} of ${CAPACITY} spots left${c.roster.length ? ` · ${c.roster.join(", ")}` : ""}`}
            onPress={() => {
              setSheet(null)
              // iOS won't present a sheet while the previous one is still closing.
              setTimeout(() => setSheet({ kind: "class", id: c.id }), 400)
            }}
          />
        )) : <Text style={s.lead}>No open class fits this week. Ask your coach.</Text>}
      </Sheet>

      <Sheet
        visible={showMissing && !setup}
        title="No class at your usual time"
        subtitle={`Your coach has no class ${missing.map(classLabel).join(" or ")} this week.`}
        onClose={closeMissing}
      >
        {joinable.length ? (
          <>
            <Text style={s.lead}>These classes this week have room. Tap one to join it:</Text>
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
        dates={dates}
        defaults={st.defaults}
        busy={st.busy}
        started={started}
        late={lateFor}
        deadline={(c) => { const d = deadlineOf(c); return `${WEEK_DAYS[(d.getDay() + 6) % 7]} ${formatTime(d.getHours() + d.getMinutes() / 60)}` }}
        changedAway={sheet?.kind === "class" && ["move", "propose"].includes(wk.changes[sheet.id]?.status ?? "")}
        fits={fits}
        onClose={() => setSheet(null)}
        canMove={canMoveFrom}
        canPropose={canProposeFrom}
        onMove={(id) => { setSheet(null); setMoveTo(null); setMode({ kind: "move", from: id }) }}
        onPropose={(id) => { setSheet(null); setMode({ kind: "propose", from: id }) }}
        onSkip={(id) => {
          setSheet(null)
          const c = wk.classes.find((x) => x.id === id)
          const late = !!c && lateFor(c)
          Alert.alert(late ? "Ask your coach to cancel?" : "Cancel just this class?", late
            ? `It's less than ${CHANGE_DEADLINE_H} h before the class, so your coach decides. You stay in it until they answer.`
            : `Your spot goes to someone else. It moves to a later week, up to ${MAX_CARRY} per package; after that you lose it. Your coach is told.`, [
            { text: "Keep it", style: "cancel" },
            { text: late ? "Ask" : "Cancel class", style: "destructive", onPress: () => { changeClass(id, { status: "skip" }) } },
          ])
        }}
        onUndoSkip={(id) => { changeClass(id, null); setSheet(null) }}
      />

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
    </View>
  )
}

function ClassSheet({
  cls, me, week, dates, defaults, busy, started, late, deadline, changedAway, fits, canMove, canPropose, onClose, onMove, onPropose, onSkip, onUndoSkip,
}: {
  cls: GymClass | null
  me: string
  week: ReturnType<typeof athleteWeek>
  dates: Date[]
  defaults: string[]
  busy: boolean
  started: (c: GymClass) => boolean
  late: (c: GymClass) => boolean
  deadline: (c: GymClass) => string
  changedAway: boolean // the athlete asked to move this class somewhere else
  fits: (c: GymClass, except?: string) => boolean
  canMove: (id: string) => boolean
  canPropose: (id: string) => boolean
  onClose: () => void
  onMove: (id: string) => void
  onPropose: (id: string) => void
  onSkip: (id: string) => void
  onUndoSkip: (id: string) => void
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
    // Spec A6: three equal tiles. Move is instant into an open class;
    // Propose waits for the coach; Cancel is this class only.
    const mv = canMove(cls.id)
    const pr = canPropose(cls.id)
    const ask = late(cls)
    actions = (
      <>
        <View style={s.tiles}>
          <Tile icon="swap-horizontal" title="Move" text={!mv ? "No open class fits" : ask ? "Ask your coach" : "This week only, to an open class"} primary disabled={!mv} onPress={() => { setEvery(null); onMove(cls.id) }} />
          <Tile icon="time-outline" title="Propose" text={pr ? "Suggest a time, coach confirms" : "No day left with room"} disabled={!pr} onPress={() => { setEvery(null); onPropose(cls.id) }} />
          <Tile icon="close-circle-outline" title="Cancel" text={ask ? "Ask your coach" : "Just this class"} onPress={() => { setEvery(null); onSkip(cls.id) }} />
        </View>
        <Text style={s.policy}>
          {ask ? `LESS THAN ${CHANGE_DEADLINE_H} H TO GO · CHANGES NEED YOUR COACH` : `FREE CHANGES UNTIL ${deadline(cls).toUpperCase()} · ${CHANGE_DEADLINE_H} H BEFORE`}
        </Text>
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
  } else if (full) {
    actions = <Text style={s.note}>This class is full. Pick one that says Open, or ask your coach.</Text>
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
    <Sheet
      visible
      eyebrow={inIt ? (usual ? "Your fixed class" : "Your class") : full ? "Full" : "Open class"}
      poster={`${WEEK_DAYS[cls.day].toUpperCase()} ${formatTime(cls.start)}`}
      title={longDay(dates, cls.day)}
      onClose={close}
    >
      <View style={s.chips}>
        <Chip text={`${formatTime(cls.start)}–${formatTime(cls.start + CLASS_HOURS)}`} />
        {usual && <Chip text="Repeats every week" />}
        <Chip text={full ? "Full" : `${count}/${CAPACITY}`} />
      </View>
      <View>
        {inIt && <PersonRow name={me} you />}
        {cls.roster.map((u, i) => <PersonRow key={`${u}${i}`} name={u} />)}
        {Array.from({ length: Math.max(0, CAPACITY - count) }, (_, i) => <OpenSpot key={`o${i}`} />)}
      </View>
      {actions}
    </Sheet>
  )
}

function Tile({
  icon, title, text, primary, disabled, onPress,
}: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.tile, primary && s.tilePrimary, disabled && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name={icon} size={22} color={primary ? C.green : C.textPrimary} />
      <Text style={s.tileTitle}>{title}</Text>
      <Text style={s.tileText}>{text}</Text>
    </Pressable>
  )
}

const Chip = ({ text }: { text: string }) => <View style={s.chip}><Text style={s.chipText}>{text}</Text></View>

const s = StyleSheet.create({
  tiles: { flexDirection: "row", gap: 8 },
  policy: { fontFamily: KF.mono, fontSize: 10, color: C.label, letterSpacing: 0.4 },
  tile: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceHigh, padding: 12, gap: 4, minHeight: 112 },
  tilePrimary: { borderColor: C.green, backgroundColor: "rgba(138,214,162,0.08)" },
  tileTitle: { fontFamily: KF.bold, fontSize: 15, color: C.textPrimary },
  tileText: { fontFamily: KF.body, fontSize: 11.5, color: C.textSecondary, lineHeight: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontFamily: KF.mono, fontSize: 11, color: C.textSecondary },
  fab: {
    position: "absolute", right: 18, bottom: 84, width: 58, height: 58, borderRadius: 18, backgroundColor: C.green,
    alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  fabIn: { flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  moveBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  fromTo: { flexDirection: "row", alignItems: "center", gap: 8 },
  ft: { flex: 1, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", paddingHorizontal: 10, paddingVertical: 6 },
  ftFrom: { borderColor: C.textMuted },
  ftTo: { borderColor: C.green },
  ftLabel: { fontFamily: KF.mono, fontSize: 9.5, color: C.textMuted },
  ftText: { fontFamily: KF.bold, fontSize: 13, color: C.textPrimary },
  top: { paddingHorizontal: 16, gap: 10, marginBottom: 10 },
  welcome: {
    flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14,
    backgroundColor: "rgba(138,214,162,0.10)", borderWidth: 1, borderColor: "rgba(138,214,162,0.35)",
  },
  welcomeTitle: { fontSize: 16, fontWeight: "800", color: C.textPrimary },
  welcomeText: { fontSize: 13.5, color: C.textSecondary, marginTop: 2, lineHeight: 19 },
  usual: { flex: 1, fontSize: 14, color: C.textPrimary, fontWeight: "600" },
  usualRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: "rgba(138,214,162,0.45)",
    backgroundColor: "rgba(138,214,162,0.10)", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12,
  },
  pillText: { color: C.green, fontSize: 13, fontWeight: "800" },
  lead: { fontSize: 14, color: C.textPrimary, lineHeight: 20 },
  banner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
    backgroundColor: "rgba(138,214,162,0.10)", borderWidth: 1, borderColor: "rgba(138,214,162,0.35)",
    borderRadius: 12, padding: 12,
  },
  bannerTitle: { fontFamily: KF.poster, fontSize: 22, color: C.textPrimary, letterSpacing: -0.3 },
  bannerText: { flex: 1, color: C.yellow, fontSize: 13, fontWeight: "600" },
  bannerCancel: { color: C.textSecondary, fontSize: 13, fontWeight: "700" },
  warn: {
    fontSize: 13, lineHeight: 19, color: C.yellow, backgroundColor: "rgba(138,214,162,0.08)",
    borderRadius: 12, padding: 12, overflow: "hidden",
  },
  note: { fontSize: 13, color: C.textSecondary, fontWeight: "600" },
  hint: { fontSize: 12, color: C.yellow, marginTop: -4 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  step: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  stepText: { color: C.textPrimary, fontSize: 14, fontWeight: "700" },
  stepTime: { color: C.textPrimary, fontSize: 28, fontWeight: "800" },
})
