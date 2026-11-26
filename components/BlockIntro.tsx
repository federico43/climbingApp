import { BlockNotes } from "@/components/BlockNotes"
import { IconButton, Melt, Mono, PosterHeadline, posterSize, StartBar } from "@/components/paper"
import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { introMeta, shortNoteParts } from "@/utils/blockIntro"
import { Ionicons } from "@expo/vector-icons"
import React, { useState } from "react"
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

// A block's idle screen before it starts (mock-ups 2026-11-25, "B · Idle"):
// the block name as a huge poster, the melt filling the screen under it, a
// mono meta line ("4 MIN · 6 ROUNDS · NOSE IN · MOUTH OUT") and the ink Start
// bar at the bottom. The workout's own header (Block 01 / 03, ⋯, close,
// progress) sits above it, inside the safe area.
//
// A short coach note rides on the meta line; a longer one keeps its notes
// card, which scrolls between the poster and the meta line with any
// block-specific content (`children`).
export function BlockIntro({
  title, onBack, facts = [], note, notesTitle, children,
  startLabel = "Start", startSub, startIcon = "play", onStart, startDisabled,
}: {
  title: string
  onBack?: () => void
  /** Meta line facts, e.g. ["4 min", "6 rounds"]; empty ones are skipped. */
  facts?: (string | null | undefined | false)[]
  /** The coach's note (block description). */
  note?: string | null
  notesTitle?: string
  children?: React.ReactNode
  startLabel?: string
  /** Mono line under the label, e.g. "Free session · 4 min". */
  startSub?: string
  startIcon?: IconName
  onStart: () => void
  startDisabled?: boolean
}) {
  const t = usePaper()
  const { width } = useWindowDimensions()
  const [height, setHeight] = useState(0)
  const [posterBottom, setPosterBottom] = useState(0)
  const meta = introMeta(facts, note)
  const longNote = note?.trim() && !shortNoteParts(note) ? note : null
  const size = Math.min(82, posterSize(title, 82, width))
  // The melt starts half way down the poster and runs to the bottom.
  const meltTop = Math.max(0, posterBottom - size)

  return (
    <View style={styles.root} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {height > 0 && posterBottom > 0 && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
          <Melt top={meltTop} height={Math.max(200, height - meltTop)} />
        </View>
      )}
      {onBack && (
        <View style={styles.backRow}>
          <IconButton icon="chevron-back" label="Previous block" size={34} onPress={onBack} />
        </View>
      )}
      <View
        style={[styles.poster, { marginTop: onBack ? 4 : 18 }]}
        onLayout={(e) => setPosterBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      >
        <PosterHeadline size={size}>{title}</PosterHeadline>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!!longNote && <BlockNotes text={longNote} title={notesTitle} />}
        {children}
      </ScrollView>
      <View style={styles.footer}>
        {!!meta && <Mono color={t.ink} numberOfLines={2} style={styles.meta}>{meta}</Mono>}
        <StartBar label={startLabel} sub={startSub} icon={startIcon} onPress={onStart} disabled={startDisabled} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backRow: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 4 },
  poster: { paddingHorizontal: 16 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12, gap: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 12 },
  meta: { lineHeight: 16 },
})
