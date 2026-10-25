# Stats de progreso (dashboard del coach)

Estado 2026-10-25: **la UI está hecha con datos de ejemplo** (`SAMPLE_STATS`).
Este documento describe la siguiente parte: la lógica que reemplaza los datos
de ejemplo por los números reales del atleta. El review por bloque queda para
después.

## 1. Qué muestra

Una tarjeta **Stats** en el detalle del atleta (pantalla Design del coach),
debajo del Timeline:

- Dos pestañas: **This block** (semanas del plan activo) y **All blocks** (un
  punto por plan de 6 semanas).
- Una ficha por métrica: valor de ahora, "was X" (el valor al inicio del
  período) y una píldora verde (mejoró), roja (bajó) o gris (igual).
- Fichas arriba: Edge lift max, 4×4, Intervals y Workouts. Al tocar una, debajo aparece su gráfico.
- **S&C por patrón de movimiento**: un panel por patrón (sin movilidad). Si el patrón tiene varios ejercicios, hay una fila de chips para elegir el ejercicio, y se desliza de lado cuando son muchos. Debajo va una fila por cada foco en que se hizo el ejercicio (Max force, Hypertrophy, Explosiveness), con su color, el valor de ahora, "was X", la píldora y su propia línea. Los focos nunca se mezclan en una misma línea.
- **Blocks**: *Project bouldering*, con una barra por sesión: la altura es la duración, el color es el grado trabajado y lleva ✓ arriba si ese día se logró el proyecto. *1 on 1 off*, con una barra por sesión con los minutos de trabajo.

Pantalla grande: 4 fichas por fila y paneles de a dos. Teléfono: 2 fichas por fila y paneles uno debajo del otro. Los gráficos de barras se deslizan de lado cuando hay muchas sesiones.

| Archivo | Rol |
| --- | --- |
| `components/coach/StatsCard.tsx` | UI: pestañas, fichas y gráfico |
| `components/coach/AthleteDetail.tsx` | Pone la tarjeta debajo del Timeline |
| `utils/athleteStats.ts` | Puro. Tipos, `statChange` (regla de mejora), `visiblePatterns` (quita movilidad y vacíos), `focusMetrics`, `SAMPLE_STATS` |
| `scripts/progression-tests/athleteStats.test.ts` | Tests de `statChange` |

## 2. Regla de "mejoró / bajó" (ya hecha)

`statChange(metric)` compara el **primer punto** del período con el **último**.
En todas las métricas de hoy, más es mejor.

| Unidad | Valor | Píldora |
| --- | --- | --- |
| `kg` (edge lift, S&C con peso) | `42 kg` | % de cambio: `▲ 11%` |
| `added_kg` (peso agregado, dominadas) | `+12 kg` | kg de cambio: `▲ 3 kg` |
| `s` (intervals) | `60 s` | segundos: `▲ 15 s` |
| `colour` (4×4) | `Yellow` | colores: `▲ 1 colour` |
| `workouts` | `7 / 8` | `1 missed` (roja) o `All done` (verde) |

## 3. Períodos

**This block.** Semanas del plan activo, desde `windowStart` hasta hoy:
`W1`…`W6`. Cada semana es un punto. Si en una semana no hubo dato, se repite
el de la semana anterior (el edge lift max sigue siendo el mismo aunque no se
haya testeado). Una métrica que no tiene ningún dato en el bloque no aparece.

**All blocks.** Un punto por plan (`listTrainingPlans(athleteId)`, del más
viejo al más nuevo): `B1`, `B2`… El valor de cada bloque es el de su última
semana. El bloque activo cuenta hasta hoy.

## 4. De dónde sale cada métrica

| Métrica | Dato que ya se guarda | Valor de una semana |
| --- | --- | --- |
| **Edge lift max** | `users.edgeLiftMaxLog` (`parseMaxLog` en `utils/edgeWarmup.ts`): `{ kg, date }` en cada cambio | El último max registrado hasta el fin de esa semana |
| **4×4** | Intentos `four_by_four`: colores con que terminó cada slot (`runGrades` en `utils/progression/fourByFour.ts`) | Promedio de `colourIndex` de los slots en la mejor sesión de la semana. Se muestra el color redondeado hacia abajo |
| **Intervals** (solo los de power endurance) | `intervalsLog(attempt)`: `workTime`, `series` | Tiempo de trabajo por ronda (`workTime`) de la última sesión de la semana |
| **S&C**, un panel por patrón (`movementType` del ejercicio en la biblioteca; se omite `mobility`) | Rondas S&C (`readRound`, `setsAtFinalLoad` en `utils/scHistory.ts`) y su foco (`loggedFocus`) | Por ejercicio y por foco, un punto por sesión: el peso de la carga final. Con ejercicios por niveles, el nivel en la cadena (`levelChain.ts`). En All blocks, un punto por bloque (la mejor sesión) |
| **Project bouldering** | Intentos `project_bouldering`: `timestamp`, `level`, `success` | Una barra por sesión: minutos del primer al último intento (si hay uno solo, el `timeLimit` del bloque), el grado (`level` o el `grade` del bloque) y logrado = algún intento con `success` |
| **1 on 1 off** | Bloque intervals de warm-up ("1 on 1 off"): `intervalsLog` | Una barra por sesión: minutos de trabajo = `series` × `workTime` / 60 |
| **Workouts** | `donePlanWorkouts(planId, planWorkouts, sessions)` en `utils/planProgress.ts` | Workouts hechos esa semana. Planeados = 2 × semanas transcurridas |

`AthleteDetail` ya carga `sessions`, `plan` y `planWorkouts`, así que
**This block** no necesita consultas nuevas. **All blocks** necesita
`listTrainingPlans` y `listPlanWorkouts` por plan. Esas consultas se cargan
solo cuando se toca la pestaña.

## 5. Funciones a crear (`utils/athleteStats.ts`, puras)

```ts
blockWeeks(plan, today): { label: string; start: string; end: string }[]
edgeLiftSeries(maxLog: MaxEntry[], weeks): StatPoint[]
fourByFourSeries(sessions: SessionRow[], weeks): StatPoint[]
intervalsSeries(sessions: SessionRow[], weeks): StatPoint[]
scPatternStats(sessions, library, range, unit): ScPatternStats[]   // por patrón → ejercicio → foco
projectSessions(sessions, range): ProjectSessionStat[]
warmupSessions(sessions, range): WarmupSessionStat[]
workoutsSeries(plan, planWorkouts, sessions, weeks, today): { points: StatPoint[]; planned: number }
buildBlockStats({ athlete, plan, planWorkouts, sessions, library, unit, today }): PeriodStats
buildAllBlocksStats({ athlete, plans, workoutsByPlan, sessions, library, unit, today }): PeriodStats
```

Para fechas se usa `sessionLocalDate` (el día real de la sesión, no
`$createdAt`). Las semanas se cuentan desde `windowStart`, igual que
`planWeek`.

En la UI, `StatsCard` recibe `metrics` por props en vez de leer
`SAMPLE_STATS`. `AthleteDetail` los calcula con `useMemo` a partir de lo que
ya tiene cargado.

## 6. Fases

1. **UI con datos de ejemplo**: este PR.
2. **This block real**: las funciones de §5 menos `buildAllBlocksStats`, con
   tests para cada serie.
3. **All blocks real**: carga de planes archivados.
4. Después: review al terminar cada bloque y versión para el atleta.

## 7. Preguntas abiertas

- **Intervals:** ¿la mejora se mide por tiempo por ronda, o por tiempo total
  (rondas × tiempo)? En power endurance, al llegar a 90 s se suma una ronda.
- **Project bouldering:** ¿la duración se mide del primer al último intento, como propongo, o se usa el tiempo límite del bloque?
- **Fichas sin datos:** ¿se ocultan, como propongo, o se muestran con "No data
  yet"?
