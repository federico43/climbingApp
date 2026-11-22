import { Body, Card, GhostButton, Mono, NavBar, SlidesBody, Stepper, TextButton, TextField, usePaper, usePaperStyles } from "@/components/paper"
import { useAuth } from "@/components/auth-context"
import { openTasksIntro, TASKS_INTRO } from "@/components/SessionTasksIntro"
import { useSessionTasks } from "@/contexts/SessionTasksContext"
import { useTaskBlockActions } from "@/contexts/WorkoutContext"
import { font, PaperTheme, radius, space } from "@/theme/paper/tokens"
import { localDateStr } from "@/utils/planRotation"
import {
  addTask, amountLabel, canAdd, editTask, MAX_TASKS, MAX_TEXT, removeTasks, TIME_RANGE, TRIES_RANGE,
  type SessionTask, type TaskMode,
} from "@/utils/sessionTasks"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useRef, useState } from "react"
import { BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context"

// Next-session tasks (docs/session-tasks.md) outside the task blocks:
//   • NextSessionCard — the open tasks, on the workout summary and on Plan / Home.
//     Tap one to change or remove it; "Add a task" for a new one.
//   • TaskSheet — full screen: one task (text, tries or time limit), new or edited.
//   • TasksCardWithEditor — the card + sheet in a Modal, for Plan / Home.
//   • TaskIntroStep — the workout's first-task block: intro slides, then the sheet.
// Inside the workout the sheet is an overlay, not a <Modal>: iOS can't stack
// Modals (utils/popupTurn.ts).

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function TaskRow({ task, onPress, first }: { task: SessionTask; onPress: () => void; first?: boolean }) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Change ${task.text}`}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={task.mode === "time" ? "time-outline" : "repeat"} size={20} color={t.mintText} />
      <View style={{ flex: 1 }}>
        <Body weight={700} size={16}>{task.text}</Body>
        <Mono color={t.mintText} style={{ marginTop: 3 }}>{amountLabel(task)}</Mono>
      </View>
      <Ionicons name="create-outline" size={20} color={t.label} />
    </Pressable>
  )
}

// The open tasks. Tapping one opens it in the sheet (change it or remove it);
// "Add a task" opens an empty one. No separate edit mode (Federico 2026-11-22:
// "Edit" mixed too much). `onHelp` opens the intro slides again.
export function NextSessionCard({ onOpen, onHelp, style }: {
  onOpen: (task: SessionTask | null) => void
  onHelp?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const { list } = useSessionTasks()
  const full = !canAdd(list)
  return (
    <View style={style}>
      <Card>
        <View style={styles.cardHead}>
          <Mono color={t.label}>Next session · {list.tasks.length} of {MAX_TASKS}</Mono>
          {onHelp && (
            <Pressable onPress={onHelp} hitSlop={10} accessibilityRole="button" accessibilityLabel="How next-session tasks work">
              <Mono color={t.mintText}>How it works</Mono>
            </Pressable>
          )}
        </View>
        {list.tasks.length === 0 ? (
          <Body muted size={14}>Your project, or a movement you haven&apos;t figured out. It comes right after the warm-up.</Body>
        ) : (
          list.tasks.map((task, i) => <TaskRow key={task.id} task={task} first={i === 0} onPress={() => onOpen(task)} />)
        )}
        {full ? (
          <Body muted size={13} style={{ marginTop: 8 }}>Tap a task to change or remove it.</Body>
        ) : (
          <GhostButton label="Add a task" icon="add" onPress={() => onOpen(null)} style={{ marginTop: 14 }} />
        )}
      </Card>
    </View>
  )
}

const MODES: { mode: TaskMode; label: string; start: number }[] = [
  { mode: "tries", label: "Tries", start: TRIES_RANGE.start },
  { mode: "time", label: "Time limit", start: TIME_RANGE.start },
]

// One task: what, then tries or a time limit. `task` = change that one (same
// id, so a block already running it still matches), null = a new one.
// `onSaved`: called with the saved task instead of closing.
export function TaskSheet({ task, onClose, onSaved, cancelLabel, insets }: {
  task: SessionTask | null
  onClose: () => void
  onSaved?: (task: SessionTask) => void
  cancelLabel?: string
  insets: EdgeInsets
}) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const { list, update, current } = useSessionTasks()
  const [text, setText] = useState(task?.text ?? "")
  const [mode, setMode] = useState<TaskMode>(task?.mode ?? "tries")
  const [amount, setAmount] = useState(task?.amount ?? TRIES_RANGE.start)

  // Android back closes the sheet, not the screen under it.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { closeRef.current(); return true })
    return () => sub.remove()
  }, [])

  const ready = text.trim().length > 0 && (task ? true : canAdd(list))
  function save() {
    if (!ready) return
    const now = Date.now()
    const id = task?.id ?? newId()
    update((l) => (task
      ? editTask(l, id, { text, mode, amount }, now)
      : addTask(l, { text, mode, amount }, id, localDateStr(new Date()), now)))
    const saved = current().tasks.find((x) => x.id === id)
    if (onSaved && saved) onSaved(saved)
    else onClose()
  }
  function remove() {
    if (!task) return
    update((l) => removeTasks(l, [task.id], Date.now()))
    onClose()
  }
  function pickMode(m: (typeof MODES)[number]) {
    if (m.mode === mode) return
    setMode(m.mode)
    // Back to the task's own mode → its own amount.
    setAmount(task?.mode === m.mode ? task.amount : m.start)
  }

  const range = mode === "time" ? TIME_RANGE : TRIES_RANGE
  return (
    <View style={[styles.editor, { paddingTop: insets.top }]}>
      <NavBar
        title={task ? "Edit task" : "New task"}
        onCancel={onClose}
        cancelLabel={cancelLabel}
        onSave={save}
        saveLabel={task ? "Save" : "Add"}
        saveDisabled={!ready}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.editorScroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <TextField
            label="Task"
            value={text}
            onChangeText={setText}
            placeholder="The crux of the blue project"
            maxLength={MAX_TEXT}
            autoFocus={!task}
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <Mono style={{ marginTop: 20, marginBottom: 8 }}>How much</Mono>
          <View style={styles.modes}>
            {MODES.map((m) => {
              const on = mode === m.mode
              return (
                <Pressable
                  key={m.mode}
                  onPress={() => pickMode(m)}
                  style={[styles.mode, on && styles.modeOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.modeText, on && { color: t.onMint }]}>{m.label}</Text>
                </Pressable>
              )
            })}
          </View>
          <Stepper
            value={amount}
            onChange={setAmount}
            min={range.min}
            max={range.max}
            label={mode === "time" ? "Minutes" : "Tries"}
            format={(v) => amountLabel({ mode, amount: v })}
            style={{ marginTop: 12 }}
          />
          {task && (
            <View style={{ alignItems: "center", marginTop: 36 }}>
              <TextButton label="Remove task" onPress={remove} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

// The workout's first-task block (utils/sessionTasks.ts introTaskBlock): the
// intro slides, then the sheet to write the task, which then runs right here
// as the task's block. "Not now" / ✕ skips the block. Seen once it's shown.
export function TaskIntroStep() {
  const actions = useTaskBlockActions()
  const { markIntroSeen } = useSessionTasks()
  const insets = useSafeAreaInsets()
  const [writing, setWriting] = useState(false)
  useEffect(() => { markIntroSeen() }, [markIntroSeen])
  const notNow = () => actions?.skip()

  if (writing) {
    return <TaskSheet task={null} cancelLabel="Not now" onClose={notNow} onSaved={(task) => actions?.fillIntro(task)} insets={insets} />
  }
  return <SlidesBody label="Next-session tasks" slides={TASKS_INTRO} finishLabel="Write my task" onFinish={() => setWriting(true)} onClose={notNow} />
}

// Plan / Home: the card, and the sheet in a Modal. Athletes only.
export function TasksCardWithEditor({ style }: { style?: StyleProp<ViewStyle> }) {
  const { role } = useAuth()
  const insets = useSafeAreaInsets()
  // The sheet: which task (null = a new one), or closed.
  const [sheet, setSheet] = useState<{ task: SessionTask | null } | null>(null)
  if (role === "coach") return null
  return (
    <>
      <NextSessionCard onOpen={(task) => setSheet({ task })} onHelp={openTasksIntro} style={style} />
      <Modal visible={!!sheet} animationType="slide" onRequestClose={() => setSheet(null)}>
        {sheet && <TaskSheet task={sheet.task} onClose={() => setSheet(null)} insets={insets} />}
      </Modal>
    </>
  )
}

function makeStyles(t: PaperTheme) {
  return StyleSheet.create({
    cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
    rowDivider: { borderTopWidth: 1, borderTopColor: t.hairline },
    editor: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 30, elevation: 30,
      backgroundColor: t.paper,
    },
    editorScroll: { paddingHorizontal: space.gutter, paddingTop: 20 },
    modes: { flexDirection: "row", gap: 8 },
    mode: {
      flex: 1, height: 36, borderRadius: radius.input, borderWidth: 1.5, borderColor: t.ghostBorder,
      alignItems: "center", justifyContent: "center",
    },
    modeOn: { backgroundColor: t.mint, borderColor: t.mode === "dark" ? t.mint : t.ink },
    modeText: { fontFamily: font.bodyBold, fontSize: 13, color: t.ink },
  })
}
