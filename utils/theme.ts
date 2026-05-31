export const C = {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  bg:          "#242325",   // base background — all screens
  surface:     "#2D2B2E",   // cards, sheets, modals
  surfaceHigh: "#353335",   // inputs, pressed chips, active states

  // ── Borders ───────────────────────────────────────────────────────────────
  border:      "#3D3B3E",

  // ── Text ──────────────────────────────────────────────────────────────────
  textPrimary:   "#F5F2EE", // warm white — readable on all dark surfaces
  textSecondary: "#888888",
  textMuted:     "#555555",

  // ── Accents ───────────────────────────────────────────────────────────────
  green:     "#62C99A",     // primary action · go · active · start holds
  greenDeep: "#2E9E82",     // secondary green
  red:       "#DB504A",     // failure · urgency · delete · no send
  yellow:    "#FED766",     // success · score · achievement · finish holds
} as const
