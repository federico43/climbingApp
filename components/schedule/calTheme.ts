import { font } from "@/theme/paper/tokens"

// Paper Mint (dark) for the class calendar screens (Claude Design spec
// "Classes calendar", §3). Same keys as the old `C` palette so the screens
// swap one import; mint is the only action colour, red only for sessions
// running out. No gradient behind the calendar: plain paper.
export const K = {
  bg: "#0E0C12",
  surface: "#17141D",       // sheets, cards
  surfaceHigh: "#221E2A",   // event blocks, inputs
  popover: "#1C1823",
  openBg: "#24202C",        // a class you can join
  border: "rgba(255,255,255,0.08)",
  hair2: "rgba(255,255,255,0.05)",
  textPrimary: "#F1ECE4",
  textSecondary: "#CFC7DA",
  textMuted: "#8D859A",
  label: "#B9B0C6",
  green: "#8AD6A2",         // mint
  greenDeep: "#2F9E63",
  onMint: "#121014",
  red: "#F07167",
  yellow: "#8AD6A2",        // "waiting" is mint (dashed), not yellow, in Paper Mint
  side: "#A78BFA",
  past: "#6F687B",
} as const

export const KF = font
