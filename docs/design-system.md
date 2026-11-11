# Paper Send · Mint — WorkoutTracker design system

Visual rules for every screen of WorkoutTracker (Federico's climbing training app, React Native/Expo). Apply them to any new screen, mockup or component unless told otherwise. Reference screens: Home (light + dark) and New workout (light + dark).

The look: a poster on paper, inspired by grainy, gradient-heavy illustration. Huge condensed type with a chromatic offset, a blurred liquid gradient "melting" out of the headline, frosted cards floating on top, and **mint as the only action colour**.

---

## 1. Core principles (never break)

1. **One poster headline per screen**: the most meaningful word on that screen (week focus, workout name, block name), huge, uppercase, condensed, with the chromatic shadow.
2. **One melt per screen**: a blurred liquid gradient behind/below the headline, as if the letters are melting. Top area only.
3. **Content lives in frosted cards** that float over the gradient.
4. **Mint = action.** Only actions, trained/completed states and the active tab are mint. No other accent for buttons.
5. **Pink = homework / coach-assigned**, nothing else.
6. **Film grain covers the entire screen**, cards included.
7. **Small labels are monospace, uppercase, widely tracked**, like credits on a poster.

---

## 2. Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#ECE7DE` | `#0E0C12` (+ radial glow `#1A1622` at top) | screen background |
| `ink` | `#121014` | `#F1ECE4` | text, outlines |
| `mint` | `#8AD6A2` | `#8AD6A2` | primary buttons, trained state, active tab, "+" chips |
| `mintDeep` | `#2F9E63` (as text on paper: `#2A7A4E`) | `#8AD6A2` | focus rings, "today" ring, progress fill, status text |
| `onMint` | `#121014` | `#121014` | text/icons ON mint, both modes |
| `pink` | `#C93D72` | `#FF7AA8` | homework only |
| `blockBlue` | `#4B6BFF` | `#4B6BFF` | category dot for warm-up blocks |
| `textMuted` | `#3D3644` | `#CFC7DA` | secondary body text |
| `label` | `#4A3F55` | `#B9B0C6` | mono eyebrows / field labels |
| `hairline` | `rgba(18,16,20,.12)` | `rgba(255,255,255,.10)` | dividers |
| `card` | `rgba(247,244,238,.84)`, border `rgba(255,255,255,.75)` | `rgba(20,17,26,.72)`, border `rgba(255,255,255,.09)` | cards, backdrop blur 14 |
| `iconCircle` | `#121014` | `#1D3527` | round icon backgrounds (icon itself mint) |
| `tabBar` | `rgba(236,231,222,.94)` | `rgba(14,12,18,.92)` | frosted tab bar |

**Melt colours:** mint `#5FD08A` / `#6FDC98`, electric blue `#2B3CFF` / `#3A46FF`, violet `#7A2BD8`. No red or orange in this system.

---

## 3. Typography

**Archivo** (variable, width 62–125, weight 300–900) for everything except labels.

| Role | Spec |
|---|---|
| Poster headline (screen focus word) | 82px, weight 900, width 62%, uppercase, letter-spacing −0.02em, line-height 0.82 |
| Headline input (workout name) | 58px, same style; placeholder "UNTITLED" |
| Card title | 22–44px, weight 900, width 70–78%, uppercase |
| Numbers (grades, counts, dates) | weight 900, width 75% |
| Greeting / nav title | 15–26px, weight 800 |
| Body / list items | 13–16px, weight 600–800 |

- Long focus phrases wrap one word per line ("POWER / ENDURANCE"). Size the headline for the longest word (~9 letters fit at 82px in a 390pt-wide screen).
- **Chromatic shadow** on poster headlines:
  - Light: `-3px 1px #2F9E63 @90%`, `3px -1px #2B3CFF @85%`
  - Dark: `-3px 1px #8AD6A2 @85%`, `3px -1px #5060FF @90%`, plus `0 0 28px` mint glow @35%

**JetBrains Mono** SemiBold (600), 10–11px, uppercase, letter-spacing 0.06–0.14em for eyebrows, spec rows, field labels, day letters and status text.

---

## 4. Texture & gradient

- **Grain:** greyscale fractal-noise tile (~220px). Light: multiply @ 18%. Dark: overlay @ 11%. On top of everything, never intercepts touches.
- **Melt:** two tall rounded pills (≈120×300, radius 60) in mint and blue, rotated ±8–12°, starting just under the headline, flowing into a wide pool (mint left, blue right, violet bottom). Blur 26–30px. Dark mode: opacity .85 so it glows.
- Lower content sits on plain paper; don't repeat the melt further down.

---

## 5. Components

**Primary CTA** (Start workout): height 60, radius 30, mint fill, 2px ink border, onMint text 18/800, leading 30px ink circle with a mint play triangle.
- Light shadow: hard offset `0 6px 0 ink`.
- Dark: mint border, shadow `0 6px 0 #2F9E63` + `0 0 40px` mint @45%.

**Small mint button** (Start, Save): height 42 (in nav bars ~34), radius 21, mint fill, 1.5px border (light ink / dark mint), onMint text 14/800. Dark adds a soft mint glow.

**Ghost button** (Pick a day, Add): transparent, 1.5px border ink @35% (dark white @30%), radius 16–21. In dark mode "Add" uses a mint border and mint text.

**Icon buttons** (settings, menu, more): 40px circle, 1.5px ink border.

**Card:** radius 26, padding 18, 16px side margin, 12px between cards, frosted (see tokens).
- Homework card: pink border @35–40% plus a pink eyebrow with a graduation-cap icon.

**Section header:** mono label followed by a 1.5px ink rule filling the row, e.g. `YOUR TRAINING PLAN ————`.

**Specs row:** two columns of 10px mono uppercase under the headline (left: week/dates, right: days left/status), key values in italic.

**List rows:** 34px iconCircle with a mint icon, label 16/700, hairline dividers, mono index (01, 02).

**Settings rows:** icon circle, bold title + muted one-line description, trailing control (select with chevron, or Add ghost button).

**Text input:** height 48, radius 16, fill ink @6% (dark black @35%), 1.5px border ink @18% (dark white @12%), focus border mintDeep.
- Headline inputs: borderless huge type with a 2px ink underline; the placeholder uses the chromatic shadow.

**Stepper:** pill 52 high, 1.5px ink border; "−" left, value centred (28px condensed 900), "+" right on mint fill.

**Switch:** 54×32, 1.5px ink border, white knob with ink border; on = mint (dark adds glow).

**Collapsible block card:** drag handle (2×3 dots @45%), 10px category dot, mono category eyebrow, condensed uppercase title, 34px chevron circle (open = mint filled, closed = outline). Body separated by a hairline.

**Sticky add bar** ("+ Add block"): dashed 2px border (light `#2A7A4E`, dark mint), radius 22, height 58, mint tint fill, mint "+" chip. Sits on a fade from transparent to paper.

**Timeline / calendar grid:** 30px circles.

| State | Look |
|---|---|
| To come | 1.5px ring, ink @30% |
| Trained | mint fill + ink border (dark: mint border + glow) |
| Today | 2.5px mintDeep ring |
| Homework | 2px pink ring |

- Progress line: 6px track, mintDeep fill (dark: mint + glow).
- "Week 1 of 6" pill: ink background + mint text (dark: `#1D3527` + mint).

**Tab bar:** 88 tall, frosted, hairline top. Tabs: Home, Plan, Classes, Design. Active tab has an ink label and its icon sits on a mint rounded square (icon `#121014` in both modes).

**Scroll rail (scroll hint on long screens):** fixed to the right edge, inside the 16px gutter, from just below the headline to just above the tab bar.
- Parts, top to bottom: the vertical mono label "SCROLL" (9px, tracked .32em), a 1.5px track (ink @28%, dark white @25%), and a small down chevron.
- Hint state (before the user's first scroll): a mint "drip" thumb (6×24, radius 3, 1.5px ink border; in dark a mint border + glow) falls down the track and fades, looping every 2.4s. The chevron bobs in time with it.
- After the first scroll: the label and chevron fade out, the drip stops, and the thumb becomes a live position indicator. Never show the hint again once the user has scrolled (store a flag).
- Section ticks: 8px ink marks on the track at each main section (Homework, Sequence, Training plan). Tapping one scrolls smoothly there; each needs an accessibility label ("Jump to homework").
- Reduced motion: no drip or bob, just a static thumb.
- Only on screens taller than the viewport, one rail per screen.

**Nav bar (editor screens):** "Cancel" text button · centred title with a mono status line in mintDeep (e.g. "CREATING · UNSAVED") · "Save" small mint button. 1.5px ink rule beneath (dark white @18%).

---

## 6. Layout

- Base frame 390×844 pt, side gutters 16–22, status bar 54. Screens scroll vertically.
- Content above a fixed tab bar / add bar gets 110–130px bottom padding.
- Screen order: status → top bar (greeting or nav + icon buttons) → mono eyebrow + poster headline → specs row → floating cards → section headers + more cards.
- Leave 40–64px between the headline and the first card so the melt shows through.

### Reference: Home screen content order
Greeting "Hi, {name}" + "+ Sequence" + settings → eyebrow "This week's focus" + headline (e.g. TECHNIQUE) → specs (week X of Y, dates, days left) → Homework card → Today's sequence card (blocks list) → Start workout CTA → "Your training plan" section → Timeline card (dates, progress, week pill, 6-week grid, legend) → tab bar.

### Reference: New workout screen
Nav bar → headline name input → settings card (Based on dropdown, Homework, Coached) → "Blocks · N" section → block cards (first open, rest collapsed) → sticky "+ Add block".

---

## 7. Dark mode

Same layout, tokens swapped per the table. Mint never changes, and text on mint is always `#121014`. Hard offset shadows become mint glows, pink lightens to `#FF7AA8`, and icon circles become `#1D3527`.

---

## 8. Accessibility

- Body text ≥ 4.5:1 contrast; the label colours above pass. Never put light text on mint.
- States differ by fill AND outline weight, not hue alone (trained = filled, today = thick ring, homework = pink ring + legend label).
- Real buttons/inputs with labels; icon-only buttons get accessibility labels; visible focus ring in mintDeep.

---

## 9. React Native / Expo implementation

```ts
export const theme = {
  light: {
    paper: '#ECE7DE', ink: '#121014', mint: '#8AD6A2', mintDeep: '#2F9E63', mintText: '#2A7A4E',
    onMint: '#121014', pink: '#C93D72', blockBlue: '#4B6BFF', textMuted: '#3D3644', label: '#4A3F55',
    hairline: 'rgba(18,16,20,0.12)', card: 'rgba(247,244,238,0.84)', cardBorder: 'rgba(255,255,255,0.75)',
    iconCircle: '#121014', tabBar: 'rgba(236,231,222,0.94)', grainOpacity: 0.18,
  },
  dark: {
    paper: '#0E0C12', ink: '#F1ECE4', mint: '#8AD6A2', mintDeep: '#8AD6A2', mintText: '#8AD6A2',
    onMint: '#121014', pink: '#FF7AA8', blockBlue: '#4B6BFF', textMuted: '#CFC7DA', label: '#B9B0C6',
    hairline: 'rgba(255,255,255,0.10)', card: 'rgba(20,17,26,0.72)', cardBorder: 'rgba(255,255,255,0.09)',
    iconCircle: '#1D3527', tabBar: 'rgba(14,12,18,0.92)', grainOpacity: 0.11,
  },
  melt: { mint: '#5FD08A', blue: '#2B3CFF', violet: '#7A2BD8' },
  radius: { card: 26, cta: 30, button: 21, input: 16, addBar: 22 },
  font: {
    poster: 'Archivo-ExtraCondensedBlack', title: 'Archivo-CondensedBlack',
    body: 'Archivo-SemiBold', bold: 'Archivo-ExtraBold', mono: 'JetBrainsMono-SemiBold',
  },
};
```

- **Fonts:** load with expo-font. If the variable font is awkward, use static cuts (Archivo ExtraCondensed Black for posters, Condensed Black for titles, JetBrains Mono SemiBold).
- **Melt:** simplest is a pre-rendered blurred PNG per mode placed absolutely behind the headline. Alternative: expo-linear-gradient shapes under an expo-blur `BlurView`.
- **Cards:** expo-blur `BlurView` (intensity ~40, tint light/dark) with the card colour on top.
- **Grain:** small tiled noise PNG in an absolute overlay with `pointerEvents="none"` and the grainOpacity above.
- **Chromatic headline:** render the text three times stacked: mint copy offset (−3, 1), blue copy offset (3, −1), ink copy on top.
- **Glows:** iOS `shadowColor` mint with radius; on Android use a blurred image behind the element (Android shadows can't be coloured reliably).

---

## 10. Don'ts

- No second action colour (no blue, pink or grey filled buttons).
- No more than one poster headline or one melt per screen.
- No flat grey dark-mode cards without blur; no pure `#000` background.
- Don't limit the grain to the background; it covers everything.
- No red/orange in gradients; the palette is mint, blue and violet.
