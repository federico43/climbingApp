# Project bouldering v2 — por grado, con tiempo, intentos y razones de caída

Estado: **implementado (fase 2)**. Correcciones tras la revisión: sin chip de fuerza (5 chips) y **sin cambios de esquema en Appwrite**.
Alcance: el bloque `project_bouldering` — editor del coach
(`components/workoutBlocks.tsx`), runtime del atleta (`ProjectBlock` en
`utils/blockRenderer.tsx`), resumen de fin de entreno
(`components/workOutState.tsx`), historial / vista del coach
(`components/SessionDetailModal.tsx`, `components/AthleteRecentSessionsSummary.tsx`),
estimaciones (`utils/workoutSummary.ts`, `components/LatestWorkoutCard.tsx`) y
vídeos (`utils/saveVideo.tsx`, `services/videoStorage.ts`,
`components/AthleteVideos.tsx`).

La UI de la app está en inglés; los textos visibles se escriben en inglés
(entre paréntesis la intención en español). Los valores guardados son claves
estables, nunca etiquetas, para poder retocar textos sin migrar datos.

## 1. Qué cambia respecto a v1

| v1 (hoy) | v2 |
| --- | --- |
| El atleta elige un **proyecto** concreto (`ProjectPickerModal`, `projects`), recap de la última sesión de ese proyecto | No hay proyecto. El bloque trabaja **un grado** (color de `utils/boulderColours.ts`) |
| `targetAttempts` limita el bloque; un envío lo termina | Sin tope de intentos. El bloque lo limita el **tiempo** (`timeLimit`, siempre activo) |
| "Record attempt" / "Log without video" → pantalla "How did it go?" (Sent/Fell + notas) → descanso | **Un botón grande "Attempt"** registra el intento y arranca el descanso **en el acto**; durante el descanso el atleta marca, si quiere, razones de caída o "Sent!" |
| Vídeo opcional en cada intento | Vídeo opcional + **prompt aleatorio** "graba el siguiente intento para tu coach" |
| Resumen: lista ✅/❌ | Resumen: grado, nº intentos, encadenado sí/no, conteo de razones |

`ProjectPickerModal`, la tabla `projects` y `past-projects.tsx` **no se tocan**:
siguen sirviendo para los proyectos personales y el historial de secuencias.
Solo dejan de usarse desde este bloque.

## 2. Bloque (lo que define el coach)

```ts
interface ProjectBoulderingBlock extends BaseBlock {
  type: "project_bouldering"
  description: string
  restTime: number          // s entre intentos. Defecto 180 (antes 120)
  timeLimit?: number        // min. v2: siempre > 0. Defecto 20, mín 5, máx 90
  grade?: string            // NUEVO. Color de BoulderLevelOptions; "" / ausente → lo elige el atleta al empezar
  reviewPrompts?: boolean   // NUEVO. Prompt aleatorio de grabación. Ausente = true
  targetAttempts?: number   // LEGACY. Se conserva si existe, v2 lo ignora
}
```

- `makeDefaultBlock("project_bouldering")` → `{ description: "", grade: "", timeLimit: 20, restTime: 180, reviewPrompts: true }`.
- Editor (tarjeta compacta y editor completo):
  - fila de swatches de color (mismos que 4×4 / constraint warmup) para `grade`, con opción "Athlete picks" (vacío);
  - stepper **Time** (min) en lugar de "Attempts" — no hay interruptor Off, el tiempo es obligatorio;
  - stepper **Rest** (igual que hoy);
  - interruptor **"Ask for review clips"** (`reviewPrompts`);
  - `TimeLimitChip` / `TimeLimitToggle` no se muestran para este tipo (ya lo cubre el stepper Time).
- Helper puro `normalizeProjectBlock(b)` (en `utils/progression/projectBouldering.ts`):
  rellena `timeLimit` (≤0 o ausente → 20), `restTime` (ausente → 180), `grade`
  (ausente → ""), `reviewPrompts` (ausente → true). Se aplica al leer en runtime,
  editor y resúmenes; **no reescribe** filas guardadas.

## 3. Flujo de pantallas (atleta)

```
intro ──► [gradeSelect] ──► ready ⇄ rest ──► … ──► review ──► siguiente bloque
            (solo si el                │
             bloque no trae            └─ timeUp (al llegar a 0)
             grado)
```

1. **intro** — título, píldora de grado (o "You pick the grade"), "⏱ 20 min · 3:00 rest",
   descripción del coach. Botón **Start**: arranca el timer del bloque.
2. **gradeSelect** — solo si `grade` vacío: swatches de colores; preselecciona
   flash level + 1 del atleta si existe (`getUsers().flashLevel`, vía `shiftColour`). Botón Start.
3. **ready** (pantalla principal):
   - cabecera: píldora de grado + countdown del bloque (grande, rojo en el último minuto);
   - número grande de intentos registrados (+ "1 send" si hay envíos);
   - **botón circular enorme "Attempt"** (≈ 220 px, háptico). Si hay un
     grabado pendiente (§6) el botón pasa a **"Record attempt"** con icono de cámara
     y un enlace pequeño "Don't record";
   - enlace secundario pequeño "🎥 Record this one" (grabación voluntaria);
   - "Finish block" (texto, abajo).
4. **rest** (se entra automáticamente al pulsar Attempt, o al terminar la grabación):
   - anillo de descanso (`startRestTimer(restTime)`), "Attempt N logged";
   - **toggle "Sent!"** destacado (verde) — marca el intento como encadenado y
     oculta los chips;
   - **5 chips de razón de caída** (multi-selección, opcionales);
   - si toca, tarjeta del **prompt de grabación** (§6) con "Sure" / "Not now";
   - "Undo attempt" (borra el intento: pulsación accidental), "Skip rest".
   - Cada cambio de chip/toggle actualiza el último intento en el acto
     (`updateLastAttempt`), así que no hay botón Save y nada se pierde si se sale.
   - Al llegar el descanso a 0 (o "Skip rest") → **ready**.
5. **timeUp** — cuando el countdown llega a 0 estando en ready: overlay
   "Time's up" con **Finish block** (primario) y "One more attempt" (vuelve a
   ready una vez; el countdown queda en rojo "+0:45"). Si llega a 0 durante el
   descanso, se muestra al terminar el descanso. Nunca avanza solo.
6. **review** — grado, nº intentos, Sent sí/no, chips de razones con su conteo,
   clips grabados ("1 clip sent to your coach"). Botón **Continue** → `goToNextBlock`.

Reanudación / volver al bloque: si ya hay intentos v2 del bloque → ready
(o review si el tiempo ya pasó). El inicio del timer se reconstruye como
`min(timestamp del 1er intento) − 60 s` (aproximación aceptable; el timer real
no se persiste). El grado se recupera del `level` de los intentos.

El bloque se añade a `SELF_TIMED_BLOCKS` de `workOutState.tsx`: el countdown lo
pinta el propio bloque (grande, en ready) y no el chip genérico de la cabecera.

Bloques `coached` siguen yendo a `CoachedBlock` como hoy (sin cambios).

## 4. Estados del bloque

| Estado | Entra desde | Sale a | Datos |
| --- | --- | --- | --- |
| `intro` | entrada al bloque sin intentos | `gradeSelect` / `ready` | — |
| `gradeSelect` | intro (sin grado) | `ready` | `grade` local |
| `ready` | start, fin del descanso, "One more attempt" | `rest`, `recording`, `timeUp`, `review` | — |
| `recording` | ready con grabación (prompt aceptado o voluntaria) | `rest` (clip guardado) / `ready` (cancelar) | `VideoRecorder` overlay |
| `rest` | Attempt, fin de grabación | `ready`, `timeUp` | último intento editable |
| `timeUp` | countdown 0 | `review`, `ready` | `overtime` flag |
| `review` | Finish block, timeUp | siguiente bloque | — |

Estado local del componente (no persistido): `phase`, `blockStartedAt`,
`recordNext` (prompt aceptado), `promptsShown`, `lastPromptAt`. Lo persistido son
los intentos.

## 5. Modelo de datos

### 5.1 Intentos (sin cambios de esquema en Appwrite)

Los intentos ya se guardan como JSON en `workoutsession.attempts` (string), así
que los campos nuevos viajan dentro del JSON y **no requieren cambiar la tabla**.

```ts
// Attempt (hooks/WorkoutHook.tsx) — campos nuevos opcionales
{
  success: boolean          // true = "Sent!" (encadenado)
  level: string             // grado del bloque (color)
  blockIndex, type: "project_bouldering", timestamp
  fallReasons?: FallReason[]  // NUEVO. Claves de §7; [] o ausente = sin razón
  videoId?: string            // NUEVO. $id de la fila en `videos` (vínculo intento ↔ clip)
  reviewClip?: boolean        // NUEVO. Grabado a raíz del prompt (revisión pedida)
  pbv?: 2                     // NUEVO. Marca de intento v2 (ver §8)
  // legacy v1 que v2 ya no escribe: projectId, notes
}
```

`useWorkout` gana `updateLastAttempt(patch)` (mezcla `patch` en el último intento
del bloque actual). La persistencia de entreno en curso
(`utils/workoutPersistence.ts`) ya guarda `attempts` entero, así que los cambios
se recuperan tras un cierre.

### 5.2 Bloque

Los campos nuevos (`grade`, `reviewPrompts`, `timeLimit` obligatorio) viven en el
JSON del bloque: `protocols.protocol` / `blocks.data` / `workoutsession.protocol`.
**Sin cambios de esquema.**

### 5.3 Vídeos — tabla `videos` (sin cambios de esquema)

El código usa la tabla con **ID** `videos` (`services/videoStorage.ts`,
`VIDEOS_TABLE`) en la base de datos `68bd9dd7003c15f7147e`; la consola lista las
tablas por *nombre*, así que puede aparecer con otro nombre — buscar por ID.
Atributos que el código escribe: `userId, url, key, blockType, projectId,
projectName, grade, durationSec, imported`.

v2 **no añade atributos**:
- Vínculo intento ↔ clip: el `rowId` se genera en el dispositivo
  (`ID.unique()`) antes de subir y se guarda en el intento como `videoId`; la
  subida en segundo plano crea la fila con ese mismo id. Así el vínculo existe
  aunque la subida termine después de guardar la sesión, y no hace falta
  atributo `sessionId`.
- Metadatos del clip: `blockType: "project_bouldering"`, `grade`, y
  `projectName` como título: `"Review request · <blockName> · attempt N"` para
  los clips del prompt, `"<blockName> · attempt N"` para los voluntarios.
  `AthleteVideos` ya pinta `projectName` como título, así que el coach ve
  "Review request" sin atributo nuevo. La marca fiable es `reviewClip` en el
  intento (sesión).
- Feedback del coach: **sin cambios** — `CoachFeedbackRecorder` (vía
  `VideoPlayerModal`) crea filas en `video_feedback` con `videoId`, y el atleta
  lo ve con `FeedbackViewer` como cualquier otro clip.

### 5.4 Resumen puro

`summarizeProjectAttempts(attempts)` en `utils/progression/projectBouldering.ts`:

```ts
{ grade: string, attempts: number, sends: number, sent: boolean,
  reasons: { key: FallReason, count: number }[]  // orden: más frecuente primero, empate = orden de §7
  clips: number, reviewClips: number, legacy: boolean }
```

Lo usan review, resumen de fin de entreno, `SessionDetailModal` y
`AthleteRecentSessionsSummary`.

## 6. Prompt aleatorio de grabación

Función pura `shouldPromptReviewClip(state, rand)` (testeada):

```ts
state = {
  enabled: boolean            // block.reviewPrompts !== false
  attemptNumber: number       // nº del intento recién registrado (1-based)
  sentInBlock: boolean        // ya hay un "Sent!" en este bloque (el intento recién registrado aún no: se marca en el rest)
  clipsThisWorkout: number    // clips de revisión ya grabados en TODO el entreno
  promptsThisBlock: number    // prompts mostrados en este bloque (aceptados o no)
  lastPromptAttempt: number | null
  secondsLeft: number | null  // tiempo restante del bloque
  restTime: number
  pendingRecord: boolean      // ya hay un "grabar el siguiente" aceptado
}
```

Regla — se muestra si **todas** se cumplen y `rand() < 0.3`:

- `enabled` y no `pendingRecord`;
- `attemptNumber >= 2` (el 1º es de lectura/calentamiento del grado);
- no `sentInBlock` (si ya encadenó, el siguiente intento es menos útil);
- `clipsThisWorkout < 2` — **máximo 2 clips de revisión por entreno**;
- `promptsThisBlock < 2` — como mucho 2 prompts por bloque (aunque los rechace);
- `lastPromptAttempt == null || attemptNumber - lastPromptAttempt >= 3` (enfriamiento);
- `secondsLeft == null || secondsLeft > restTime + 60` (queda tiempo para ese intento).

Probabilidad 0.3 por intento elegible ⇒ en un bloque de ~8 intentos sale ~1–2
veces de media; con los topes nunca más de 2 por bloque ni 2 clips por entreno.
Se evalúa al registrar el intento y la tarjeta aparece en la pantalla de rest.
Si el rest se acaba (o se salta) sin respuesta, la tarjeta sigue en ready —en
lugar del enlace "Film this one"— hasta que conteste o pulse Attempt: el prompt
ya cuenta para el tope.

`promptsThisBlock` y `lastPromptAttempt` **no** viven en estado del componente:
el intento que lanza el prompt se guarda con `reviewPrompted: true` y
`reviewPromptHistory(attempts)` los reconstruye. Así los topes y el
enfriamiento sobreviven a salir y volver al bloque o reanudar el entreno, y
"Undo attempt" devuelve el prompt de ese intento (y cancela un "Sure" dado a él).

Si acepta ("Sure"): `recordNext = true` → en ready el botón grande es "Record
attempt" → `VideoRecorder` → al terminar: `saveVideoLocally(..., { rowId })` con
título "Review request · …", se registra el intento con `videoId` y
`reviewClip: true`, y entra en rest. "Don't record" cancela el pendiente. Marcar "Sent!" también lo cancela (y
oculta la tarjeta): tras encadenar no se piden más clips en el bloque.
"Not now" solo consume el prompt.

## 7. Chips finales de razón de caída (5)

| Clave | UI (en) | Intención (es) |
| --- | --- | --- |
| `beta` | Wrong beta | Mala beta / secuencia |
| `execution` | Poor execution | Mala ejecución (precisión, timing, posición) |
| `slip` | Slipped | Se resbaló pie o mano |
| `fatigue` | Pumped / tired | Fatiga |
| `commitment` | Didn't commit | Miedo / falta de compromiso |

Ajustes respecto a la propuesta: se quita "Falta de fuerza/potencia" (decisión
del coach), y "Se resbaló el pie" pasa a **"Slipped"** (pie o mano — los
resbalones de mano por fricción/sudor son igual de comunes y no merecen chip
propio). Más el toggle aparte **"Sent!"**
(encadenado): excluyente con los chips.

## 8. Retrocompatibilidad

1. **Bloques guardados v1** (plantillas, protocolos, planes, IA): no se migran.
   `normalizeProjectBlock` les da `timeLimit` 20 (si no tenían), `grade` "" (el
   atleta elige al empezar), `reviewPrompts` true. `targetAttempts` se conserva en
   el JSON pero no se usa. El editor deja de mostrar "Attempts".
2. **Sesiones v1 guardadas** (intentos con `projectId`/`notes`, sin `pbv`):
   - `SessionDetailModal`: si ningún intento del bloque tiene `pbv`, se usa la
     vista actual (punto + Send/Fall + notas). Con `pbv` → nueva vista
     (§9). La edición de send/fall sigue funcionando en ambos.
   - `summarizeProjectAttempts` marca `legacy: true`; el grado sale de `level`
     (el grado del proyecto en v1) y las razones quedan vacías.
   - `getLastProjectSession` / `past-projects.tsx` siguen leyendo `projectId`
     de los intentos antiguos; los nuevos no lo llevan, así que no contaminan
     el historial de proyectos.
3. **Entreno v1 a medio hacer** reanudado tras actualizar: los intentos v1 se
   cuentan; se entra en ready con el grado del `level` del último intento.
4. **Analytics** (`utils/athleteAnalytics.ts`): solo usa duraciones, tipo y
   `success`; v2 escribe los mismos campos → sin cambios.
5. **Estimaciones** (`utils/workoutSummary.ts`, `LatestWorkoutCard`):
   `project_bouldering` pasa a estimarse por `timeLimit` normalizado (20 min) y
   el detalle muestra "Yellow · 20 min" en lugar de "10 attempts".
6. **IA** (`services/aiProtocol.ts`, `functions/aiProtocol/src/knowledgePack.js`):
   el esquema pasa a `grade` + `timeLimit` + `restTime`; `targetAttempts` se
   acepta y se ignora. La función de Appwrite se redespliega a mano.

## 9. Resumen y vista del coach

- **Review del bloque** y **resumen de fin de entreno** (`workOutState.tsx`):
  bajo la fila del bloque, una línea `● Yellow · 9 attempts · Sent ✓` y, si hay
  razones, chips pequeños `Wrong beta ×4 · Pumped ×2`.
- **`SessionDetailModal`** (historial del atleta y del coach vía
  `AthleteAnalytics`): `ProjectBlockView` con píldora de grado, intentos, Sent
  sí/no, barras/conteos por razón y, por intento, sus razones y un botón
  "▶ Clip" si tiene `videoId` (abre `VideoPlayerModal` → el coach puede grabar
  feedback con `CoachFeedbackRecorder`).
- **`AthleteRecentSessionsSummary`** (dashboard del coach): línea de detalle
  para el bloque con grado, intentos, sent y la razón más frecuente.
- **`AthleteVideos`**: el título "Review request · …" identifica los clips pedidos.

## 10. Tests (scripts/progression-tests/projectBouldering.test.ts)

- `normalizeProjectBlock`: v1 sin campos, v1 con `timeLimit` 0, v2 completo.
- `summarizeProjectAttempts`: conteo de intentos, sends, razones (multi por
  intento, orden), legacy, clips de revisión, intentos de otros bloques ignorados.
- `shouldPromptReviewClip`: cada condición de corte + umbral de `rand`.

## 11. Cambios a aplicar a mano en Appwrite

Ninguno de esquema: sesiones, protocolos, bloques y vídeos guardan lo nuevo
dentro de JSON / atributos que ya existen. Solo:

1. Redesplegar la función `aiProtocol` (knowledge pack actualizado).
