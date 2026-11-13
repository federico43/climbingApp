import { Body, Card, GhostButton, hexAlpha, MintButton, Mono, NavBar, PosterHeadline, Stepper, TextField, usePaper, usePaperStyles } from "@/components/paper"
import { loadLocalNextTasks, loadNextTasks, saveNextTasks } from "@/services/nextTasks"
import { font, PaperTheme, radius, space } from "@/theme/paper/tokens"
import {
  addTask, amountLabel, doneCount, dropStaleDone, EMPTY_TASKS, MAX_AMOUNT, MAX_TASKS, MAX_TEXT, newerList,
  removeTask, type NextTask, type NextTaskList, type TaskUnit,
} from "@/utils/nextTasks"
import { localDateStr } from "@/utils/planRotation"
import { Ionicons } from "@expo/vector-icons"
import { useCallback, useEffect, useRef, useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import type { EdgeInsets } from "react-native-safe-area-context"

// "For next time" tasks (utils/nextTasks.ts) in the workout flow:
//   • ForTodaySheet / ForTodayChip — the checklist at the start of the next
//     workout, reopened from the chip at any point mid-workout.
//   • NextTimeCard / NextTimeEditor — on the summary, where the athlete
//     writes what to do next session.
// The sheet and the editor are overlays inside the workout overlay, not
// <Modal>s: iOS can't stack Modals (utils/popupTurn.ts), and the workout can
// open while another pop-up is still fading out.

// ─── State ────────────────────────────────────────────────────────────────────

// The athlete's list, loaded when `reloadKey` changes (the workout starts) —
// the phone copy first, then the server's if it's newer. `update` saves
// every change on the phone and the server.
export function useNextTasks(userId: string | null, reloadKey: unknown) {
  const [list, setList] = useState<NextTaskList>(EMPTY_TASKS)
  const ref = useRef(list)

  const take = useCallback((loaded: NextTaskList) => {
    const best = dropStaleDone(newerList(ref.current, loaded), localDateStr(new Date()))
    if (best === ref.current) return
    ref.current = best
    setList(best)
  }, [])

  useEffect(() => {
    if (!userId) return
    let alive = true
    loadLocalNextTasks(userId).then((l) => { if (alive) take(l) })
    loadNextTasks(userId).then((l) => { if (alive) take(l) })
    return () => { alive = false }
  }, [userId, reloadKey, take])

  const update = useCallback((fn: (l: NextTaskList) => NextTaskList) => {
    const next = fn(ref.current)
    if (next === ref.current) return
    ref.current = next
    setList(next)
    if (userId) saveNextTasks(userId, next)
  }, [userId])

  return { list, update }
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// ─── Start of the workout: "For today" ────────────────────────────────────────

function TaskRow({ task, onToggle, onRemove, first }: {
  task: NextTask
  onToggle?: () => void
  onRemove?: () => void
  first?: boolean
}) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const done = !!task.doneOn
  const amount = amountLabel(task)
  const content = (
    <>
      {onToggle && (
        <View style={[styles.check, done && styles.checkOn]}>
          {done && <Ionicons name="checkmark" size={16} color={t.onMint} />}
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Body weight={700} size={16} style={done && styles.doneText}>{task.text}</Body>
        {amount && <Mono color={t.pink} style={{ marginTop: 3 }}>{amount}</Mono>}
      </View>
      {onRemove && (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${task.text}`}>
          <Ionicons name="close" size={20} color={t.label} />
        </Pressable>
      )}
    </>
  )
  if (!onToggle) return <View style={[styles.row, !first && styles.rowDivider]}>{content}</View>
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && { opacity: 0.7 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={amount ? `${task.text}, ${amount}` : task.text}
    >
      {content}
    </Pressable>
  )
}

// The checklist over the workout. Shown by itself when a workout starts with
// tasks waiting, and from the chip after that.
export function ForTodaySheet({ list, onToggle, onClose, insets }: {
  list: NextTaskList
  onToggle: (id: string) => void
  onClose: () => void
  insets: EdgeInsets
}) {
  const styles = usePaperStyles(makeStyles)
  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: "85%" }]}>
        <Card homework eyebrow="For today" padded={false} style={styles.sheetCard}>
          <View style={styles.sheetHead}>
            <Body weight={800} size={20}>Your homework for this session</Body>
            <Body muted size={13} style={{ marginTop: 4 }}>
              Tick each one when it&apos;s done. Do them now or in between blocks.
            </Body>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: space.cardPad }}>
            {list.tasks.map((task, i) => (
              <TaskRow key={task.id} task={task} first={i === 0} onToggle={() => onToggle(task.id)} />
            ))}
          </ScrollView>
        </Card>
        <MintButton label="Got it" onPress={onClose} style={{ marginTop: 12 }} />
      </View>
    </View>
  )
}

// "For today 1/3" — next to the "Coach is here?" switch, while there are tasks.
export function ForTodayChip({ list, onPress }: { list: NextTaskList; onPress: () => void }) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  if (list.tasks.length === 0) return null
  const done = doneCount(list)
  const all = done === list.tasks.length
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`For today, ${done} of ${list.tasks.length} done`}
    >
      <Ionicons name={all ? "checkmark-circle" : "clipboard-outline"} size={13} color={t.pink} />
      <Text style={styles.chipText}>For today · {done}/{list.tasks.length}</Text>
    </Pressable>
  )
}

// ─── End of the workout: "For next time" ──────────────────────────────────────

// On the summary. Opening the editor keeps the summary from closing itself.
export function NextTimeCard({ list, onOpen }: { list: NextTaskList; onOpen: () => void }) {
  const t = usePaper()
  const empty = list.tasks.length === 0
  return (
    <Card homework eyebrow="For next time" style={{ marginTop: 24 }}>
      {empty ? (
        <>
          <Body weight={800} size={18}>Ask your coach for homework</Body>
          <Body muted size={13} style={{ marginTop: 4 }}>
            Or add your own. It&apos;ll be waiting at the start of your next workout.
          </Body>
        </>
      ) : (
        <>
          {list.tasks.map((task, i) => (
            <TaskRow key={task.id} task={task} first={i === 0} />
          ))}
          <Body muted size={13} style={{ marginTop: 8 }}>At the start of your next workout.</Body>
        </>
      )}
      <GhostButton
        label={empty ? "Add a task" : "Edit"}
        icon={empty ? "add" : "create-outline"}
        onPress={onOpen}
        style={{ marginTop: 14, borderColor: hexAlpha(t.pink, 0.45) }}
      />
    </Card>
  )
}

const UNITS: { unit: TaskUnit | null; label: string; start: number }[] = [
  { unit: null, label: "No amount", start: 0 },
  { unit: "tries", label: "Tries", start: 5 },
  { unit: "min", label: "Minutes", start: 3 },
]

// Full-screen editor: the list (✕ to remove) and a form to add one more.
// Every change is saved right away; Done just closes it.
export function NextTimeEditor({ list, update, onClose, insets }: {
  list: NextTaskList
  update: (fn: (l: NextTaskList) => NextTaskList) => void
  onClose: () => void
  insets: EdgeInsets
}) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const [text, setText] = useState("")
  const [unit, setUnit] = useState<TaskUnit | null>(null)
  const [amount, setAmount] = useState(5)
  const full = list.tasks.length >= MAX_TASKS
  const canAdd = text.trim().length > 0 && !full

  function add() {
    if (!canAdd) return
    update((l) => addTask(l, { text, unit, amount: unit ? amount : null }, newId(), localDateStr(new Date()), Date.now()))
    setText("")
    setUnit(null)
  }

  const n = list.tasks.length
  return (
    <View style={[styles.editor, { paddingTop: insets.top }]}>
      <NavBar
        title="For next time"
        status={n === 0 ? "No tasks yet" : `${n} task${n === 1 ? "" : "s"} · saved`}
        onSave={onClose}
        saveLabel="Done"
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.editorScroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Mono>Next session</Mono>
          <PosterHeadline size={58} style={{ marginTop: 6 }}>Homework</PosterHeadline>

          <View style={styles.nudge}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={t.pink} />
            <Body muted size={14} style={{ flex: 1 }}>
              Ask your coach what to work on, then write it here.
            </Body>
          </View>

          {n > 0 && (
            <Card padded={false} style={{ marginTop: 20, paddingHorizontal: space.cardPad }}>
              {list.tasks.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  first={i === 0}
                  onRemove={() => update((l) => removeTask(l, task.id, Date.now()))}
                />
              ))}
            </Card>
          )}

          <Card style={{ marginTop: 20 }}>
            <TextField
              label="New task"
              value={text}
              onChangeText={setText}
              placeholder="Try the crux of the blue project"
              maxLength={MAX_TEXT}
              returnKeyType="done"
              onSubmitEditing={add}
              editable={!full}
            />
            <Mono style={{ marginTop: 16, marginBottom: 8 }}>Amount</Mono>
            <View style={styles.units}>
              {UNITS.map((u) => {
                const on = unit === u.unit
                return (
                  <Pressable
                    key={u.label}
                    onPress={() => { setUnit(u.unit); if (u.unit) setAmount(u.start) }}
                    style={[styles.unit, on && styles.unitOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.unitText, on && { color: t.onMint }]}>{u.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            {unit && (
              <Stepper
                value={amount}
                onChange={setAmount}
                min={1}
                max={MAX_AMOUNT}
                label={unit === "min" ? "Minutes" : "Tries"}
                format={(v) => (unit === "min" ? `${v} min` : `${v} ${v === 1 ? "try" : "tries"}`)}
                style={{ marginTop: 12 }}
              />
            )}
            <MintButton label="Add task" icon="add" onPress={add} disabled={!canAdd} style={{ marginTop: 16 }} />
            {full && <Body muted size={13} style={{ marginTop: 8 }}>That&apos;s the most for one session.</Body>}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

function makeStyles(t: PaperTheme) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 20, elevation: 20,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    sheet: { paddingHorizontal: space.gutter },
    sheetCard: { backgroundColor: t.paper, paddingTop: space.cardPad, paddingBottom: 6 },
    sheetHead: { paddingHorizontal: space.cardPad, paddingBottom: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
    rowDivider: { borderTopWidth: 1, borderTopColor: t.hairline },
    check: {
      width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: t.ink,
      alignItems: "center", justifyContent: "center",
    },
    checkOn: { backgroundColor: t.mint },
    doneText: { textDecorationLine: "line-through", color: t.textMuted },
    chip: {
      flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6,
      marginTop: 4, marginBottom: 2, height: 32, paddingHorizontal: 12, borderRadius: 16,
      borderWidth: 1.5, borderColor: hexAlpha(t.pink, 0.45),
    },
    chipText: { fontFamily: font.bold, fontSize: 12.5, color: t.ink },
    editor: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 30, elevation: 30,
      backgroundColor: t.paper,
    },
    editorScroll: { paddingHorizontal: space.gutter, paddingTop: 20 },
    nudge: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
    units: { flexDirection: "row", gap: 8 },
    unit: {
      flex: 1, height: 36, borderRadius: radius.input, borderWidth: 1.5, borderColor: t.ghostBorder,
      alignItems: "center", justifyContent: "center",
    },
    unitOn: { backgroundColor: t.mint, borderColor: t.mode === "dark" ? t.mint : t.ink },
    unitText: { fontFamily: font.bodyBold, fontSize: 13, color: t.ink },
  })
}
