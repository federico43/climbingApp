import { noteParts, noteSteps, slideAt } from "@/utils/blockNotes"
import { paperSheet, useSheet } from "@/theme/paper/legacy"
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
// `compact` is the small, title-less list for running screens.
export function BlockNotes({ text, title = "Coach notes", compact = false, words }: {
  text: string | null | undefined
  title?: string
  compact?: boolean
  /** Extra words to highlight (e.g. CONSTRAINT_WORDS). */
  words?: string[]
}) {
  const styles = useSheet(sheet)
  const steps = noteSteps(text)
  if (steps.length === 0) return null
  if (!compact && steps.length > 1) return <NoteSlides steps={steps} title={title} words={words} />
  const numbered = steps.length > 1

  return (
    <View style={compact ? styles.compact : styles.card}>
      {!compact && <Text style={styles.title}>{title}</Text>}
      {steps.map((step, i) => (
        <View key={i} style={styles.step}>
          {numbered && (
            <View style={[styles.num, compact && styles.numCompact]}>
              <Text style={[styles.numText, compact && styles.numTextCompact]}>{i + 1}</Text>
            </View>
          )}
          <Text style={[styles.text, compact && styles.textCompact]}>
            <StepText step={step} words={words} />
          </Text>
        </View>
      ))}
    </View>
  )
}

function StepText({ step, words }: { step: string; words?: string[] }) {
  const styles = useSheet(sheet)
  return (
    <>
      {noteParts(step, words).map((p, j) => p.key
        ? <Text key={j} style={styles.key}>{p.text}</Text>
        : p.text)}
    </>
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
  compact: { alignSelf: "stretch", paddingHorizontal: 20, gap: 6 },
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
  numCompact: { width: 18, height: 18, borderRadius: 9, marginTop: 1 },
  numText: { fontSize: 13, fontWeight: "700", color: C.green, ...(P && { fontFamily: font.mono, fontSize: 11, color: P.mint }) },
  numTextCompact: { fontSize: 11 },
  text: { flex: 1, fontSize: 16, lineHeight: 24, color: C.textPrimary },
  textCompact: { fontSize: 14, lineHeight: 20, color: C.textSecondary },
  key: { color: C.green, fontWeight: "700" },
  slide: { minHeight: 96, justifyContent: "center", paddingVertical: 4 },
  slideText: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: C.textPrimary },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.textMuted },
  dotOn: { width: 18, backgroundColor: C.green },
}))
