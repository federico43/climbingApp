import React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { C } from "@/utils/theme"

// ─── Top Bar ──────────────────────────────────────────────────────────────────

export function TopBar({
  title,
  onBack,
  right,
  hideBorder,
}: {
  title?: string
  onBack?: () => void
  right?: React.ReactNode
  hideBorder?: boolean
}) {
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

export const topBar_styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
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
})

// ─── Shared ───────────────────────────────────────────────────────────────────

export const shared_styles = StyleSheet.create({
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
})

// ─── Action buttons (in-session) ─────────────────────────────────────────────
// Used for "Record attempt" / "Log without video" style buttons

export const rest_styles = StyleSheet.create({
  restHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  restTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
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
    color: C.bg,
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
  },
})

// ─── Ready phase ──────────────────────────────────────────────────────────────

export const ready_styles = StyleSheet.create({
  progressValue: {
    fontSize: 64,
    fontWeight: "700",
    marginVertical: 20,
    color: C.textPrimary,
  },
  progressLabel: {
    fontSize: 13,
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
})

// ─── Review phase ─────────────────────────────────────────────────────────────

export const review_styles = StyleSheet.create({
  reviewRow: {
    width: "100%",
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
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
})

// ─── Constraint warmup ────────────────────────────────────────────────────────

export const warmup_styles = StyleSheet.create({
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
})
