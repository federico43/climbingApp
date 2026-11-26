import { noteParts, noteSteps, slideAt, type NoteChip } from "@/utils/blockNotes"
import { onInk, paperSheet, usePaperScope, useSheet } from "@/theme/paper/legacy"
import { font } from "@/theme/paper/tokens"
import React, { useEffect, useRef, useState } from "react"
import {
  NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native"

// The coach's instructions on a block intro: a card with a title and one
// step per line or sentence, the key numbers (plus *starred* text and any
// `words`) in green.
// Several steps become swipeable slides, one idea per slide, with dots and a
// "2 / 4" counter; a tap on the slide goes to the next one.
// `compact` is the card for running screens (Federico's mock-up 2026-11-25):
// no title, every step at once, numbered in ink circles, key phrases in bold
// green, and colour chips under a step (`chips`, by step index).
export function BlockNotes({ text, title = "Coach notes", compact = false, words, chips }: {
  text: string | null | undefined
  title?: string
  compact?: boolean
  /** Extra words to highlight (e.g. CONSTRAINT_WORDS). */
  words?: string[]
  /** Running screens: colour chips under a step, by step index (0 = first). */
  chips?: Record<number, NoteChip[]>
}) {
  const styles = useSheet(sheet)
  const steps = noteSteps(text)
  if (steps.length === 0) return null
  if (compact) return <RunningNotes steps={steps} words={words} chips={chips} />
  if (steps.length > 1) return <NoteSlides steps={steps} title={title} words={words} />

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>
        <StepText step={steps[0]} words={words} />
      </Text>
    </View>
  )
}

function StepText({ step, words, keyStyle }: { step: string; words?: string[]; keyStyle?: object }) {
  const styles = useSheet(sheet)
  return (
    <>
      {noteParts(step, words).map((p, j) => p.key
        ? <Text key={j} style={keyStyle ?? styles.key}>{p.text}</Text>
        : p.text)}
    </>
  )
}

// The running screen's card: "1 Easy routes *below your flash level*…" with
// the chips under their step.
function RunningNotes({ steps, words, chips }: { steps: string[]; words?: string[]; chips?: Record<number, NoteChip[]> }) {
  const styles = useSheet(sheet)
  const numbered = steps.length > 1
  return (
    <View style={styles.running}>
      {steps.map((step, i) => (
        <View key={i} style={styles.step}>
          {numbered && (
            <View style={styles.runNum}>
              <Text style={styles.runNumText}>{i + 1}</Text>
            </View>
          )}
          <View style={styles.runBody}>
            <Text style={styles.runText}>
              <StepText step={step} words={words} keyStyle={styles.runKey} />
            </Text>
            {!!chips?.[i]?.length && <ChipRow chips={chips[i]} />}
          </View>
        </View>
      ))}
    </View>
  )
}

/** Route colour chips: a dot and the name; a struck one is dashed and crossed out. */
function ChipRow({ chips }: { chips: NoteChip[] }) {
  const styles = useSheet(sheet)
  const P = usePaperScope()
  // Inline, not in the sheet: the Paper pass would turn a light white wash into ink.
  const fill = P ? (P.mode === "light" ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.06)") : "transparent"
  return (
    <View style={styles.chips}>
      {chips.map((c) => (
        <View
          key={c.label}
          style={[styles.chip, c.struck ? styles.chipStruck : { backgroundColor: fill }]}
          accessible
          accessibilityLabel={c.struck ? `Not ${c.label}` : c.label}
        >
          <View style={[styles.chipDot, { backgroundColor: c.color }]} />
          <Text style={[styles.chipText, c.struck && styles.chipTextStruck]}>{c.label}</Text>
        </View>
      ))}
    </View>
  )
}

function NoteSlides({ steps, title, words }: { steps: string[]; title: string; words?: string[] }) {
  const styles = useSheet(sheet)
  const [width, setWidth] = useState(0)
  const [index, setIndex] = useState(0)
  const pager = useRef<ScrollView>(null)
  const count = steps.length
  const textKey = steps.join("\n")

  // New notes (another block) start again from the first slide.
  useEffect(() => {
    setIndex(0)
    pager.current?.scrollTo({ x: 0, animated: false })
  }, [textKey])

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(count - 1, i))
    setIndex(next)
    pager.current?.scrollTo({ x: next * width, animated: true })
  }
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(slideAt(e.nativeEvent.contentOffset.x, width, count))

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.counter}>{index + 1} / {count}</Text>
      </View>
      <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {width > 0 && (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            scrollEventThrottle={16}
          >
            {steps.map((step, i) => (
              <Pressable
                key={i}
                style={[styles.slide, { width }]}
                onPress={() => goTo(i + 1)}
                disabled={i === count - 1}
                accessibilityHint={i < count - 1 ? "Next instruction" : undefined}
              >
                <Text style={styles.slideText}>
                  <StepText step={step} words={words} />
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
      <View style={styles.dots}>
        {steps.map((_, i) => (
          <Pressable key={i} onPress={() => goTo(i)} hitSlop={6}>
            <View style={[styles.dot, i === index && styles.dotOn]} />
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const sheet = paperSheet((C, P) => StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    // Paper: frosted card floating over the melt.
    ...(P && { backgroundColor: P.card, borderWidth: 1, borderColor: P.cardBorder, borderRadius: 26, padding: 18 }),
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: {
    fontSize: 12, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  counter: { fontSize: 12, fontWeight: "700", color: C.textMuted },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  num: {
    width: 24, height: 24, borderRadius: 12, marginTop: 1,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
    ...(P && { backgroundColor: P.iconCircle }),
  },
  numText: { fontSize: 13, fontWeight: "700", color: C.green, ...(P && { fontFamily: font.mono, fontSize: 11, color: P.mint }) },
  text: { flex: 1, fontSize: 16, lineHeight: 24, color: C.textPrimary },
  key: { color: C.green, fontWeight: "700" },

  // Running screens (RunningNotes)
  running: {
    alignSelf: "stretch", marginHorizontal: 16, marginTop: 12, padding: 16, gap: 12,
    backgroundColor: C.surface, borderRadius: 16,
    ...(P && { backgroundColor: P.card, borderWidth: 1, borderColor: P.cardBorder, borderRadius: 22 }),
  },
  runNum: {
    width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center",
    backgroundColor: P ? P.ink : C.textPrimary,
  },
  runNumText: { fontSize: 12, color: P ? onInk(P) : C.bg, ...(P ? { fontFamily: font.bold } : { fontWeight: "800" }) },
  runBody: { flex: 1, gap: 8 },
  runText: { fontSize: 15, lineHeight: 21, color: C.textPrimary, ...(P ? { fontFamily: font.body } : { fontWeight: "600" }) },
  runKey: { color: C.green, ...(P ? { fontFamily: font.bold } : { fontWeight: "800" }) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 9, paddingRight: 11,
    borderRadius: 14, borderWidth: 1, borderColor: P ? P.hairline : C.border,
  },
  chipStruck: { borderStyle: "dashed", borderColor: P ? P.ghostBorder : C.textMuted },
  chipDot: { width: 9, height: 9, borderRadius: 4.5 },
  chipText: { fontSize: 12.5, color: C.textPrimary, ...(P ? { fontFamily: font.bold } : { fontWeight: "800" }) },
  chipTextStruck: { color: C.textMuted, textDecorationLine: "line-through" },
  slide: { minHeight: 96, justifyContent: "center", paddingVertical: 4 },
  slideText: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: C.textPrimary },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.textMuted },
  dotOn: { width: 18, backgroundColor: C.green },
}))
