import { paperSheet } from "@/theme/paper/legacy"
import { font } from "@/theme/paper/tokens"
import { StyleSheet } from "react-native"

// Shared look of the coach dashboard's cards (docs/coach-dashboard.md).
// In a component: `const card = useSheet(cardSheet)`.
// Paper Mint (design chat, coach athlete page 2026-11-22): frosted card,
// radius 28, mono ink title, pill buttons (mint = the action, ink outline
// = the rest).
export const cardSheet = paperSheet((C, P) => StyleSheet.create({
  card: P
    ? { backgroundColor: P.card, borderRadius: 28, borderWidth: 1, borderColor: P.cardBorder, padding: 20, gap: 14 }
    : { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: P
    ? { fontFamily: font.mono, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: P.ink }
    : { fontSize: 13, fontWeight: "800", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  sub: { fontSize: 12, color: C.textSecondary },
  empty: { fontSize: 13, color: C.textMuted },
  link: { fontSize: 13, fontWeight: "700", color: C.green },
  primaryBtn: P
    ? {
      flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
      backgroundColor: P.mint, borderRadius: 999, borderWidth: 1.5, borderColor: P.mode === "light" ? P.ink : P.mint,
      paddingHorizontal: 16, minHeight: 40, justifyContent: "center",
    }
    : {
      flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
      backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
    },
  primaryBtnText: { fontSize: P ? 14 : 12.5, fontWeight: "800", color: C.bg },
  outlineBtn: P
    ? {
      flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center",
      borderWidth: 1.5, borderColor: P.ink, borderRadius: 999, paddingHorizontal: 14, minHeight: 40,
    }
    : {
      flexDirection: "row", alignItems: "center", gap: 5,
      borderWidth: 1, borderColor: C.green, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    },
  outlineBtnText: { fontSize: P ? 14 : 12.5, fontWeight: "700", color: P ? P.ink : C.green },
}))
