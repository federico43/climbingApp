import React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { CardTitle, IconButton, Melt, PosterHeadline, posterSize } from "@/components/paper"
import { paperSheet, usePaperScope, useSheet } from "@/theme/paper/legacy"
import { font } from "@/theme/paper/tokens"

// ─── Top Bar ──────────────────────────────────────────────────────────────────

export function TopBar({
  title,
  onBack,
  right,
  hideBorder,
  poster,
}: {
  title?: string
  onBack?: () => void
  right?: React.ReactNode
  hideBorder?: boolean
  /** Paper Mint: the block's name as the screen's poster headline (block intros). */
  poster?: boolean
}) {
  const topBar_styles = useSheet(topBar_stylesSheet)
  const paper = usePaperScope()
  if (paper) {
    const big = poster && !!title
    return (
      <View style={[topBar_styles.bar, (hideBorder || big) && { borderBottomWidth: 0 }]}>
        {big && <Melt top={44} height={300} />}
        <View style={topBar_styles.row}>
          <View style={topBar_styles.side}>
            {onBack ? <IconButton icon="chevron-back" label="Back" size={34} onPress={onBack} /> : null}
          </View>
          {big ? <View style={{ flex: 1 }} /> : (
            <CardTitle size={20} numberOfLines={1} style={{ flex: 1, textAlign: "center" }}>{title ?? ""}</CardTitle>
          )}
          <View style={[topBar_styles.side, { alignItems: "flex-end" }]}>{right}</View>
        </View>
        {big && <PosterHeadline size={Math.min(64, posterSize(title!, 64))} style={{ marginTop: 10 }}>{title!}</PosterHeadline>}
      </View>
    )
  }
  return (
    <View style={[topBar_styles.bar, hideBorder && { borderBottomWidth: 0 }]}>
      <Pressable
        onPress={onBack}
        disabled={!onBack}
        style={topBar_styles.side}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        {onBack ? <Text style={topBar_styles.backText}>←</Text> : null}
      </Pressable>
      <Text style={topBar_styles.title} numberOfLines={1}>
        {title ?? ""}
      </Text>
      <View style={[topBar_styles.side, { alignItems: "flex-end" }]}>{right}</View>
    </View>
  )
}

export const topBar_stylesSheet = paperSheet((C, P) => StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    backgroundColor: C.bg,
    // Paper: nav bar with a 1.5px rule beneath; the poster headline stacks under the row.
    ...(P && { flexDirection: "column", alignItems: "stretch", paddingVertical: 8, borderBottomWidth: 1.5, borderBottomColor: P.navRule }),
  },
  row: { flexDirection: "row", alignItems: "center", minHeight: 36 },
  side: {
    width: 40,
    justifyContent: "center",
  },
  backText: {
    fontSize: 22,
    color: C.textSecondary,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
}))

// ─── Shared ───────────────────────────────────────────────────────────────────

export const shared_stylesSheet = paperSheet((C, P) => StyleSheet.create({
  // full-screen wrapper — no padding
  screen: {
    flex: 1,
    backgroundColor: C.bg,
  },
  // intro scrollable content area
  introContent: {
    flexGrow: 1,
    padding: 24,
    gap: 20,
  },
  // Start button pinned under a scrolling intro: always visible.
  footer: { backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36, ...(P && { paddingHorizontal: 16, paddingBottom: 28 }) },
  // centered non-scroll content (ready / active phases)
  container: {
    flex: 1,
    width: "100%",
    padding: 20,
    alignItems: "center",
  },
  // legacy — kept for compatibility
  safeContainer: {
    flexGrow: 1,
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    color: C.textPrimary,
    marginBottom: 10,
    textAlign: "center",
    ...(P && { fontFamily: font.title, textTransform: "uppercase", letterSpacing: -0.3, fontSize: 30, lineHeight: 30 }),
  },
  description: {
    fontSize: 16,
    color: C.textSecondary,
    lineHeight: 24,
  },
  // legacy floating back button — no longer used in blocks
  backBtn: {
    alignSelf: "flex-start",
    paddingBottom: 16,
  },
  backBtnText: {
    fontSize: 22,
    color: C.textMuted,
  },
}))

// ─── Action buttons (in-session) ─────────────────────────────────────────────
// Used for "Record attempt" / "Log without video" style buttons

export const rest_stylesSheet = paperSheet((C, P) => StyleSheet.create({
  restHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  restTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
    ...(P && { fontFamily: font.title, textTransform: "uppercase", letterSpacing: -0.3, fontSize: 30 }),
  },
  restSubtitle: {
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 4,
  },
  timer: {
    fontSize: 42,
    fontWeight: "700",
    textAlign: "center",
    color: C.textPrimary,
    ...(P && { fontSize: 72, letterSpacing: -1, fontVariant: ["tabular-nums"] }),
  },
  question: {
    fontSize: 18,
    textAlign: "center",
    marginVertical: 20,
    color: C.textPrimary,
  },
  restButtonGroup: {
    width: "100%",
    gap: 10,
    marginTop: 8,
  },
  // Primary in-session action (Record attempt, Yes ✓)
  yesButton: {
    width: "100%",
    backgroundColor: C.green,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  yesButtonText: {
    color: C.onAccent,
    fontSize: 16,
    fontWeight: "700",
  },
  // Secondary in-session action (Log without video, No)
  noButton: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: C.border,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: C.surface,
    ...(P && { backgroundColor: "transparent", borderColor: P.ghostBorder, borderRadius: 26 }),
  },
  noButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: C.textSecondary,
  },
  notesWrapper: {
    width: "100%",
    gap: 10,
    marginTop: 8,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: C.textPrimary,
    backgroundColor: C.surfaceHigh,
    minHeight: 80,
    textAlignVertical: "top",
    ...(P && { backgroundColor: P.inputFill, borderColor: P.inputBorder, borderWidth: 1.5, borderRadius: 16 }),
  },
}))

// ─── Ready phase ──────────────────────────────────────────────────────────────

export const ready_stylesSheet = paperSheet((C, P) => StyleSheet.create({
  progressValue: {
    fontSize: 64,
    fontWeight: "700",
    marginVertical: 20,
    color: C.textPrimary,
    ...(P && { fontSize: 88, letterSpacing: -1 }),
  },
  progressLabel: {
    fontSize: 13,
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
}))

// ─── Review phase ─────────────────────────────────────────────────────────────

export const review_stylesSheet = paperSheet((C, P) => StyleSheet.create({
  reviewRow: {
    width: "100%",
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    ...(P && { backgroundColor: P.card, borderWidth: 1, borderColor: P.cardBorder, borderRadius: 20 }),
  },
  reviewText: {
    fontSize: 16,
    fontWeight: "500",
    color: C.textPrimary,
  },
  reviewNotes: {
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 4,
  },
}))

// ─── Constraint warmup ────────────────────────────────────────────────────────

export const warmup_stylesSheet = paperSheet((C, P) => StyleSheet.create({
  blockName: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: C.textSecondary,
    marginBottom: 8,
  },
  level: {
    fontSize: 48,
    fontWeight: "800",
    textTransform: "capitalize",
    textAlign: "center",
    color: C.textPrimary,
    marginBottom: 16,
    ...(P && { textTransform: "uppercase", fontSize: 56 }),
  },
  progress: {
    fontSize: 18,
    fontWeight: "500",
    color: C.textPrimary,
    marginVertical: 10,
  },
  buttonWrapper: {
    marginTop: 15,
    width: "100%",
  },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "black",
  },
}))
