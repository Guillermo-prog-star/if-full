# ADR-013: Ciclo IF-7 — marco conceptual, sin instrumento nuevo

**Status:** Proposed
**Date:** 2026-09-05
**Deciders:** William Lopez

## Context

Varios textos externos analizados en la misma sesión (técnica de Feynman; adaptación del método galileano; «Neurociencia del cuerpo» de Castellanos; conversatorio de José Luis Díaz sobre la conciencia; prácticas de Tolle) convergen en el mismo circuito, que puede condensarse como **IF-7**: `VER → PREGUNTAR → PROPONER → PREDECIR → ACTUAR → CONTRASTAR → APRENDER`.

Este ADR se limita a lo que hoy es decidible: **integrar IF-7 como lectura del ciclo que ya existe** (mismo criterio que ADR-011 con IF-CAM y ADR-012 con el Principio de Altura de Observación), y **registrar dos huecos verificados contra el código** sin construirlos todavía. Una versión anterior de este borrador proponía además migración `V113`, dos servicios nuevos (pre-registro de predicción y contraste), un escalón de "apropiación de habilidad" y cambios en `CopilotService`; todo eso se recorta — ninguna pieza está construida, y apilar tres capas nuevas sobre ADR-012 (recién mergeado) sin un disparador concreto es la trampa que la Regla V1.1.1 y ADR-004 existen para evitar.

### Verificado en este repo, no asumido

- El ciclo documentado en `CLAUDE.md` (`Diagnóstico → Plan → Misiones → Evidencias → Reevaluación → Aprendizaje → Legado`) ya cubre ~5 de los 7 pasos de IF-7. `NOTICE/THINK/ACT/AFTERMATH/EFFECT` (`SCENARIO_V1_2`, V89–V95, congelado por la Directriz Operativa V1.2) es la versión operacional del mismo ciclo; IF-CAM (ADR-011) lo detalla en 11 etapas.
- **Paso PREDECIR — hueco verificado:** `FamilyPrediction` ([`FamilyPrediction.java`](../../backend/src/main/java/com/integrityfamily/twin/domain/FamilyPrediction.java), tabla `family_predictions`, V43) tiene `status ∈ {ACTIVE, CONFIRMED, DISMISSED, EXPIRED}`, pero `DigitalTwinService` solo crea filas `ACTIVE` — **nunca se contrastan**. Además no hay vínculo `plan_task_id` ni código de hipótesis: la predicción es un pronóstico global del gemelo digital, no algo atado a una misión. `PlanTask.impactoIcf` es un entero de impacto esperado, sin línea base ni contraste posterior.
- **Módulo `lts` — código muerto:** `lts_sessions → lts_attempts → lts_errors → lts_hypotheses → lts_corrections → lts_comparisons → lts_insights` (schema `V7`) modela un loop intento→error→hipótesis→corrección→insight por familia/miembro, pero [`LearningSessionService`](../../backend/src/main/java/com/integrityfamily/lts/service/LearningSessionService.java) no tiene controller y ningún código lo invoca.
- **`FamilyCausalEngine`** ([`FamilyCausalEngine.java`](../../backend/src/main/java/com/integrityfamily/risk/service/FamilyCausalEngine.java)) se llama "Motor Inferencial Causal" pero implementa reglas heurísticas de correlación (R1–R7) con explicabilidad — no infiere causalidad `misión → resultado`. El nombre invita al error que el método galileano advierte (`ICaF ↓ + misión + ICaF ↑ ≠ causalidad`).
- La disciplina epistémica que estos textos piden (separar `dato ≠ interpretación ≠ hipótesis ≠ resultado ≠ causa`; "patrones contextuales, revisables", no "leyes familiares") ya es doctrina vigente: Regla V1.1.1 + ADR-004 ("observaciones primarias, no conclusiones").

## Decision

### Decisión 1 — IF-7 se documenta en `vision.md` como marco, sin instrumento nuevo

Se agrega IF-7 a `docs/vision.md` junto a "El eje de regulación", IF-CAM y el Principio de Altura de Observación, con el mapa de cada paso al mecanismo que ya lo cubre. No introduce fases, columnas, tablas ni servicios.

### Decisión 2 — dos huecos verificados quedan registrados, no construidos

1. **`family_predictions` nunca se contrasta.** El loop PREDECIR → CONTRASTAR está abierto: se generan predicciones y no se confrontan contra lo observado. Se registra como deuda conocida. **No se construye** el pre-registro atado a misión ni el servicio de contraste hasta que exista un caso concreto que lo reclame (p. ej. que el piloto V1.2 pida medir precisión anticipatoria más allá de `PROXY_PREDICTIVE_ACCURACY_HYPOTHESIS`, ADR-008).
2. **El módulo `lts` es código muerto.** Se registra como candidato a eliminación (schema `V7` + dominio + servicio + repos). **No se cablea** como motor de IF-7 — duplicaría `hypothesis_evidence` y `family_predictions`. La baja efectiva queda para una tarea de limpieza dedicada, no para este ADR.

### Decisión 3 — explícitamente NO se construye

- Ninguna migración, entidad ni servicio nuevo en este ADR.
- Ningún motor de confusores, control estadístico, grupos de control ni aparato tipo RCT por misión. La salida del ciclo es siempre "patrón contextual, probabilístico y revisable".
- Ninguna afirmación neurocientífica promocional derivada de los textos ("una misión aumenta serotonina", "reprograma el cerebro").
- `FamilyCausalEngine` no se renombra (evitar churn); solo se acota en su Javadoc y en `vision.md` que es correlacional con explicabilidad.
- El escalón de "apropiación de habilidad" (Feynman: explicar → transferir → sostener) y el copiloto socrático se posponen: son refinamientos de instrumento, territorio de una eventual V1.3 post-piloto (ADR-011 ya reserva ese espacio), no de ahora.

## Trade-off Analysis

Frente a **aceptar el borrador completo** (V113 + pre-registro + contraste + apropiación + copiloto socrático): cierra huecos reales, pero cero de sus piezas está construida y ninguna tiene un disparador concreto. Apilarlas sobre ADR-012 recién mergeado, con el banco `SCENARIO_V1_2` congelado, multiplica el trabajo especulativo — exactamente lo que ADR-004 evitó al descartar el bounded context `research` sin un segundo consumidor real.

Frente a **no escribir nada**: se pierde el registro verificado de dos huecos (`family_predictions` sin contraste, `lts` muerto) que de otro modo se redescubrirían, y la integración de IF-7 como marco — barata y consistente con ADR-011/012.

## Consequences

- **Más fácil:** hay una lectura única del ciclo (IF-7) y un registro explícito de dos deudas técnicas verificadas.
- **Más difícil:** nada — este ADR no añade superficie.
- **Habrá que revisitar:** si el piloto V1.2 genera necesidad real de medir predicción vs. resultado por misión, se abre un ADR-013b (o se reactiva el borrador recortado) con la migración y los servicios. Si la limpieza de código muerto se prioriza, `lts` se elimina en su propia tarea.

## Action Items

1. [ ] `docs/vision.md` — sección "Ciclo IF-7" como marco conceptual (Decisión 1), con el mapa paso→mecanismo y la nota de que `FamilyCausalEngine` es correlacional, no causal.
2. [ ] Registrar en el backlog técnico: (a) `family_predictions` nunca transiciona de `ACTIVE` — loop PREDECIR/CONTRASTAR abierto; (b) módulo `lts` es código muerto, candidato a baja.
3. [ ] (Condicional) Reabrir con migración + servicios solo si el piloto V1.2 reclama medición de precisión anticipatoria por misión.
