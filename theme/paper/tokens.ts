// Paper Send · Mint — design tokens (docs/design-system.md §2, §3, §9).
// Mint is the only action colour; pink is homework only.

export type PaperMode = "light" | "dark"

const light = {
  mode: "light" as PaperMode,
  paper: "#ECE7DE",
  paperGlow: null as string | null, // dark mode only: radial glow at the top
  ink: "#121014",
  mint: "#8AD6A2",
  mintDeep: "#2F9E63",
  mintText: "#2A7A4E", // mintDeep when used as text on paper
  onMint: "#121014",
  pink: "#C93D72",
  blockBlue: "#4B6BFF",
  textMuted: "#3D3644",
  label: "#4A3F55",
  hairline: "rgba(18,16,20,0.12)",
  card: "rgba(247,244,238,0.84)",
  cardBorder: "rgba(255,255,255,0.75)",
  iconCircle: "#121014",
  tabBar: "rgba(236,231,222,0.94)",
  grainOpacity: 0.32,
  meltOpacity: 1,
  // Component-level derived colours
  ghostBorder: "rgba(18,16,20,0.35)",
  inputFill: "rgba(18,16,20,0.06)",
  inputBorder: "rgba(18,16,20,0.18)",
  navRule: "#121014",
  ringIdle: "rgba(18,16,20,0.30)",
  weekPill: "#121014",
  addBarFill: "rgba(138,214,162,0.16)",
  addBarBorder: "#2A7A4E",
  chromaA: "rgba(47,158,99,0.90)", // left copy of the poster headline
  chromaB: "rgba(43,60,255,0.85)", // right copy
  glow: null as string | null, // hard offset shadows in light, glows in dark
}

export type PaperTheme = typeof light

const dark: PaperTheme = {
  mode: "dark",
  paper: "#0E0C12",
  paperGlow: "#1A1622",
  ink: "#F1ECE4",
  mint: "#8AD6A2",
  mintDeep: "#8AD6A2",
  mintText: "#8AD6A2",
  onMint: "#121014",
  pink: "#FF7AA8",
  blockBlue: "#4B6BFF",
  textMuted: "#CFC7DA",
  label: "#B9B0C6",
  hairline: "rgba(255,255,255,0.10)",
  card: "rgba(20,17,26,0.72)",
  cardBorder: "rgba(255,255,255,0.09)",
  iconCircle: "#1D3527",
  tabBar: "rgba(14,12,18,0.92)",
  grainOpacity: 0.2,
  meltOpacity: 0.85,
  ghostBorder: "rgba(255,255,255,0.30)",
  inputFill: "rgba(0,0,0,0.35)",
  inputBorder: "rgba(255,255,255,0.12)",
  navRule: "rgba(255,255,255,0.18)",
  ringIdle: "rgba(241,236,228,0.30)",
  weekPill: "#1D3527",
  addBarFill: "rgba(138,214,162,0.10)",
  addBarBorder: "#8AD6A2",
  chromaA: "rgba(138,214,162,0.85)",
  chromaB: "rgba(80,96,255,0.90)",
  glow: "#8AD6A2",
}

export const paperThemes = { light, dark }

export const melt = { mint: "#5FD08A", blue: "#2B3CFF", violet: "#7A2BD8" }

export const radius = { card: 26, cta: 30, button: 21, input: 16, addBar: 22 }

export const space = { gutter: 16, cardGap: 12, cardPad: 18, bottomPad: 120 }

// Static cuts of Archivo (wdth/wght instances of the variable font) and
// JetBrains Mono, loaded in app/_layout.tsx (scripts/design-system/make-fonts.py).
export const font = {
  poster: "Archivo-ExtraCondensedBlack", // width 62, weight 900
  title: "Archivo-CondensedBlack", // width 75, weight 900 — card titles, numbers
  body: "Archivo-SemiBold",
  bodyBold: "Archivo-Bold",
  bold: "Archivo-ExtraBold",
  mono: "JetBrainsMono-SemiBold",
  monoItalic: "JetBrainsMono-SemiBoldItalic",
}

export const fontFiles = {
  [font.poster]: require("@/assets/fonts/Archivo-ExtraCondensedBlack.ttf"),
  [font.title]: require("@/assets/fonts/Archivo-CondensedBlack.ttf"),
  [font.body]: require("@/assets/fonts/Archivo-SemiBold.ttf"),
  [font.bodyBold]: require("@/assets/fonts/Archivo-Bold.ttf"),
  [font.bold]: require("@/assets/fonts/Archivo-ExtraBold.ttf"),
  [font.mono]: require("@/assets/fonts/JetBrainsMono-SemiBold.ttf"),
  [font.monoItalic]: require("@/assets/fonts/JetBrainsMono-SemiBoldItalic.ttf"),
}

// Shared text styles (sizes in pt). Letter-spacing in RN is absolute, so the
// doc's em values are pre-multiplied by the size.
export const type = {
  poster: { fontFamily: font.poster, fontSize: 82, lineHeight: 82 * 0.86, letterSpacing: -1.6 },
  headlineInput: { fontFamily: font.poster, fontSize: 58, lineHeight: 58 * 0.9, letterSpacing: -1.2 },
  cardTitle: { fontFamily: font.title, fontSize: 26, letterSpacing: -0.3 },
  number: { fontFamily: font.title },
  nav: { fontFamily: font.bold, fontSize: 17 },
  greeting: { fontFamily: font.bold, fontSize: 24 },
  body: { fontFamily: font.body, fontSize: 15 },
  listLabel: { fontFamily: font.bodyBold, fontSize: 16 },
  mono: { fontFamily: font.mono, fontSize: 10.5, letterSpacing: 1.3 },
}
