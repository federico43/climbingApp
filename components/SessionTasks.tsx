import { Body, Card, GhostButton, MintButton, Mono, NavBar, PosterHeadline, Stepper, TextField, usePaper, usePaperStyles } from "@/components/paper"
import { useAuth } from "@/components/auth-context"
import { useSessionTasks } from "@/contexts/SessionTasksContext"
import { font, PaperTheme, radius, space } from "@/theme/paper/tokens"
import { localDateStr } from "@/utils/planRotation"
import {
  addTask, amountLabel, canAdd, MAX_TASKS, MAX_TEXT, removeTasks, TIME_RANGE, TRIES_RANGE,
  type SessionTask, type SessionTaskList, type TaskMode,
} from "@/utils/sessionTasks"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useRef, useState } from "react"
import { BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context"

// Next-session tasks (docs/session-tasks.md) outside the task blocks:
//   • NextSessionCard — the open tasks, on the workout summary and on Plan / Home.
//   • TasksEditor — full screen: the tasks (✕ removes one) and a form to add one.
//   • TasksCardWithEditor — the card + editor in a Modal, for Plan / Home.
// Inside the workout the editor is an overlay, not a <Modal>: iOS can't stack
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

export function NextSessionCard({ list, onOpen, style }: { list: SessionTaskList; onOpen: () => void; style?: StyleProp<ViewStyle> }) {
  const empty = list.tasks.length === 0
  return (
    <View style={style}>
      <Card eyebrow="Next session">
        {empty ? (
          <>
            <Body weight={800} size={18}>Set a task for next session</Body>
            <Body muted size={13} style={{ marginTop: 4 }}>
              Your project, or a movement you haven&apos;t figured out. It comes right after the warm-up.
            </Body>
          </>
        ) : (
          <>
            {list.tasks.map((task, i) => <TaskRow key={task.id} task={task} first={i === 0} />)}
            <Body muted size={13} style={{ marginTop: 8 }}>
              Right after the warm-up, every session until you close it.
            </Body>
          </>
        )}
        <GhostButton
          label={empty ? "Add a task" : "Edit"}
          icon={empty ? "add" : "create-outline"}
          onPress={onOpen}
          style={{ marginTop: 14 }}
        />
      </Card>
    </View>
  )
}

const MODES: { mode: TaskMode; label: string; start: number }[] = [
  { mode: "tries", label: "Tries", start: TRIES_RANGE.start },
  { mode: "time", label: "Time limit", start: TIME_RANGE.start },
]

// The text being typed survives the app being closed.
const DRAFT_KEY = "nextTasks.draft"

export function TasksEditor({ onClose, insets }: { onClose: () => void; insets: EdgeInsets }) {
  const t = usePaper()
  const styles = usePaperStyles(makeStyles)
  const { list, update } = useSessionTasks()
  const [text, setText] = useState("")
  const [mode, setMode] = useState<TaskMode>("tries")
  const [amount, setAmount] = useState(TRIES_RANGE.start)
  const typed = useRef(false)

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then((d) => { if (d && !typed.current) setText(d) }).catch(() => {})
  }, [])
  function changeText(v: string) {
    typed.current = true
    setText(v)
    AsyncStorage.setItem(DRAFT_KEY, v).catch(() => {})
  }

  // Android back closes the editor, not the screen under it.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { closeRef.current(); return true })
    return () => sub.remove()
  }, [])

  const full = !canAdd(list)
  const ready = text.trim().length > 0 && !full

  function add() {
    if (!ready) return
    update((l) => addTask(l, { text, mode, amount }, newId(), localDateStr(new Date()), Date.now()))
    changeText("")
  }

  const n = list.tasks.length
  const range = mode === "time" ? TIME_RANGE : TRIES_RANGE
  return (
    <View style={[styles.editor, { paddingTop: insets.top }]}>
      <NavBar
        title="Next session"
        status={n === 0 ? "No tasks yet" : `${n} of ${MAX_TASKS} · saved`}
        // A task typed but not added yet is kept, not lost.
        onSave={() => { add(); onClose() }}
        saveLabel="Done"
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.editorScroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Mono>Up to {MAX_TASKS}</Mono>
          <PosterHeadline size={58} style={{ marginTop: 6 }}>Your tasks</PosterHeadline>
          <Body muted size={14} style={{ marginTop: 12 }}>
            Your project, or a movement you haven&apos;t figured out. Each one comes right after the warm-up, every session until you close it.
          </Body>

          {n > 0 && (
            <Card padded={false} style={{ marginTop: 20, paddingHorizontal: space.cardPad }}>
              {list.tasks.map((task, i) => (
                <TaskRow key={task.id} task={task} first={i === 0} onRemove={() => update((l) => removeTasks(l, [task.id], Date.now()))} />
              ))}
            </Card>
          )}

          {full ? (
            <Body muted size={14} style={{ marginTop: 20 }}>
              That&apos;s {MAX_TASKS} tasks, the most at once. Remove one to add another.
            </Body>
          ) : (
            <Card style={{ marginTop: 20 }}>
              <TextField
                label="New task"
                value={text}
                onChangeText={changeText}
                placeholder="The crux of the blue project"
                maxLength={MAX_TEXT}
                returnKeyType="done"
                onSubmitEditing={add}
              />
              <Mono style={{ marginTop: 16, marginBottom: 8 }}>How much</Mono>
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
              <MintButton label="Add task" icon="add" onPress={add} disabled={!ready} style={{ marginTop: 16 }} />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

// Plan / Home: the card, and the editor in a Modal. Athletes only.
export function TasksCardWithEditor({ style }: { style?: StyleProp<ViewStyle> }) {
  const { role } = useAuth()
  const { list } = useSessionTasks()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  if (role === "coach") return null
  return (
    <>
      <NextSessionCard list={list} onOpen={() => setOpen(true)} style={style} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        {open && <TasksEditor onClose={() => setOpen(false)} insets={insets} />}
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
