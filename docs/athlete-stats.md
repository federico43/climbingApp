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
- Al tocar una ficha, debajo aparece su gráfico.

Pantalla grande: 3 fichas por fila. Teléfono: 2 por fila.

| Archivo | Rol |
| --- | --- |
| `components/coach/StatsCard.tsx` | UI: pestañas, fichas y gráfico |
| `components/coach/AthleteDetail.tsx` | Pone la tarjeta debajo del Timeline |
| `utils/athleteStats.ts` | Puro. Tipos, `statChange` (regla de mejora), `SAMPLE_STATS` |
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
| **S&C**, una ficha por patrón del plan (`scPatterns`, hasta 4) | Rondas S&C (`readRound`, `setsAtFinalLoad` en `utils/scHistory.ts`) y su foco (`loggedFocus`) | Peso de la carga final de la última sesión de la semana, **comparando solo con el mismo foco** (fuerza máxima con fuerza máxima). Con ejercicios por niveles, el valor es el nivel en la cadena (`levelChain.ts`) |
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
scPatternSeries(sessions, plan, library, weeks, unit): StatMetric[]   // una por patrón
workoutsSeries(plan, planWorkouts, sessions, weeks, today): { points: StatPoint[]; planned: number }
buildBlockStats({ athlete, plan, planWorkouts, sessions, library, unit, today }): StatMetric[]
buildAllBlocksStats({ athlete, plans, workoutsByPlan, sessions, library, unit, today }): StatMetric[]
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
- **S&C:** ¿comparar solo con el mismo foco, como propongo, o usar un 1RM
  estimado para mezclar focos?
- **Fichas sin datos:** ¿se ocultan, como propongo, o se muestran con "No data
  yet"?
