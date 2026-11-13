import { paperSheet, useSheet } from "@/theme/paper/legacy"
import { cardSheet } from "@/components/coach/styles"
import {
  createProtocol, getSessionsByUserId, listBlocks, listExercises, listPlanWorkouts,
  type AppUser, type ProtocolRow, type SessionRow, type TrainingPlanRow,
} from "@/services/BoulderGraphService"
import { notifyHomeworkAssigned } from "@/services/homework"
import { ADAPTATION_COLOR } from "@/utils/adaptations"
import {
  EXTRA_SESSION_NAME, extraSessionBlocks, extraSessionDays, extraSessionSpec, gymDaysLabel, nextExtraWindow,
  pendingExtraSession, trainingDays, weekdaysLabel,
} from "@/utils/extraSession"
import { dueByOf, shortDay } from "@/utils/homework"
import { localDateStr, type BuiltPlanWorkout } from "@/utils/planRotation"
import { buildPlanWorkout, withUpcomingWorkouts } from "@/utils/planWorkout"
import { FOCUS_LABEL } from "@/utils/scProgression"
import { useState } from "react"
import { Alert, StyleSheet, Text, View, Pressable } from "react-native"

// Coach, under the plan's next workout (utils/extraSession.ts): "Trains Tue &
// Thu — an extra session on their own on Sat or Sun gets results faster",
// and one tap sends it. The app builds it (the S&C of the latest workout,
// the other exercise of each pattern) and it goes out as homework due the
// last suggested day — not as a workout on the athlete's Home.
export function ExtraSessionRow({ athlete, plan, sessions, homework, flashLevel, onSent }: {
  athlete: AppUser
  plan: TrainingPlanRow
  sessions: SessionRow[]
  homework: ProtocolRow[]
  flashLevel: string | null
  onSent: () => void
}) {
  const styles = useSheet(stylesSheet)
  const card = useSheet(cardSheet)
  const [busy, setBusy] = useState(false)
  const today = localDateStr(new Date())
  const gymDays = trainingDays(athlete.defaultClasses, sessions, today)
  const days = extraSessionDays(gymDays)
  const window = nextExtraWindow(today, days)
  const pending = pendingExtraSession(homework, sessions, today)

  if (!plan.hasSc) return null

  async function send() {
    if (!window) return
    setBusy(true)
    try {
      // Fresh data, like the plan's Create: anything done or built since
      // the page opened counts.
      const [fresh, built, exerciseRows, blockRows] = await Promise.all([
        getSessionsByUserId(athlete.$id), listPlanWorkouts(plan.$id), listExercises(), listBlocks(),
      ])
      const builtWorkouts: BuiltPlanWorkout[] = built
        .filter((w) => !w.planPart && w.planIndex)
        .map((w) => ({ planIndex: w.planIndex!, createdAt: w.$createdAt, blocks: w.blocks }))
      const spec = extraSessionSpec(plan, builtWorkouts, today)
      if (!spec) return
      const workout = buildPlanWorkout(plan, spec, blockRows, exerciseRows, withUpcomingWorkouts(fresh, built), flashLevel)
      if (workout.blocks.length === 0) {
        Alert.alert("Nothing to send", [...workout.warnings, "The plan's S&C has no exercises to build from."].join("\n\n"))
        return
      }
      const blocks = extraSessionBlocks(workout.blocks, { from: window.from, to: window.to, days, gymDays })
      const name = spec.scFocus ? `${EXTRA_SESSION_NAME} · ${FOCUS_LABEL[spec.scFocus]}` : EXTRA_SESSION_NAME
      const row = await createProtocol({ name, blocks, athleteId: athlete.$id, planPart: "homework", dueBy: window.to })
      notifyHomeworkAssigned(row.$id, shortDay(window.to))
      onSent()
      if (workout.warnings.length > 0) Alert.alert("Sent — check this", workout.warnings.join("\n\n"))
    } catch (e: any) {
      Alert.alert("Couldn't send it", e?.message ?? "Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: ADAPTATION_COLOR.conditioning }]} />
        <Text style={styles.title}>Extra session on their own</Text>
      </View>
      {pending ? (
        <Text style={styles.sent}>✓ Sent as homework · due {shortDay(dueByOf(pending))}</Text>
      ) : !window ? (
        <Text style={styles.text}>
          {gymDays.length === 0
            ? "No class days yet — once they have fixed classes, the app suggests a day between workouts."
            : `Trains ${gymDaysLabel(gymDays)} — the week is already spread out.`}
        </Text>
      ) : (
        <>
          <Text style={styles.text}>
            Trains {gymDaysLabel(gymDays)}. A short S&C session on {weekdaysLabel(days)} gets results faster.
          </Text>
          <Pressable style={[card.outlineBtn, styles.btn, busy && { opacity: 0.6 }]} onPress={send} disabled={busy}>
            <Text style={card.outlineBtnText}>
              {busy ? "Sending…" : `Send for ${window.from === window.to ? shortDay(window.from) : `${shortDay(window.from)} – ${shortDay(window.to)}`}`}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  )
}

const stylesSheet = paperSheet((C) => StyleSheet.create({
  box: { backgroundColor: C.surfaceHigh, borderRadius: 12, padding: 12, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { fontSize: 13.5, fontWeight: "700", color: C.textPrimary },
  text: { fontSize: 12.5, color: C.textSecondary, marginLeft: 18 },
  sent: { fontSize: 12.5, fontWeight: "600", color: C.green, marginLeft: 18 },
  btn: { alignSelf: "flex-end", marginTop: 2 },
}))
