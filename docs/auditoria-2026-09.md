# Auditoría integrada — Integrity Family

**Fecha:** 2026-09-06
**Rama auditada:** `feature/v1.2-micro-simulations` (commit `e6f72f5`)
**Alcance:** backend (`backend/`), CI/CD (`.github/workflows/`), configuración y arquitectura.
**Método:** lectura estática de código. No hay pruebas en runtime ni escaneo dinámico.

Baseline: 881 archivos Java · 79 `@RestController` · 200 clases de test · 108 migraciones Flyway (V1–V112, con huecos en V61 y V88).

---

## Resumen de hallazgos

| # | Severidad | Área | Hallazgo | Estado |
|---|---|---|---|---|
| 1 | 🔴 Crítico | Seguridad | Control de acceso roto entre familias (IDOR) en 9 controllers + sub-recursos | **Cerrado** (`699d6f6` + 2º cambio) |
| 2 | 🔴 Crítico | Seguridad | `JWT_SECRET` con default público hardcodeado en `application.yml` | **En curso** (este cambio) |
| 3 | 🟠 Alto | Build/CI | El quality gate de JaCoCo documentado no existe en `pom.xml` | **Cerrado** (3er cambio; gate a 65%, real 68.9%) |
| 4 | 🟠 Alto | Build/CI | El workflow de deploy no ejecuta tests | **Cerrado** (4º cambio) |
| 5 | 🟠 Alto | Config | Fuga de mensajes de excepción y Swagger en perfiles `railway`/`render` | Abierto |
| 6 | 🟠 Alto | Config | `ddl-auto: update` en producción conviviendo con Flyway | Abierto |
| 7 | 🟡 Medio | Deuda | `JwtService` y `security.SecurityConfig` muertos; `allow-bean-definition-overriding` | **Cerrado** (5º cambio; flag pendiente aparte) |
| 8 | 🟡 Medio | Arquitectura | Dos implementaciones paralelas de autorización por familia | Abierto |
| 9 | 🟡 Medio | Deuda | `@Transactional` en 4 controllers | Re-evaluado — riesgo de `LazyInitException` en prod, no es cleanup (ver detalle) |
| 10 | 🟡 Medio | Docs | `CLAUDE.md` desincronizado (versión, nº migraciones, nº tests) | **Cerrado** (6º cambio) |
| 11 | 🟠 Alto | Config | Backend de producción inconsistente y sin responder (Railway parkeado, Render 503) | Abierto |
| 12 | 🟡 Medio | Build/CI | JDK 17 (CI) vs JDK 21 (deploy) sin `--release` | **Cerrado** (4º cambio; workflows en 17) |

Lo que está sano se documenta al final.

---

## 🔴 1. Control de acceso roto entre familias (IDOR)

### Descripción

`SecurityConfig.securityFilterChain` cierra con `.anyRequest().authenticated()`: exige un JWT
válido pero **no** que el token pertenezca a la familia del path. El control por familia real es
`@PreAuthorize("@familySecurity.check(#familyId)")` (bean `FamilySecurityEvaluator`), y **27
controllers lo aplican correctamente**. Los siguientes **no tienen ningún control de propiedad**
— ni en el controller ni en el servicio:

| Controller | Path base | Riesgo concreto |
|---|---|---|
| `GuardianController` | `/api/families/{familyId}/guardian/**` | leer/mutar el guardián y sus misiones de otra familia |
| `ErrorProtocolController` | `/api/families/{familyId}/error-protocols/**` | leer/crear/cerrar protocolos de crisis de otra familia |
| `evaluation/ReportController` | `/api/families/{id}/report/territorial` | leer el reporte de evolución territorial (ICF/riesgo) de cualquier familia |
| `LegacyController` | `/api/families/{familyId}/legacy` | `PUT` **escribe** el legado de otra familia |
| `TransformationStateController` | `/api/families/{familyId}/transformation` | `PATCH` **muta** onboarding/mes/sprint/misión de otra familia |
| `WeeklyPlanController` | `/api/families/{familyId}/weekly-plans` | `PUT` **escribe** planes semanales de otra familia |
| `FamilyDnaController` | `/api/families/{familyId}/dna` | leer y regenerar el ADN cultural de otra familia |
| `ParticipationController` | `/api/families/{familyId}/participation` | leer el pulso de participación de otra familia |
| `AdaptiveController` | `/api/families/{familyId}/adaptive/**` | listar y proponer ajustes adaptativos de otra familia |

### Por qué el `TenantInterceptor` no mitiga esto

`TenantInterceptor` activa el filtro Hibernate `familyFilter` — pero:

1. Solo se aplica a **21 entidades** anotadas con `@FilterDef`/`@Filter`. **Ninguno** de los
   módulos de arriba (`legado`, `dna`, `transformation`, `weeklyplan`, `guardian`,
   `participation`, `errorprotocol`, `adaptive`) tiene sus entidades en esa lista.
2. El `familyId` del filtro sale del claim `fid` del token, **no** del path.
3. Es un filtro de `SELECT` (cláusula `WHERE`). No frena `PUT` / `getOrCreate(familyId)` /
   `save(familyId, …)`.
4. Con `fid == null` (rol ADMIN o usuarios anteriores al claim) el filtro queda desactivado.

### Falsos positivos descartados

El módulo Hogar Digital (`familyhome`, `hud`: `FamilyActionController`, `FamilyHomeController`,
`AdaptiveHudController`) **sí** autoriza, en la capa de aplicación vía
`FamilyMembershipQueryPort.isMember(familyId, authenticatedUserId)` /
`HudAuthorizationPolicy.authorize(...)`. Usan identidad `UUID` y diseño hexagonal propio (ADR-002).
No requieren cambios.

### Corrección aplicada

Se añade `@PreAuthorize("@familySecurity.check(#familyId)")` (o `#id` según el nombre del path
var) a cada método de los 9 controllers, siguiendo el patrón por método ya usado en
`ConsentController`, `IcafController`, `CognitiveController`, etc.

### Riesgo residual de sub-recursos — **cerrado** (2º cambio)

`@familySecurity.check(#familyId)` cierra el acceso a la familia, pero un miembro legítimo de la
familia A podía pasar el `{id}` de un sub-recurso de la familia B. Estado:

- **`ErrorProtocolController.update/close`** — ✅ cerrado. Nuevo `FamilySecurityEvaluator.checkErrorProtocol(Long)`
  (resuelve `protocol.familyId` y valida pertenencia); anotación pasa a
  `@PreAuthorize("@familySecurity.check(#familyId) and @familySecurity.checkErrorProtocol(#id)")`.
- **`AdaptiveController` `/adaptive-adjustments/{adjustmentId}/{approve,apply,reject}`** — ✅ cerrado.
  Nuevo `FamilySecurityEvaluator.checkAdjustment(UUID)`; los 3 endpoints anotados con
  `@PreAuthorize("@familySecurity.checkAdjustment(#adjustmentId)")` (antes: solo `authenticated()`).
- **`GuardianController`** — no requería cambios: `GuardianService` ya valida cada sub-recurso
  contra `familyId` (`completeMission` línea 170 `mission.getFamily().getId().equals(familyId)`;
  `getMember(memberId, familyId)` línea 220; `generateReengagementMessage` filtra el miembro por
  la familia). El `@familySecurity.check(#familyId)` del 1er cambio es suficiente.

Cobertura: `FamilySecurityEvaluatorTest` +12 casos (`CheckErrorProtocol`, `CheckAdjustment`:
null / sin auth / admin / misma familia / otra familia / no existe).

### Riesgo residual pendiente

- **`AdaptiveController` `/api/v1/adaptive/{evaluate,approve,apply}`** ("compatibilidad para QA de
  contrato en memoria") no deberían estar expuestos en producción. Operan sobre el `@RequestBody`
  sin persistencia ni contexto de familia; quedan con `authenticated()`. Evaluar moverlos a
  perfil `test` o eliminarlos (los cubre `AdaptiveControllerTest`).

---

## 🔴 2. `JWT_SECRET` con default público en el repositorio

### Descripción

`application.yml`:

```yaml
integrity:
  security:
    jwt:
      secret: ${JWT_SECRET:aW50ZWdyaXR5RmFtaWx5U2VjcmV0S2V5Rm9yVGhlVW5pZmllZEludGVncml0eUVuZ2luZTIwMjY=}
```

Si `JWT_SECRET` no está definido en algún entorno, la aplicación arranca con una clave HMAC
**conocida y versionada en git**. Con ella cualquiera puede firmar un token arbitrario
(`sub`, `fid`, `role=ROLE_ADMIN`) y saltarse toda la autenticación y la autorización por familia.

Es el mismo antipatrón que se corrigió para `FAMILY_HOME_ID_SECRET` en el commit `9b6c5b1`
("sin default público — falla fuerte si falta"), pero aplicado al mecanismo de autenticación
principal, que es más sensible.

### Corrección aplicada

- `application.yml`: `secret: ${JWT_SECRET}` sin valor por defecto. Si falta la variable, Spring
  falla al resolver el placeholder y el arranque aborta (fail-fast), igual que
  `family-home.id-secret`.
- `docker-compose.yml`: se propaga `JWT_SECRET` al contenedor `backend` (antes no se pasaba: el
  contenedor dependía del default hardcodeado).
- `.env.example`: `JWT_SECRET` con un valor de **desarrollo** claramente etiquetado, para que el
  arranque local siga funcionando sin fricción.

### Acción requerida fuera del código (bloqueante para merge/deploy)

**Verificar que `JWT_SECRET` esté configurado como variable de entorno en Railway y/o Render
antes de desplegar este cambio.** Sin el default, un entorno sin la variable no arrancará.
Al rotar el secreto, todos los tokens vigentes quedan invalidados (los usuarios deben volver a
iniciar sesión) — comportamiento esperado.

---

## 🟠 3. El quality gate de JaCoCo documentado no existe

`quality.yml` ejecuta `mvn verify -P ci` y espera `target/site/jacoco/jacoco.xml`. Pero
`backend/pom.xml` **no tiene** el profile `ci`, **ni** el plugin `jacoco-maven-plugin`, **ni**
configuración de Surefire. Maven ignora `-P ci` con un warning (no falla).

Consecuencias:

- El "umbral 40% líneas" descrito en `CLAUDE.md` **no se aplica en ningún punto del pipeline**.
- SonarCloud recibe cobertura vacía y, además, su step tiene `continue-on-error: true` →
  **el quality gate de Sonar nunca bloquea un merge**.
- El único gate efectivo en `main`/`principal` es "los tests compilan y pasan" (`mvn verify`
  ejecuta Surefire aunque el resto falte).

### Corrección aplicada (3er cambio)

- `backend/pom.xml`: añadido `jacoco-maven-plugin` 0.8.12.
  - Siempre: `prepare-agent` + `report` (`verify`) → emite `target/site/jacoco/jacoco.xml`, que es
    justo lo que `quality.yml` pasa a SonarCloud (`-Dsonar.coverage.jacoco.xmlReportPaths`).
  - Profile `ci` (lo que invoca `quality.yml`): `jacoco:check` con `haltOnFailure=true` sobre
    `BUNDLE` / `LINE` / `COVEREDRATIO`.
- Umbral parametrizado en `<jacoco.line.coverage.min>` (property). **Cobertura real medida:
  68.9% líneas** (INSTRUCTION 67.6%, BRANCH 51.9%). El gate se fijó en **0.65** (~4 pt de
  holgura) en vez del 40% documentado, que con la cobertura actual no protegía nada.
- `CLAUDE.md` actualizado (líneas del comando de test y tabla de CI) al valor real.

Pendiente (no bloqueante): el step de SonarCloud sigue con `continue-on-error: true` → el quality
gate de Sonar no bloquea el merge. El gate real ahora es `jacoco:check`.

---

## 🟠 4. El workflow de deploy no ejecuta tests

`deploy-backend.yml`, job "Build & Test verification":

```yaml
- name: Compile backend (fail-fast antes de Railway)
  run: mvn compile -q -Dmaven.test.skip=true
```

No hay ejecución de tests, y el workflow no depende de `quality.yml`. `main` puede desplegarse a
producción con la suite en rojo. La "verify" del nombre solo compila.

### Corrección aplicada (4º cambio)

El job `verify` ahora corre `mvn -B verify -P ci --no-transfer-progress` (idéntico a `quality.yml`:
suite completa + gate JaCoCo). `deploy` sigue con `needs: verify`, así que un test en rojo bloquea
el despliegue. Coste: ~15-20 min extra por deploy — aceptable para esta plataforma. Redundante con
`quality.yml` (ambos corren en push a `main`), pero hace `deploy-backend.yml` autosuficiente en vez
de depender de una condición cruzada entre workflows.

---

## 🟠 5. Fuga de mensajes de excepción y Swagger en `railway`/`render`

`application.yml` base:

```yaml
server:
  error:
    include-message: ${SERVER_ERROR_INCLUDE_MESSAGE:always}
    include-binding-errors: ${SERVER_ERROR_INCLUDE_BINDING_ERRORS:always}
```

Se sobrescribe a `never` **solo** en el perfil `prod`. Los perfiles `railway` y `render` no lo
hacen → si producción corre con perfil `railway` (que es a donde despliega el workflow), los
mensajes de excepción se devuelven al cliente.

Mismo patrón con `springdoc.*.enabled: false`: está en `prod` y `application-prod.yml`, pero no
en `railway`/`render`. En esos perfiles `/v3/api-docs` y `/swagger-ui` quedan habilitados y son
`permitAll` en `SecurityConfig` → disclosure completo de la superficie de API.

**Recomendación:** confirmar el perfil real de producción (ver hallazgo 11) y llevar ahí:
`include-message: never`, `include-binding-errors: never`, `springdoc.*.enabled: false`.

---

## 🟠 6. `ddl-auto: update` en producción

`application-prod.yml`, y los perfiles `railway`, `render`, usan `ddl-auto: update` conviviendo
con Flyway. `CLAUDE.md` indica que producción debe ser `validate`, y las migraciones V68/V69/V112
existen precisamente para formalizar columnas que solo existían por `ddl-auto`.

Hibernate y Flyway mutando el schema en paralelo produce deriva. Sumado a
`spring.flyway.validate-on-migrate: false`, los checksums de migraciones tampoco se verifican
en el arranque.

**Recomendación:** `ddl-auto: validate` en todos los perfiles de despliegue; considerar
`validate-on-migrate: true` una vez el schema esté estabilizado por una migración snapshot.

---

## 🟡 7. Código de seguridad muerto y duplicado

- `security/JwtService.java` (105 líneas, "Arquitectura Criptográfica Maestra") — `@Service`
  (bean vivo en el contexto) pero **ningún `@Autowired` lo inyecta**. Deriva la clave como Base64
  (`Decoders.BASE64.decode`) mientras que el `JwtTokenProvider` real usa `secret.getBytes(UTF_8)`
  directo: dos criterios distintos para la misma clave, y un segundo consumidor de `${integrity.security.jwt.secret}`.
- `security/SecurityConfig.java` — `@Deprecated`, neutralizado, comentario "MODULAR DUPLICATE".
- `spring.main.allow-bean-definition-overriding: true` está activo para tapar estos choques de
  beans. Mientras siga activo, cualquier duplicado futuro se silencia en vez de fallar.

### Corrección aplicada (5º cambio)

- Borrados `security/JwtService.java`, `security/JwtServiceTest.java` (23 casos que solo probaban
  la clase muerta) y `security/SecurityConfig.java` (stub vacío, cero referencias).
- `docs/architecture.md`: el flujo de autenticación citaba `JwtService.generateToken()` →
  corregido a `AuthService.login()` / `JwtTokenProvider.generate()`.
- **`allow-bean-definition-overriding` se deja como está** de momento: quitarlo requiere confirmar
  que no hay otros duplicados de bean ocultos (más allá de estos dos). Follow-up separado.

---

## 🟡 8. Dos implementaciones paralelas de autorización por familia

| Bean | Modelo | Usado por |
|---|---|---|
| `common.security.SecurityValidator` | **multi-familia** (`memberRepository.findByEmail`, valida `member.familyId == familyId`) | 7 controllers + resolución de viewer (ADR-012) |
| `security.FamilySecurityEvaluator` (`@familySecurity`) | **una familia por usuario** (`user.getFamily().getId().equals(familyId)`) | 27 controllers vía `@PreAuthorize` |

Modelos de datos distintos. Si un usuario llega a pertenecer a dos familias, el comportamiento
diverge según qué endpoint toque. Elegir uno y consolidar.

---

## 🟡 9. `@Transactional` en 4 controllers

`checklist/TaskEvidenceController`, `common/NotificationController`, `family/FamilyController`,
`member/MemberController` — frontera transaccional en la capa web.

**Re-evaluado — NO es un cambio trivial "mover la anotación".** La mayoría son
`@Transactional(readOnly = true)` sobre métodos GET, y el mapeo a DTO (`fromEntity(...)`) ocurre
**dentro** de ese `@Transactional`, en el controller. Con `open-in-view: false` (perfil `prod`,
`application-prod.yml:19`), mover la anotación al servicio dejaría el mapeo fuera de toda
transacción → `LazyInitializationException` en producción. El fix correcto es empujar el mapeo a
DTO **dentro** de los métodos transaccionales del servicio (que devuelvan DTOs, no entidades),
método por método, verificando cada asociación lazy. La suite de tests corre con
`open-in-view: true` (base `application.yml`) y **no** detectaría la regresión.

Tratar como el hallazgo 8: pasada dedicada, no "cleanup". Prioridad baja.

---

## 🟡 10. `CLAUDE.md` desincronizado

| Afirma | Real | Estado |
|---|---|---|
| Angular 18 | `@angular/core: ^17.3.0` | ✅ corregido |
| "Flyway (V1→V67)" / "Próximo número disponible: V107" | V112 (110 archivos) | ✅ corregido, V107–V112 documentadas |
| ~120 clases de test | 199 | ✅ corregido |
| Faltan V61 y V88 en la secuencia | (huecos no explicados) | ✅ anotado en la guía |

---

## 🟠 11. Backend de producción — inconsistente y aparentemente caído

Configuración contradictoria:

- `if-frontend/src/environments/environment.prod.ts` apunta a `if-backend-v1-0-0.onrender.com`.
- `deploy-backend.yml` despliega a Railway; su paso de notificación cita `api.integrityfamily.online`.
- `backend/Dockerfile` fija `ENV SPRING_PROFILES_ACTIVE=prod`; `backend/railway.toml` fuerza
  `-Dspring.profiles.active=railway` en el `startCommand`. Dos perfiles distintos según qué
  fichero de config lea Railway.
- `application.yml` tiene perfiles `railway` **y** `render` coexistiendo.

Sondeo HTTP externo (2026-09-06):

- `api.integrityfamily.online` → resuelve a `198.54.117.242` (IP de **parking de Namecheap**).
  El dominio custom no apunta a Railway. El target de `deploy-backend.yml` está efectivamente
  a oscuras.
- `if-backend-v1-0-0.onrender.com` → **HTTP 503 en todas las rutas** (incluida `/`) de forma
  sostenida >2 min. No es un cold-start transitorio; el servicio de Render parece suspendido o
  en crash-loop.

Implicación: **ningún backend de producción conocido responde.** No se pudo confirmar el perfil
activo (`prod` vs `railway`) por HTTP. Antes de cerrar los hallazgos 5 y 6 hay que:
1. Determinar cuál es el backend vivo real (¿una URL `*.up.railway.app`? ¿otro servicio Render?).
2. Confirmar su `SPRING_PROFILES_ACTIVE`.
3. Decidir Railway **o** Render como único destino y borrar la config del otro.

---

## 🟡 12. JDK 17 (CI) vs JDK 21 (deploy)

`quality.yml` compila y testea con **JDK 17**; `deploy-backend.yml` compila con **JDK 21** sin
`--release 17`. Se valida un bytecode distinto al que se despliega.

### Corrección aplicada (4º cambio)

`deploy-backend.yml` → `java-version: '17'`. Ambos workflows en 17, alineados con
`<java.version>17</java.version>` de `pom.xml`. Nota: el `Dockerfile` de Railway usa
`eclipse-temurin:21` (builder y runtime); el `pom` compila a bytecode 17, así que corre en 21 sin
problema, pero conviene alinearlo a 17 también cuando se toque el Dockerfile.

---

## 🟢 Lo que está sano

- **Aislamiento de la capa `interop`**: cero imports de `ca.uhn` / `org.hl7.fhir` fuera de
  `interop/`. El dominio no conoce FHIR. Bien ejecutado (Fases 0–5).
- **Capas**: `domain` no importa `service` ni `controller`.
- Sin `printStackTrace`, sin tests `@Disabled`, sin `TODO`/`FIXME` reales. Los `catch` amplios
  (~224) en su mayoría loguean a `warn`/`error`. Código maduro.
- Frontend con `strict: true` + `strictTemplates`. Sin secretos hardcodeados en `if-frontend/src/`.
- Solo `.env.example` trackeado en git; sin `.env` real; historial sin fugas de secretos.
- `SecurityValidator` centralizado con el orden de chequeos correcto (admin → creador → miembro
  activo).
- CORS restrictivo salvo el caso Alexa (que va con `allowCredentials=false`).
- Módulo Hogar Digital (`familyhome`/`hud`) con autorización de membresía en la capa de
  aplicación y diseño hexagonal limpio.

---

## Plan de acción priorizado

1. **[hecho en este cambio]** Quitar el default de `JWT_SECRET`; propagar la variable en
   `docker-compose`; valor de dev en `.env.example`. → **Verificar `JWT_SECRET` en Railway/Render
   antes de mergear.**
2. **[hecho en este cambio]** `@PreAuthorize("@familySecurity.check(...)")` en los 9 controllers
   sin protección.
3. **[hecho en el 2º cambio]** Pertenencia de sub-recursos a `familyId`:
   `checkErrorProtocol(Long)` + `checkAdjustment(UUID)` en `FamilySecurityEvaluator`, anotados en
   `ErrorProtocolController.update/close` y `AdaptiveController` approve/apply/reject. Guardian ya
   estaba cubierto en el servicio. Pendiente menor: sacar `/api/v1/adaptive/*` de producción.
4. Determinar el backend de prod vivo y su `SPRING_PROFILES_ACTIVE` (hallazgo 11); luego
   aplicarle `include-message: never`, Swagger off, `ddl-auto: validate` (hallazgos 5 y 6).
5. **[hecho en el 3er cambio]** Gate de JaCoCo real (`jacoco:check` a 65%).
6. **[hecho en el 4º cambio]** `deploy-backend.yml` corre `mvn verify -P ci` (hallazgo 4);
   ambos workflows en JDK 17 (hallazgo 12).
7. **[hecho en el 5º cambio]** Borrados `JwtService` + su test + `security.SecurityConfig`
   (hallazgo 7). Pendiente aparte: evaluar apagar `allow-bean-definition-overriding`.
8. **[hecho en el 6º cambio]** `CLAUDE.md` sincronizado (hallazgo 10).
9. Pasadas dedicadas (no "cleanup"), prioridad baja:
   - Hallazgo 8 — consolidar `SecurityValidator` + `FamilySecurityEvaluator`.
   - Hallazgo 9 — empujar el mapeo a DTO dentro de los métodos transaccionales del servicio
     (riesgo `LazyInitException` en prod si se hace mal).
