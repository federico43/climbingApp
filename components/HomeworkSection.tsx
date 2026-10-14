import { C } from "@/utils/theme"
import { ADAPTATION_COLOR } from "@/utils/adaptations"
import { getSessions, type ProtocolRow, type SessionRow } from "@/services/BoulderGraphService"
import {
  cantAttendHomework,
  reconcileHomeworkReminders,
  scheduleHomework,
  subscribeHomeworkIntent,
  takeHomeworkIntent,
  type HomeworkIntent,
} from "@/services/homework"
import {
  atLocal, daysToPick, dueByOf, homeworkStatus, shortDay, timeLabel, type HomeworkStatus,
} from "@/utils/homework"
import { addDays, localDateStr } from "@/utils/planRotation"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

// The athlete's homework (docs/training-plan-implementation.md §10): a card
// per open homework with Pick a day / Move, I can't attend and Start; the
// "You've got homework" prompt the first time one shows up; the day + time
// picker; and the can't-attend message box. Also keeps this phone's
// reminders in step with the rows, and acts on tapped notifications
// (services/homework.ts intents).

const PROMPTED_KEY = "homework:prompted"
const OVERDUE_SHOWN_DAYS = 7
const DEFAULT_HOUR = 18

export function HomeworkSection({
  homework,
  sessions: sessionsProp,
  onStart,
  onChanged,
}: {
  homework: ProtocolRow[]
  sessions?: SessionRow[] | null // fetched here when not given
  onStart: (hw: ProtocolRow) => void
  onChanged: () => void
}) {
  const [ownSessions, setOwnSessions] = useState<SessionRow[] | null>(null)
  useEffect(() => {
    if (sessionsProp) return
    getSessions().then(setOwnSessions).catch(() => setOwnSessions([]))
  }, [sessionsProp, homework])
  const sessions = sessionsProp ?? ownSessions

  const today = localDateStr(new Date())
  const items = useMemo(() => {
    if (!sessions) return []
    return homework
      .map((hw) => ({ hw, status: homeworkStatus(hw, sessions, today) }))
      .filter(({ hw, status }) => status.state !== "done"
        && (status.state !== "overdue" || today <= addDays(dueByOf(hw), OVERDUE_SHOWN_DAYS)))
      .sort((a, b) => dueByOf(a.hw).localeCompare(dueByOf(b.hw)))
  }, [homework, sessions, today])

  // This phone's reminders follow the rows.
  useEffect(() => {
    if (sessions) reconcileHomeworkReminders(homework, sessions)
  }, [homework, sessions])

  const [scheduling, setScheduling] = useState<ProtocolRow | null>(null)
  const [declining, setDeclining] = useState<ProtocolRow | null>(null)
  const [prompt, setPrompt] = useState<ProtocolRow | null>(null)

  // "You've got homework" — once per homework, for ones without a day yet.
  useEffect(() => {
    let cancelled = false
    const fresh = items.filter((i) => i.status.state === "not_scheduled").map((i) => i.hw)
    if (fresh.length === 0) return
    AsyncStorage.getItem(PROMPTED_KEY).then((raw) => {
      let seen: string[] = []
      try { seen = raw ? JSON.parse(raw) : [] } catch {}
      const next = fresh.find((hw) => !seen.includes(hw.$id))
      if (!cancelled && next) setPrompt(next)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [items])

  function closePrompt(then?: () => void) {
    const id = prompt?.$id
    setPrompt(null)
    if (id) {
      AsyncStorage.getItem(PROMPTED_KEY).then((raw) => {
        let seen: string[] = []
        try { seen = raw ? JSON.parse(raw) : [] } catch {}
        return AsyncStorage.setItem(PROMPTED_KEY, JSON.stringify([...seen.filter((x) => x !== id), id].slice(-50)))
      }).catch(() => {})
    }
    then?.()
  }

  // A tapped notification: open what it asks for once its homework is here.
  const [intent, setIntent] = useState<HomeworkIntent | null>(null)
  useEffect(() => subscribeHomeworkIntent(setIntent), [])
  useEffect(() => {
    if (!intent) return
    const item = items.find((i) => i.hw.$id === intent.homeworkId)
    if (!item && !sessions) return // still loading
    takeHomeworkIntent()
    setIntent(null)
    if (!item) return // done or gone
    const open = item.status.state === "not_scheduled" || item.status.state === "missed" || item.status.state === "cant_attend"
    if (intent.action === "cant_attend") setDeclining(item.hw)
    else if (intent.action === "reschedule" || open) setScheduling(item.hw)
  }, [intent, items, sessions])

  if (items.length === 0) {
    return <PromptModal hw={prompt} onClose={() => closePrompt()} onPick={() => closePrompt(() => setScheduling(prompt))} />
  }

  return (
    <>
      <View style={s.card}>
        <View style={s.headerRow}>
          <Ionicons name="school-outline" size={16} color={ADAPTATION_COLOR.test} />
          <Text style={s.title}>Homework</Text>
        </View>
        {items.map(({ hw, status }) => (
          <HomeworkItem
            key={hw.$id}
            hw={hw}
            status={status}
            today={today}
            onPick={() => setScheduling(hw)}
            onDecline={() => setDeclining(hw)}
            onStart={() => onStart(hw)}
          />
        ))}
      </View>

      <PromptModal hw={prompt} onClose={() => closePrompt()} onPick={() => closePrompt(() => setScheduling(prompt))} />
      {scheduling && (
        <ScheduleModal hw={scheduling} today={today} onClose={() => setScheduling(null)} onSaved={() => { setScheduling(null); onChanged() }} />
      )}
      {declining && (
        <CantAttendModal
          hw={declining}
          today={today}
          onClose={(changed) => { setDeclining(null); if (changed) onChanged() }}
          onPick={() => { const hw = declining; setDeclining(null); onChanged(); setScheduling(hw) }}
        />
      )}
    </>
  )
}

function statusLine(hw: ProtocolRow, status: HomeworkStatus, today: string): { text: string; color: string } {
  const due = dueByOf(hw)
  const daysLeft = daysToPick(today, due).length > 0
  switch (status.state) {
    case "scheduled": {
      const when = new Date(hw.scheduledFor!)
      const day = status.date === today ? "Today" : status.date === addDays(today, 1) ? "Tomorrow" : shortDay(status.date!)
      return { text: `${day} at ${timeLabel(when)}`, color: C.green }
    }
    case "missed":
      return { text: `Missed ${shortDay(status.date!)} — pick another day before ${shortDay(due)}`, color: C.yellow }
    case "cant_attend":
      return daysLeft
        ? { text: `You can't make it — pick another day before ${shortDay(due)}`, color: C.yellow }
        : { text: "Your coach knows you can't make it", color: C.textSecondary }
    case "overdue":
      return { text: `Overdue since ${shortDay(due)}`, color: C.red }
    default:
      return { text: `Pick a day before ${shortDay(due)}`, color: C.textSecondary }
  }
}

function HomeworkItem({ hw, status, today, onPick, onDecline, onStart }: {
  hw: ProtocolRow; status: HomeworkStatus; today: string
  onPick: () => void; onDecline: () => void; onStart: () => void
}) {
  const line = statusLine(hw, status, today)
  const canPick = daysToPick(today, dueByOf(hw)).length > 0
  const scheduled = status.state === "scheduled" || status.state === "missed"
  return (
    <View style={s.item}>
      <Text style={s.itemName} numberOfLines={1}>{hw.name}</Text>
      <Text style={[s.itemLine, { color: line.color }]}>{line.text}</Text>
      <View style={s.actions}>
        {canPick && (
          <Pressable style={s.btn} onPress={onPick} hitSlop={4}>
            <Ionicons name="calendar-outline" size={14} color={C.textPrimary} />
            <Text style={s.btnText}>{status.state === "scheduled" ? "Move" : "Pick a day"}</Text>
          </Pressable>
        )}
        {scheduled && (
          <Pressable style={s.btn} onPress={onDecline} hitSlop={4}>
            <Text style={s.btnText}>{"I can't attend"}</Text>
          </Pressable>
        )}
        <Pressable style={[s.btn, s.btnPrimary]} onPress={onStart} hitSlop={4}>
          <Ionicons name="play" size={13} color={C.bg} />
          <Text style={[s.btnText, { color: C.bg }]}>Start</Text>
        </Pressable>
      </View>
    </View>
  )
}

function PromptModal({ hw, onClose, onPick }: { hw: ProtocolRow | null; onClose: () => void; onPick: () => void }) {
  return (
    <Modal visible={!!hw} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Ionicons name="school-outline" size={28} color={ADAPTATION_COLOR.test} />
          <Text style={s.sheetTitle}>{"You've got homework"}</Text>
          {hw && (
            <Text style={s.sheetText}>
              <Text style={{ fontWeight: "800", color: C.textPrimary }}>{hw.name}</Text>
              {` from your coach. Pick a day to do it before ${shortDay(dueByOf(hw))} and we'll remind you.`}
            </Text>
          )}
          <Pressable style={s.primary} onPress={onPick}>
            <Text style={s.primaryText}>Pick a day</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8}><Text style={s.secondaryText}>Later</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function ScheduleModal({ hw, today, onClose, onSaved }: {
  hw: ProtocolRow; today: string; onClose: () => void; onSaved: () => void
}) {
  const days = daysToPick(today, dueByOf(hw))
  const prev = hw.scheduledFor ? new Date(hw.scheduledFor) : null
  const prevDay = prev ? localDateStr(prev) : null
  const [day, setDay] = useState(prevDay && days.includes(prevDay) ? prevDay : days[0])
  const [minutes, setMinutes] = useState(prev ? prev.getHours() * 60 + prev.getMinutes() : DEFAULT_HOUR * 60)
  const [saving, setSaving] = useState(false)
  const step = (by: number) => setMinutes((m) => (m + by + 24 * 60) % (24 * 60))
  const when = day ? atLocal(day, Math.floor(minutes / 60), minutes % 60) : null

  async function save() {
    if (!day || !when) return
    if (when.getTime() < Date.now()) {
      Alert.alert("That time has passed", "Pick a later time or another day.")
      return
    }
    setSaving(true)
    try {
      await scheduleHomework(hw.$id, when, day, `${shortDay(day)}, ${timeLabel(when)}`)
      onSaved()
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again.")
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Text style={s.sheetTitle}>When will you do it?</Text>
          <Text style={s.sheetText}>{hw.name} · before {shortDay(dueByOf(hw))}</Text>
          {days.length === 0 ? (
            <Text style={s.sheetText}>The deadline has passed — talk to your coach.</Text>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.daysScroll} contentContainerStyle={s.days}>
                {days.map((d) => {
                  const sel = d === day
                  const [wd, dn] = shortDay(d).split(" ")
                  return (
                    <Pressable key={d} style={[s.day, sel && s.daySel]} onPress={() => setDay(d)}>
                      <Text style={[s.dayWd, sel && { color: C.bg }]}>{d === today ? "Today" : wd}</Text>
                      <Text style={[s.dayNum, sel && { color: C.bg }]}>{dn}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
              <View style={s.timeRow}>
                <TimeStep label="−1 h" onPress={() => step(-60)} />
                <TimeStep label="−15" onPress={() => step(-15)} />
                <Text style={s.time}>{when ? timeLabel(when) : ""}</Text>
                <TimeStep label="+15" onPress={() => step(15)} />
                <TimeStep label="+1 h" onPress={() => step(60)} />
              </View>
              <Text style={s.hint}>{"We'll remind you the day before and 1 hour before."}</Text>
              <Pressable style={[s.primary, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color={C.bg} /> : <Text style={s.primaryText}>Save</Text>}
              </Pressable>
            </>
          )}
          <Pressable onPress={onClose} hitSlop={8}><Text style={s.secondaryText}>Cancel</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function TimeStep({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={s.timeStep} onPress={onPress} hitSlop={4}>
      <Text style={s.timeStepText}>{label}</Text>
    </Pressable>
  )
}

// "I can't attend": a short message → the coach is told. Then, with days
// left before the deadline the athlete picks another one; without, it's
// the coach's call (coach 2026-10-07).
function CantAttendModal({ hw, today, onClose, onPick }: {
  hw: ProtocolRow; today: string; onClose: (changed: boolean) => void; onPick: () => void
}) {
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const due = dueByOf(hw)
  // Days left that aren't the one they just said no to.
  const missedDay = hw.scheduledFor ? localDateStr(new Date(hw.scheduledFor)) : null
  const left = daysToPick(today, due).filter((d) => d !== missedDay)

  async function send() {
    setSending(true)
    try {
      await cantAttendHomework(hw.$id, note)
      setSent(true)
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message ?? "Try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onClose(sent)}>
      <Pressable style={s.backdrop} onPress={() => onClose(sent)}>
        <Pressable style={s.sheet} onPress={() => {}}>
          {!sent ? (
            <>
              <Text style={s.sheetTitle}>{"Can't make it?"}</Text>
              <Text style={s.sheetText}>Your coach will be notified. Want to tell them why?</Text>
              <TextInput
                style={s.input}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Sick, work trip… (optional)"
                placeholderTextColor={C.textMuted}
                multiline
                maxLength={300}
              />
              <Pressable style={[s.primary, sending && { opacity: 0.6 }]} onPress={send} disabled={sending}>
                {sending ? <ActivityIndicator color={C.bg} /> : <Text style={s.primaryText}>Send</Text>}
              </Pressable>
              <Pressable onPress={() => onClose(false)} hitSlop={8}><Text style={s.secondaryText}>Cancel</Text></Pressable>
            </>
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={30} color={C.green} />
              <Text style={s.sheetTitle}>Your coach will be notified</Text>
              {left.length > 0 ? (
                <>
                  <Text style={s.sheetText}>You still have until {shortDay(due)}. Pick another day?</Text>
                  <Pressable style={s.primary} onPress={onPick}>
                    <Text style={s.primaryText}>Pick another day</Text>
                  </Pressable>
                  <Pressable onPress={() => onClose(true)} hitSlop={8}><Text style={s.secondaryText}>Not now</Text></Pressable>
                </>
              ) : (
                <>
                  <Text style={s.sheetText}>{"There are no days left before the deadline — your coach will decide what's next."}</Text>
                  <Pressable style={s.primary} onPress={() => onClose(true)}>
                    <Text style={s.primaryText}>OK</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: `${ADAPTATION_COLOR.test}55`,
    padding: 16, gap: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  item: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  itemName: { fontSize: 16, fontWeight: "800", color: C.textPrimary },
  itemLine: { fontSize: 13, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.surfaceHigh,
  },
  btnPrimary: { backgroundColor: C.green, marginLeft: "auto" },
  btnText: { fontSize: 13, fontWeight: "700", color: C.textPrimary },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: C.surface, borderRadius: 20, padding: 20, gap: 12, alignItems: "center" },
  sheetTitle: { fontSize: 19, fontWeight: "800", color: C.textPrimary, textAlign: "center" },
  sheetText: { fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 20 },
  primary: { alignSelf: "stretch", backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  primaryText: { fontSize: 15, fontWeight: "800", color: C.bg },
  secondaryText: { fontSize: 14, fontWeight: "700", color: C.textSecondary, paddingVertical: 4 },

  daysScroll: { alignSelf: "stretch", flexGrow: 0 },
  days: { gap: 8, paddingVertical: 4 },
  day: {
    width: 58, paddingVertical: 10, borderRadius: 12, alignItems: "center", gap: 2,
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
  },
  daySel: { backgroundColor: C.green, borderColor: C.green },
  dayWd: { fontSize: 11, fontWeight: "700", color: C.textSecondary },
  dayNum: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  time: { fontSize: 22, fontWeight: "800", color: C.textPrimary, minWidth: 96, textAlign: "center", fontVariant: ["tabular-nums"] },
  timeStep: { paddingHorizontal: 9, paddingVertical: 8, borderRadius: 10, backgroundColor: C.surfaceHigh },
  timeStepText: { fontSize: 12, fontWeight: "700", color: C.textPrimary },
  hint: { fontSize: 12, color: C.textMuted, textAlign: "center" },
  input: {
    alignSelf: "stretch", minHeight: 80, backgroundColor: C.surfaceHigh, borderRadius: 12,
    padding: 12, fontSize: 15, color: C.textPrimary, textAlignVertical: "top",
  },
})
