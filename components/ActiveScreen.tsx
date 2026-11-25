import { BlockNotes } from "@/components/BlockNotes"
import { TimerRing } from "@/components/IntervalVisuals"
import { CardTitle, IconButton, Mono, StartBar } from "@/components/paper"
import { usePaper } from "@/theme/paper/PaperThemeProvider"
import type { NoteChip } from "@/utils/blockNotes"
import { fitDialSize } from "@/utils/timerDial"
import { Ionicons } from "@expo/vector-icons"
import React, { useState } from "react"
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native"

type IconName = React.ComponentProps<typeof Ionicons>["name"]
type RingProps = React.ComponentProps<typeof TimerRing>

// A block's running screen (Federico's mock-up 2026-11-25, the warm-up at
// 1:22). Under the workout's own header: a title row (back, the block's name,
// a mono meta line such as "8:00 total"), the coach's steps in the numbered
// card (BlockNotes compact, with any colour chips), the timer dial as big as
// the room left allows, and the ink bar that ends the part, with what comes
// next on its mono line ("Next · one question").
// With `children` (e.g. the spray wall viewer) they take the room and the
// dial, if any, sits small under them (the breathing screen has none).
export function ActiveScreen({ title, meta, onBack, notes, words, chips, ring, action, children }: {
  title: string
  /** Mono line right of the title, e.g. "8:00 total". */
  meta?: string | null
  onBack?: () => void
  /** The coach's steps (one per line or sentence). */
  notes?: string | null
  /** Extra words to highlight in the notes. */
  words?: string[]
  /** Colour chips under a step of the notes, by step index (0 = first). */
  chips?: Record<number, NoteChip[]>
  /** The dial; ActiveScreen sizes it. What comes next goes on the bar, not under the dial. */
  ring?: Omit<RingProps, "size" | "next">
  /** The ink bar at the bottom. `next`: what comes after it, e.g. "one question". */
  action: { label: string; next?: string; icon?: IconName; onPress: () => void }
  children?: React.ReactNode
}) {
  const t = usePaper()
  const { height: windowH } = useWindowDimensions()
  const [size, setSize] = useState(0)

  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        {onBack && <IconButton icon="chevron-back" label="Back" size={40} onPress={onBack} />}
        <CardTitle size={22} numberOfLines={1} style={styles.title}>{title}</CardTitle>
        {!!meta && <Mono color={t.ink} numberOfLines={1}>{meta}</Mono>}
      </View>
      {!!notes?.trim() && (
        // Long notes scroll inside the top third, so the dial keeps its room.
        <ScrollView style={{ flexGrow: 0, maxHeight: Math.round(windowH * 0.3) }} showsVerticalScrollIndicator={false}>
          <BlockNotes text={notes} compact words={words} chips={chips} />
        </ScrollView>
      )}
      {children ? (
        <>
          <View style={styles.children}>{children}</View>
          {ring && (
            <View style={styles.ringSmall}>
              <TimerRing {...ring} size={150} />
            </View>
          )}
        </>
      ) : (
        <View
          style={styles.ringArea}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout
            setSize(fitDialSize(width - 32, height - 16))
          }}
        >
          {ring && size > 0 && <TimerRing {...ring} size={size} />}
        </View>
      )}
      <View style={styles.footer}>
        <StartBar
          offset
          label={action.label}
          sub={action.next ? `Next · ${action.next}` : undefined}
          icon={action.icon ?? "checkmark"}
          onPress={action.onPress}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingHorizontal: 16, paddingTop: 10 },
  title: { flex: 1 },
  children: { flex: 1, marginTop: 12 },
  ringSmall: { alignItems: "center", paddingTop: 8 },
  ringArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
})
