import { C } from "@/utils/theme"
import { StyleSheet } from "react-native"

// Shared look of the coach dashboard's cards (docs/coach-dashboard.md).
export const card = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 13, fontWeight: "800", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  sub: { fontSize: 12, color: C.textSecondary },
  empty: { fontSize: 13, color: C.textMuted },
  link: { fontSize: 13, fontWeight: "700", color: C.green },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  primaryBtnText: { fontSize: 12.5, fontWeight: "800", color: C.bg },
  outlineBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderColor: C.green, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  outlineBtnText: { fontSize: 12.5, fontWeight: "700", color: C.green },
})
