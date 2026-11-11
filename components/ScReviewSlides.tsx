// The end-of-block review of a strength & conditioning circuit, as slides
// (utils/scReview.ts): an overview ("You improved on 2 of 3 exercises"),
// one slide per exercise with today next to last time at the same focus,
// and — on exercises that stayed the same or went down — a few quick
// questions (form, tiredness, what could be better). The block's existing
// summary ("Next time" + every round) is the last slide.

import { paperSheet, useC, useSheet, type Palette } from "@/theme/paper/legacy"
import {
  asksQuestions, FORM_LABEL, overviewLine, tally,
  type ExerciseReview, type FormAnswer, type ReviewAnswers, type Trend, type Verdict,
} from "@/utils/scReview"
import { FOCUS_LABEL } from "@/utils/scProgression"
import { Ionicons } from "@expo/vector-icons"
import React, { useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

const verdictOf = (C: Palette): Record<Verdict, { label: string; color: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> => ({
  improved: { label: "Improved", color: C.green, icon: "trending-up" },
  same: { label: "Same", color: C.yellow, icon: "remove" },
  declined: { label: "Below last time", color: C.red, icon: "trending-down" },
  first: { label: "Baseline", color: C.textSecondary, icon: "flag-outline" },
})

const trendColorOf = (C: Palette): Record<Trend, string> => ({ up: C.green, same: C.textSecondary, down: C.red })
const TREND_ICON: Record<Trend, React.ComponentProps<typeof Ionicons>["name"]> = { up: "arrow-up", same: "remove", down: "arrow-down" }

const FORMS: FormAnswer[] = ["good", "unsure", "off"]

function shortDate(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function ScReviewSlides({ reviews, details, finishLabel, onFinish }: {
  reviews: ExerciseReview[]
  details: React.ReactNode     // the block summary, shown as the last slide
  finishLabel: string
  onFinish: (answers: Record<string, ReviewAnswers>) => void
}) {
  const C = useC()
  const styles = useSheet(sheet)
  // overview, one per exercise, then the summary
  const count = reviews.length ? reviews.length + 2 : 1
  const [slide, setSlide] = useState(0)
  const [answers, setAnswers] = useState<Record<string, ReviewAnswers>>({})
  const answer = (key: string, patch: Partial<ReviewAnswers>) =>
    setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const last = slide === count - 1
  const review = slide > 0 && slide <= reviews.length ? reviews[slide - 1] : undefined
  const t = tally(reviews)

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {count > 1 && (
        <View style={styles.dots}>
          {Array.from({ length: count }).map((_, i) => (
            <View key={i} style={[styles.dot, i === slide && styles.dotActive]} />
          ))}
        </View>
      )}

      {last ? (
        <View style={{ flex: 1 }}>{details}</View>
      ) : (
        <ScrollView key={slide} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {slide === 0 ? (
            <Overview reviews={reviews} line={overviewLine(t)} counts={t} />
          ) : review ? (
            <ExerciseSlide review={review} answers={answers[review.key]} onAnswer={(p) => answer(review.key, p)} />
          ) : null}
        </ScrollView>
      )}

      <View style={styles.footer}>
        {slide > 0 && (
          <Pressable style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && { opacity: 0.8 }]} onPress={() => setSlide((s) => s - 1)}>
            <Ionicons name="arrow-back" size={18} color={C.textPrimary} />
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.btn, { flex: 1 }, pressed && { opacity: 0.8 }]}
          onPress={() => (last ? onFinish(answers) : setSlide((s) => s + 1))}
        >
          <Text style={styles.btnText}>{last ? finishLabel : "Next"}</Text>
          <Ionicons name="arrow-forward" size={18} color={C.onAccent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

function Overview({ reviews, line, counts }: { reviews: ExerciseReview[]; line: string; counts: ReturnType<typeof tally> }) {
  const C = useC()
  const styles = useSheet(sheet)
  const VERDICT = verdictOf(C)
  const chips: { v: Verdict; n: number }[] = (["improved", "same", "declined", "first"] as Verdict[])
    .map((v) => ({ v, n: counts[v] })).filter((c) => c.n > 0)
  return (
    <>
      <View style={styles.head}>
        <Text style={styles.kicker}>Block done</Text>
        <Text style={styles.title}>Circuit complete</Text>
        {!!line && <Text style={styles.lead}>{line}</Text>}
      </View>
      <View style={styles.tallyRow}>
        {chips.map(({ v, n }) => (
          <View key={v} style={[styles.tally, { borderColor: VERDICT[v].color }]}>
            <Text style={[styles.tallyNum, { color: VERDICT[v].color }]}>{n}</Text>
            <Text style={styles.tallyLabel}>{VERDICT[v].label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.card}>
        {reviews.map((r) => (
          <View key={r.key} style={styles.overviewRow}>
            <Ionicons name={VERDICT[r.verdict].icon} size={18} color={VERDICT[r.verdict].color} />
            <Text style={styles.overviewName} numberOfLines={1}>{r.name}</Text>
            <Text style={[styles.overviewVerdict, { color: VERDICT[r.verdict].color }]}>{VERDICT[r.verdict].label}</Text>
          </View>
        ))}
      </View>
    </>
  )
}

function ExerciseSlide({ review, answers, onAnswer }: {
  review: ExerciseReview; answers?: ReviewAnswers; onAnswer: (p: Partial<ReviewAnswers>) => void
}) {
  const C = useC()
  const styles = useSheet(sheet)
  const VERDICT = verdictOf(C)
  const TREND_COLOR = trendColorOf(C)
  const v = VERDICT[review.verdict]
  const compared = review.verdict !== "first"
  return (
    <>
      <View style={styles.head}>
        <Text style={styles.kicker}>{review.focus ? FOCUS_LABEL[review.focus] : "Strength & conditioning"}</Text>
        <Text style={styles.title}>{review.name}</Text>
      </View>
      <View style={[styles.verdict, { borderColor: v.color }]}>
        <Ionicons name={v.icon} size={28} color={v.color} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.verdictLabel, { color: v.color }]}>{v.label}</Text>
          <Text style={styles.verdictHeadline}>{review.headline}</Text>
        </View>
      </View>

      <View style={styles.card}>
        {compared && (
          <View style={styles.metricRow}>
            <Text style={[styles.metricLabel, { flex: 1 }]} />
            <Text style={styles.colHead}>{shortDate(review.lastDate) || "Last time"}</Text>
            <Text style={styles.colHead}>Today</Text>
          </View>
        )}
        {review.metrics.map((m) => (
          <View key={m.label} style={styles.metricRow}>
            <Text style={[styles.metricLabel, { flex: 1 }]}>{m.label}</Text>
            {compared && <Text style={styles.metricBefore} numberOfLines={2}>{m.before ?? "—"}</Text>}
            <View style={styles.metricAfterWrap}>
              <Text style={[styles.metricAfter, m.trend && { color: m.trend === "same" ? C.textPrimary : TREND_COLOR[m.trend] }]} numberOfLines={2}>
                {m.after}
              </Text>
              {m.trend && m.trend !== "same" && <Ionicons name={TREND_ICON[m.trend]} size={14} color={TREND_COLOR[m.trend]} />}
            </View>
          </View>
        ))}
      </View>

      {asksQuestions(review) && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Let&apos;s see why</Text>
          <Text style={styles.question}>How was your form?</Text>
          <View style={styles.chipRow}>
            {FORMS.map((f) => (
              <Chip key={f} label={FORM_LABEL[f]} selected={answers?.form === f} onPress={() => onAnswer({ form: answers?.form === f ? undefined : f })} />
            ))}
          </View>
          <Text style={styles.question}>Did you feel tired?</Text>
          <View style={styles.chipRow}>
            <Chip label="Yes, tired" selected={answers?.tired === true} onPress={() => onAnswer({ tired: answers?.tired === true ? undefined : true })} />
            <Chip label="No, felt fine" selected={answers?.tired === false} onPress={() => onAnswer({ tired: answers?.tired === false ? undefined : false })} />
          </View>
          <Text style={styles.question}>Anything you could do better?</Text>
          <TextInput
            style={styles.input}
            value={answers?.improve ?? ""}
            onChangeText={(improve) => onAnswer({ improve })}
            placeholder="Tempo, range of motion, rest… (optional)"
            placeholderTextColor={C.textMuted}
            multiline
          />
        </View>
      )}
    </>
  )
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useSheet(sheet)
  return (
    <Pressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  )
}

const sheet = paperSheet((C) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: 12, paddingBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.surfaceHigh },
  dotActive: { width: 18, backgroundColor: C.green },
  content: { padding: 20, gap: 16 },
  head: { gap: 4 },
  kicker: { fontSize: 12, fontWeight: "700", color: C.green, textTransform: "uppercase", letterSpacing: 0.8 },
  title: { fontSize: 28, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },
  lead: { fontSize: 17, color: C.textSecondary, marginTop: 6 },
  tallyRow: { flexDirection: "row", gap: 10 },
  tally: { flex: 1, borderWidth: 1, borderRadius: 18, paddingVertical: 14, alignItems: "center", backgroundColor: C.surface },
  tallyNum: { fontSize: 30, fontWeight: "800" },
  tallyLabel: { fontSize: 12, color: C.textSecondary, textAlign: "center" },
  card: { backgroundColor: C.surface, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12 },
  cardTitle: { fontSize: 12, fontWeight: "800", color: C.green, letterSpacing: 1, textTransform: "uppercase" },
  overviewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  overviewName: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  overviewVerdict: { fontSize: 13, fontWeight: "700" },
  verdict: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderRadius: 22, padding: 18, backgroundColor: C.surface },
  verdictLabel: { fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  verdictHeadline: { fontSize: 17, fontWeight: "600", color: C.textPrimary, marginTop: 2 },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  colHead: { width: 92, fontSize: 11, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  metricLabel: { fontSize: 14, color: C.textSecondary },
  metricBefore: { width: 92, fontSize: 15, color: C.textSecondary },
  metricAfterWrap: { width: 92, flexDirection: "row", alignItems: "center", gap: 4 },
  metricAfter: { flexShrink: 1, fontSize: 15, fontWeight: "700", color: C.textPrimary },
  question: { fontSize: 15, fontWeight: "600", color: C.textPrimary, marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border },
  chipSelected: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 14, fontWeight: "600", color: C.textPrimary },
  chipTextSelected: { color: C.bg },
  input: { minHeight: 64, borderRadius: 14, backgroundColor: C.surfaceHigh, color: C.textPrimary, padding: 12, fontSize: 15, textAlignVertical: "top" },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, backgroundColor: C.bg },
  btn: { height: 52, minWidth: 52, borderRadius: 16, backgroundColor: C.green, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 16 },
  btnSecondary: { backgroundColor: C.surfaceHigh },
  btnText: { fontSize: 16, fontWeight: "800", color: C.onAccent },
}))
