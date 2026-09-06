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
| 1 | 🔴 Crítico | Seguridad | Control de acceso roto entre familias (IDOR) en 9 controllers | **En curso** (este cambio) |
| 2 | 🔴 Crítico | Seguridad | `JWT_SECRET` con default público hardcodeado en `application.yml` | **En curso** (este cambio) |
| 3 | 🟠 Alto | Build/CI | El quality gate de JaCoCo documentado no existe en `pom.xml` | Abierto |
| 4 | 🟠 Alto | Build/CI | El workflow de deploy no ejecuta tests | Abierto |
| 5 | 🟠 Alto | Config | Fuga de mensajes de excepción y Swagger en perfiles `railway`/`render` | Abierto |
| 6 | 🟠 Alto | Config | `ddl-auto: update` en producción conviviendo con Flyway | Abierto |
| 7 | 🟡 Medio | Deuda | `JwtService` y `security.SecurityConfig` muertos; `allow-bean-definition-overriding` | Abierto |
| 8 | 🟡 Medio | Arquitectura | Dos implementaciones paralelas de autorización por familia | Abierto |
| 9 | 🟡 Medio | Deuda | `@Transactional` en 4 controllers | Abierto |
| 10 | 🟡 Medio | Docs | `CLAUDE.md` desincronizado (versión, nº migraciones, nº tests) | Abierto |
| 11 | 🟠 Alto | Config | Backend de producción inconsistente y sin responder (Railway parkeado, Render 503) | Abierto |
| 12 | 🟡 Medio | Build/CI | JDK 17 (CI) vs JDK 21 (deploy) sin `--release` | Abierto |

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

### Riesgo residual (follow-up, no cubierto por este cambio)

- **`ErrorProtocolController.update/close`** y **`GuardianController.completeMission`** reciben un
  `{id}`/`{missionId}` y lo pasan al servicio **sin verificar que ese recurso pertenezca a
  `familyId`**. `@familySecurity.check(#familyId)` cierra el acceso a la familia, pero un miembro
  legítimo de la familia A podría pasar el `id` de un recurso de la familia B. Hace falta un
  `checkErrorProtocol(id)` / validar `protocol.familyId == familyId` en el servicio.
- **`AdaptiveController`**: los endpoints `/adaptive-adjustments/{adjustmentId}/{approve,apply,reject}`
  se indexan por `adjustmentId` (UUID) y no tienen overload en `FamilySecurityEvaluator`. Quedan
  solo con `authenticated()`. Falta `checkAdjustment(UUID)`.
- **`AdaptiveController`**: los endpoints `/api/v1/adaptive/{evaluate,approve,apply}` ("compatibilidad
  para QA de contrato en memoria") no deberían estar expuestos en producción. Evaluar moverlos a
  perfil `test` o eliminarlos.

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

**Recomendación:** o se agrega el plugin JaCoCo + profile `ci` con `haltOnFailure` real al
`pom.xml`, o se elimina de `CLAUDE.md` la afirmación de que existe el gate.

---

## 🟠 4. El workflow de deploy no ejecuta tests

`deploy-backend.yml`, job "Build & Test verification":

```yaml
- name: Compile backend (fail-fast antes de Railway)
  run: mvn compile -q -Dmaven.test.skip=true
```

No hay ejecución de tests, y el workflow no depende de `quality.yml`. `main` puede desplegarse a
producción con la suite en rojo. La "verify" del nombre solo compila.

**Recomendación:** `mvn verify` (sin `skip`) en el job `verify`, o condicionar `deploy` a que el
run de `quality.yml` sobre el mismo SHA haya pasado.

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

- `security/JwtService.java` (105 líneas, "Arquitectura Criptográfica Maestra") — **sin usos**,
  solo auto-referencias. Además deriva la clave como Base64 (`Decoders.BASE64.decode`) mientras
  que el `JwtTokenProvider` real usa `secret.getBytes(UTF_8)` directo: dos criterios distintos
  para la misma clave.
- `security/SecurityConfig.java` — `@Deprecated`, neutralizado, comentario "MODULAR DUPLICATE".
- `spring.main.allow-bean-definition-overriding: true` está activo para tapar estos choques de
  beans. Mientras siga activo, cualquier duplicado futuro se silencia en vez de fallar.

**Recomendación:** borrar `JwtService` y `security.SecurityConfig`; luego evaluar apagar
`allow-bean-definition-overriding`.

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
`member/MemberController` — frontera transaccional en la capa web. Mover a la capa de servicio.

---

## 🟡 10. `CLAUDE.md` desincronizado

| Afirma | Real |
|---|---|
| Angular 18 | `@angular/core: ^17.3.0` |
| Migraciones V1→V67 / "Próximo número disponible: V107" | V112 (V107–V112 sin documentar en la guía) |
| ~120 clases de test | 200 |
| Faltan V61 y V88 en la secuencia | (huecos no explicados) |

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
`--release 17`. Se valida un bytecode distinto al que se despliega. Unificar en 17 (o subir
`java.version` a 21 en `pom.xml` y en ambos workflows).

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
3. Follow-up del hallazgo 1: validar pertenencia de sub-recursos (`errorProtocolId`,
   `missionId`, `adjustmentId`) a `familyId` en la capa de servicio; añadir overloads a
   `FamilySecurityEvaluator`.
4. Alinear el perfil de producción (hallazgo 11) y aplicarle `include-message: never`, Swagger
   off, `ddl-auto: validate` (hallazgos 5 y 6).
5. Arreglar o retirar el gate de JaCoCo (hallazgo 3); quitar `-Dmaven.test.skip=true` del deploy
   (hallazgo 4).
6. Borrar `JwtService` y `security.SecurityConfig`; evaluar apagar
   `allow-bean-definition-overriding` (hallazgo 7).
7. Consolidar `SecurityValidator` y `FamilySecurityEvaluator` en una sola implementación
   (hallazgo 8).
8. Sincronizar `CLAUDE.md` (hallazgo 10); unificar JDK (hallazgo 12); mover `@Transactional`
   fuera de los controllers (hallazgo 9).
