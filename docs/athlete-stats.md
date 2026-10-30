# Stats de progreso y review por bloque

Estado 2026-10-26: **hecho, con datos reales**. Todavía no se probó en el
simulador. Rama `claude/project-thread-27smbw`, PR #27.

## 1. Qué ve cada uno

**Coach**: una tarjeta **Stats** en el detalle del atleta (pantalla Design),
debajo del Timeline. Tiene tres pestañas:

- **This block**: el plan activo, semana por semana (W1…W6). Solo aparece si
  hay un plan activo que ya empezó.
- **All blocks**: un punto por plan (B1, B2…), del más viejo al más nuevo.
- **Reviews**: un bloque a la vez, del inicio al final (o hasta hoy si sigue
  corriendo). Hay chips para elegir el bloque.

En This block y All blocks se ve:

- **Fichas**: Edge lift max, 4×4, Intervals y Workouts. Cada una muestra el
  valor de ahora, "was X" y una píldora verde, roja o gris. Al tocar una,
  debajo aparece su gráfico. Las fichas sin datos no aparecen, salvo
  Workouts.
- **S&C por patrón de movimiento**, sin movilidad. Hay un panel por patrón, plegado en una línea ("3 exercises · 2 better · 1 worse") que se abre al tocarlo (abierto si hay uno solo),
  con chips por ejercicio (el más registrado primero) y una fila por foco,
  con su color y su línea. Los focos nunca se mezclan.
- **Blocks**: en *Project bouldering*, una barra por sesión: la altura es la
  duración, el color es el grado y lleva ✓ si se logró. En *1 on 1 off*, los
  minutos de trabajo por sesión.

Si no hay nada registrado, aparece "Nothing logged yet" con un botón **Preview
with sample data**, que muestra los datos de ejemplo (marcados como "Sample
data").

**Atleta**: en la pantalla Plan, debajo del Timeline, una tarjeta plegada
**How this block is going** (o **Block review** cuando el plan ya terminó).
Muestra una línea ("4 better · 1 worse") y, al tocarla, la misma review que
ve el coach.

## 2. Archivos

| Archivo | Rol |
| --- | --- |
| `utils/athleteStats.ts` | Puro. Tipos, `statChange` (regla de mejora), `blockReview`, `visiblePatterns`, `focusMetrics`, `SAMPLE_STATS` |
| `utils/athleteStatsData.ts` | Puro. Lee sesiones, planes y el log de edge lift y arma `PeriodStats` (`buildBlockStats`, `buildAllBlocksStats`) |
| `hooks/useAthleteStats.ts` | Coach: carga la biblioteca de ejercicios y, la primera vez que se abre All blocks o Reviews, todos los planes con sus workouts |
| `components/coach/StatsCard.tsx` | Coach: pestañas, fichas, gráficos y review |
| `components/BlockReviewView.tsx` | La review (coach y atleta) |
| `components/BlockProgressCard.tsx` | Atleta: tarjeta plegada en Plan |
| `scripts/progression-tests/athleteStats.test.ts`, `athleteStatsData.test.ts` | Tests |

## 3. Regla de "mejoró / bajó"

Se compara el **primer punto** del período con el **último**. En todas las
métricas, más es mejor.

| Unidad | Valor | Píldora |
| --- | --- | --- |
| kg (edge lift, S&C) | `42 kg` | % de cambio: `▲ 11%` |
| segundos (intervals) | `60 s` | `▲ 15 s` |
| color (4×4) | el color que alcanzaron todos los slots | `▲ 0.5 colours` (promedio de slots) |
| nivel (S&C por niveles) | `Level 3` | `▲ 1 level` |
| reps (S&C con peso corporal) | `8 reps` | `▲ 2 reps` |
| minutos (1 on 1 off) | `10 min` | `▲ 2 min` |
| workouts | `7 / 8` | `1 missed` o `All done` |

## 4. De dónde sale cada número

Las fechas son el día real de la sesión (`sessionLocalDate`). Las semanas son
las del plan: no avanzan durante una pausa, así que los días pausados quedan
en la semana anterior.

| Métrica | Dato | Un punto |
| --- | --- | --- |
| Edge lift max | `users.edgeLiftMaxLog` | El max vigente al final de cada semana |
| 4×4 | Colores del último set (`attemptGrades`) | Promedio de los slots; la mejor sesión de la semana |
| Intervals | Bloques intervals con `kind: power_endurance` | `workTime` de la última sesión de la semana |
| S&C | Rondas S&C, foco con `loggedFocus` (sin foco → "No focus"), patrón con `movementType` (bloque, o biblioteca por id o por nombre) | Por sesión: el peso de la carga final (kg); el paso en la cadena de niveles; o, sin peso (peso corporal), las reps o segundos máximos de un set, como "Ejercicio (bodyweight)". All blocks incluye todas las sesiones, con plan o sin plan |
| Project bouldering | Intentos del bloque | Minutos del primer al último intento (con uno solo, el tiempo límite del bloque); grado del último intento con color, o el del bloque; ✓ si algún intento fue logrado |
| 1 on 1 off | Intervals con `kind: warmup` o llamados "1 on 1 off" | `series × workTime` en minutos |
| Workouts | `donePlanWorkouts` | Hechos por semana; planeados = 2 por semana terminada; la semana en curso solo cuenta lo ya hecho (todavía no hay "missed") |

En la **review**, solo entra lo que tiene al menos dos puntos en el bloque,
ordenado mejor → igual → peor. Además muestra los workouts hechos y cuántas
sesiones de proyecto se lograron.

## 5. Decisiones que tomé (cambiar si no convencen)

- Intervals se mide por tiempo por ronda, no por tiempo total.
- La duración del proyecto va del primer al último intento.
- Las fichas sin datos se ocultan.
- Los ejercicios S&C sin patrón de movimiento no aparecen.
- La review del atleta muestra lo mismo que la del coach (sin notas del
  coach, porque eso necesita una columna nueva en Appwrite).
- Nada de esto escribe en Appwrite ni toca funciones: solo lee.

## 6. Pendiente

- Probarlo en el simulador con atletas reales.
- Nota del coach en la review: necesita una columna (por ejemplo,
  `training_plans.reviewNote`).
- Si Federico quiere el layout de 3 columnas que describió (Training plan y
  perfil a la derecha), es un cambio aparte en `AthleteDetail`.
