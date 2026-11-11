import { noteParts, noteSteps } from "@/utils/blockNotes"
import { paperSheet, useSheet } from "@/theme/paper/legacy"
import { font } from "@/theme/paper/tokens"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

// The coach's instructions on a block intro: a card with a title, one
// numbered step per line or sentence, and the key numbers (plus *starred*
// text and any `words`) in green.
// `compact` is the small, title-less version for running screens.
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
            {noteParts(step, words).map((p, j) => p.key
              ? <Text key={j} style={styles.key}>{p.text}</Text>
              : p.text)}
          </Text>
        </View>
      ))}
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
  title: {
    fontSize: 12, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.8,
  },
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
}))
