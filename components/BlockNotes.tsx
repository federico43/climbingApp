import { BoulderLevelOptions } from "@/utils/boulderColours"
import { colourParts, noteParts, noteSteps } from "@/utils/blockNotes"
import { C } from "@/utils/theme"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

// The coach's instructions on a block intro: a card with a title, one
// numbered step per line or sentence, and the key numbers (plus *starred*
// text and any `words`) in green.
// `compact` is the small, title-less version for running screens.
// `colourChips` shows boulder colour names as chips of that colour.
export function BlockNotes({ text, title = "Coach notes", compact = false, words, colourChips = false }: {
  text: string | null | undefined
  title?: string
  compact?: boolean
  /** Extra words to highlight (e.g. CONSTRAINT_WORDS). */
  words?: string[]
  colourChips?: boolean
}) {
  // A colour name as a chip (black text; white on the black chip).
  const withChips = (t: string, key: number, style?: object) => {
    if (!colourChips) return style ? <Text key={key} style={style}>{t}</Text> : t
    return colourParts(t).map((c, k) => {
      if (!c.colour) return <Text key={`${key}-${k}`} style={style}>{c.text}</Text>
      const bg = BoulderLevelOptions.find((o) => o.value === c.colour)!.color
      return (
        <View key={`${key}-${k}`} style={[styles.chip, { backgroundColor: bg }]}>
          <Text style={[styles.chipText, compact && styles.chipTextCompact, c.colour === "black" && { color: "#fff" }]}>{c.text}</Text>
        </View>
      )
    })
  }

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
            {noteParts(step, words).map((p, j) => withChips(p.text, j, p.key ? styles.key : undefined))}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
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
  },
  numCompact: { width: 18, height: 18, borderRadius: 9, marginTop: 1 },
  numText: { fontSize: 13, fontWeight: "700", color: C.green },
  numTextCompact: { fontSize: 11 },
  text: { flex: 1, fontSize: 16, lineHeight: 24, color: C.textPrimary },
  textCompact: { fontSize: 14, lineHeight: 20, color: C.textSecondary },
  key: { color: C.green, fontWeight: "700" },
  chip: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, transform: [{ translateY: 3 }] },
  chipText: { color: "#000", fontSize: 14, fontWeight: "700" },
  chipTextCompact: { fontSize: 12 },
})
