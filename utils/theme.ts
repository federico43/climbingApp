export const C = {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  bg:          "#141416",   // base background — all screens
  surface:     "#1C1C1F",   // cards, sheets, modals
  surfaceHigh: "#232326",   // inputs, pressed chips, active states

  // ── Borders ───────────────────────────────────────────────────────────────
  border:      "rgba(255,255,255,0.08)",

  // ── Text ──────────────────────────────────────────────────────────────────
  textPrimary:   "#F2F2F2",
  textSecondary: "#8A8A8E",
  textMuted:     "#5A5A5E",

  // ── Accents ───────────────────────────────────────────────────────────────
  green:     "#6FCF97",     // primary action · go · active · start holds
  greenDeep: "#4FAE82",     // secondary green
  red:       "#DB504A",     // failure · urgency · delete · no send
  yellow:    "#FED766",     // success · score · achievement · finish holds
} as const
