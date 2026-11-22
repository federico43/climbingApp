import { Body, Card, GhostButton, Mono, NavBar, Stepper, TextField, usePaper, usePaperStyles } from "@/components/paper"
import { useAuth } from "@/components/auth-context"
import { useSessionTasks } from "@/contexts/SessionTasksContext"
import { font, PaperTheme, radius, space } from "@/theme/paper/tokens"
import { localDateStr } from "@/utils/planRotation"
import {
  addTask, amountLabel, canAdd, MAX_TASKS, MAX_TEXT, removeTasks, TIME_RANGE, TRIES_RANGE,
  type SessionTask, type TaskMode,
} from "@/utils/sessionTasks"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useRef, useState } from "react"
import { BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context"

// Next-session tasks (docs/session-tasks.md) outside the task blocks:
//   • NextSessionCard — the open tasks (✕ removes one), on the workout summary and on Plan / Home.
//   • AddTaskSheet — full screen: one new task (text, tries or time limit).
//   • TasksCardWithEditor — the card + sheet in a Modal, for Plan / Home.
// Inside the workout the sheet is an overlay, not a <Modal>: iOS can't stack
// Modals (utils/popupTurn.ts).

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function TaskRow({ task, onRemove, first }: { task: SessionTask; onRemove?: () => void; first?: boolean }) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <Ionicons name={task.mode === "time" ? "time-outline" : "repeat"} size={20} color={t.mintText} />
      <View style={{ flex: 1 }}>
        <Body weight={700} size={16}>{task.text}</Body>
        <Mono color={t.mintText} style={{ marginTop: 3 }}>{amountLabel(task)}</Mono>
      </View>
      {onRemove && (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${task.text}`}>
          <Ionicons name="close" size={20} color={t.label} />
        </Pressable>
      )}
    </View>
  )
}

// The open tasks. ✕ removes one right here; "Add a task" opens the add sheet.
// No separate edit mode (Federico 2026-11-22: "Edit" mixed too much).
export function NextSessionCard({ onAdd, style }: { onAdd: () => void; style?: StyleProp<ViewStyle> }) {
  const { list, update } = useSessionTasks()
  const full = !canAdd(list)
  return (
    <View style={style}>
      <Card eyebrow={`Next session · ${list.tasks.length} of ${MAX_TASKS}`}>
        {list.tasks.length === 0 ? (
          <Body muted size={14}>Your project, or a movement you haven&apos;t figured out. It comes right after the warm-up.</Body>
        ) : (
          list.tasks.map((task, i) => (
            <TaskRow key={task.id} task={task} first={i === 0} onRemove={() => update((l) => removeTasks(l, [task.id], Date.now()))} />
          ))
        )}
        {full ? (
          <Body muted size={13} style={{ marginTop: 8 }}>Remove one to add another.</Body>
        ) : (
          <GhostButton label="Add a task" icon="add" onPress={onAdd} style={{ marginTop: 14 }} />
        )}
      </Card>
    </View>
  )
}

const MODES: { mode: TaskMode; label: string; start: number }[] = [
  { mode: "tries", label: "Tries", start: TRIES_RANGE.start },
  { mode: "time", label: "Time limit", start: TIME_RANGE.start },
]

// One task: what, then tries or a time limit. Cancel / Add in the nav bar.
export function AddTaskSheet({ onClose, insets }: { onClose: () => void; insets: EdgeInsets }) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const { list, update } = useSessionTasks()
  const [text, setText] = useState("")
  const [mode, setMode] = useState<TaskMode>("tries")
  const [amount, setAmount] = useState(TRIES_RANGE.start)

  // Android back closes the sheet, not the screen under it.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { closeRef.current(); return true })
    return () => sub.remove()
  }, [])

  const ready = text.trim().length > 0 && canAdd(list)
  function add() {
    if (!ready) return
    update((l) => addTask(l, { text, mode, amount }, newId(), localDateStr(new Date()), Date.now()))
    onClose()
  }

  const range = mode === "time" ? TIME_RANGE : TRIES_RANGE
  return (
    <View style={[styles.editor, { paddingTop: insets.top }]}>
      <NavBar title="New task" onCancel={onClose} onSave={add} saveLabel="Add" saveDisabled={!ready} />
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
            autoFocus
            returnKeyType="done"
            onSubmitEditing={add}
          />
          <Mono style={{ marginTop: 20, marginBottom: 8 }}>How much</Mono>
          <View style={styles.modes}>
            {MODES.map((m) => {
              const on = mode === m.mode
              return (
                <Pressable
                  key={m.mode}
                  onPress={() => { setMode(m.mode); setAmount(m.start) }}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

// Plan / Home: the card, and the editor in a Modal. Athletes only.
export function TasksCardWithEditor({ style }: { style?: StyleProp<ViewStyle> }) {
  const { role } = useAuth()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  if (role === "coach") return null
  return (
    <>
      <NextSessionCard onAdd={() => setOpen(true)} style={style} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        {open && <AddTaskSheet onClose={() => setOpen(false)} insets={insets} />}
      </Modal>
    </>
  )
}

function makeStyles(t: PaperTheme) {
  return StyleSheet.create({
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
