# Priorización de visitas domiciliarias rurales (Cundinamarca)

Microservicio NestJS que sugiere el orden en que un equipo de salud visita veredas rurales durante una jornada. Combina el índice de vulnerabilidad de cada vereda con la distancia por vía aproximada, compara la ruta con una estrategia de vecino más cercano y deja un registro de auditoría verificable de cada intento.

Las personas inician sesión con usuario y contraseña desde un cliente (aplicación web, móvil o Swagger) y el sistema separa las funciones por rol: el **coordinador** genera rutas, el **equipo de salud** las valida, el **auditor** revisa la trazabilidad y el **administrador** gestiona las cuentas. Ningún rol puede generar y aprobar la misma ruta.

> **Advertencia.** Es una demostración de arquitectura y lógica de priorización. Usa **datos simulados** (`"simulated": true`), sin datos personales ni clínicos, y con nombres ficticios del tipo "Vereda Simulada 01". El resultado es una **sugerencia que requiere revisión y validación humana** y no reemplaza el criterio del equipo de salud.

## Contenido

1. [Arquitectura](#arquitectura)
2. [Roles y segregación de funciones](#roles-y-segregación-de-funciones)
3. [Algoritmo](#algoritmo)
4. [Seguridad](#seguridad)
5. [Auditoría y validación humana](#auditoría-y-validación-humana)
6. [Ejecución con Docker](#ejecución-con-docker)
7. [Inicio de sesión y tokens](#inicio-de-sesión-y-tokens)
8. [Ejemplos de uso](#ejemplos-de-uso)
9. [Desarrollo local y pruebas](#desarrollo-local-y-pruebas)
10. [Configuración](#configuración)
11. [Estructura y decisiones](#estructura-y-decisiones)

## Arquitectura

```
  Usuario (web, móvil, Swagger)        Integración de servidor
        │ usuario + contraseña                │ Client Credentials
        │ (POST /auth/login o PKCE)           │
        ▼                                     ▼
                    ┌──────────────────────────────┐
                    │ Keycloak (realm rural-health) │  roles de realm y scopes
                    └─────────────┬────────────────┘  filtrados por rol
                                  │ JWT RS256 (iss, aud, exp, scope, realm_access.roles)
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ API NestJS  /api/v1                                                  │
│  ThrottlerGuard → JwtAuthGuard (JWKS) → ScopesGuard → RolesGuard     │
│  → ValidationPipe                                                    │
│                                                                      │
│  auth ──► Keycloak (token, refresh, logout)                          │
│  users ─► Keycloak Admin API (cuentas y roles, solo ADMIN)           │
│                                                                      │
│  routes ──────► route_engine ◄────── audit                           │
│    │  (Strategy: VULNERABILITY_WEIGHTED, NEAREST_NEIGHBOR)  │         │
│    │                  ▲                                     │         │
│    └──────► veredas ──┘ (data/veredas.json + SHA-256)       │         │
│    │                                                        │         │
│    └── una transacción: routes + route_audit_logs ◄─────────┘         │
└──────────────────────────────────────┬───────────────────────────────┘
                                       ▼
                          PostgreSQL (migraciones SQL, trigger append-only)
```

Módulos planos en `src/`:

| Módulo | Responsabilidad |
| --- | --- |
| `route_engine` | Cálculo puro: estrategias (patrón Strategy), parámetros, tramos, comparación y desglose. No depende de controladores, TypeORM ni de `audit`. |
| `routes` | Genera, lista y consulta rutas, y registra su validación humana (`POST /routes/:id/review`). Guarda la ruta y su auditoría en la misma transacción. Importa `route_engine`, `veredas` y `audit`. |
| `audit` | Escritura append-only con cadena de hashes, consulta paginada, detalle y verificación. Importa `route_engine` y `veredas`, **nunca** `routes`. |
| `veredas` | Carga y valida `data/veredas.json` al arrancar, calcula su SHA-256 y expone el catálogo público con `priorityBand`. |
| `auth` | Estrategia `passport-jwt` + `jwks-rsa`, guards globales (`JwtAuthGuard`, `ScopesGuard`, `RolesGuard`), decoradores `@Public()`, `@Scopes()`, `@Roles()`, `@GetUser()`, catálogo de roles y permisos, e inicio de sesión contra Keycloak (`/auth/login`, `/refresh`, `/logout`, `/me`, `/roles`). |
| `users` | Gestión de cuentas para ADMIN mediante la Admin API de Keycloak (crear, listar, editar, habilitar o deshabilitar, cambiar rol, restablecer contraseña) y cambio de la contraseña propia. Keycloak es la única fuente de verdad de las cuentas. |
| `common` | Utilidades (Haversine, hashes canónicos, paginación, bandas de prioridad, correlationId), DTOs comunes y filtro global de excepciones. |
| `health` | `GET /health` público: estado de la base de datos y del dataset. |

Para agregar una estrategia nueva basta con implementar `RouteStrategy` (`src/route_engine/strategies/route-strategy.interface.ts`), registrarla en `RouteEngineModule` y añadir su nombre al enum `RouteStrategyName`. El controlador no cambia.

## Roles y segregación de funciones

Los roles son roles de realm en Keycloak. Cada endpoint exige **dos condiciones**: que el token tenga el scope (lo que el cliente puede pedir) y que el usuario tenga el rol (lo que la persona puede hacer). Además, en Keycloak cada scope está atado a roles, así que un usuario solo recibe los scopes de su rol aunque pida otros.

| Rol | Función | Scopes que recibe | Permisos (`/auth/me`) |
| --- | --- | --- | --- |
| `COORDINADOR` | Planifica las jornadas: genera rutas | `routes:read`, `routes:write` | `veredas:view`, `routes:view`, `routes:generate` |
| `EQUIPO_SALUD` | Valida en campo las rutas sugeridas (aprueba o rechaza) | `routes:read`, `routes:review` | `veredas:view`, `routes:view`, `routes:review` |
| `AUDITOR` | Revisa la trazabilidad, el índice numérico y el desglose del score; verifica rutas | `routes:read`, `audit:read` | `veredas:view`, `routes:view`, `audit:view`, `audit:verify` |
| `ADMIN` | Gestiona cuentas y roles | `routes:read`, `users:manage` | `veredas:view`, `routes:view`, `users:manage` |

Matriz de acceso (✔ permitido, ✘ 403):

| Endpoint | COORDINADOR | EQUIPO_SALUD | AUDITOR | ADMIN |
| --- | :-: | :-: | :-: | :-: |
| `GET /veredas`, `GET /routes`, `GET /routes/:id` | ✔ | ✔ | ✔ | ✔ |
| `POST /routes` | ✔ | ✘ | ✘ | ✘ |
| `POST /routes/:id/review` | ✘ | ✔ | ✘ | ✘ |
| `GET /audit/routes`, `GET /audit/routes/:id`, `POST /audit/routes/:id/verify` | ✘ | ✘ | ✔ | ✘ |
| `GET/POST/PATCH/PUT /users…` | ✘ | ✘ | ✘ | ✔ |
| `GET /auth/me`, `GET /auth/roles`, `PUT /users/me/password` | ✔ | ✔ | ✔ | ✔ |

Reglas adicionales:

- **Quien genera una ruta no puede validarla**, aunque tuviera también el rol `EQUIPO_SALUD` (403 con el motivo).
- La validación es **definitiva**: una sola decisión por ruta (409 si se repite) en una tabla append-only. Rechazar exige observaciones.
- Un administrador **no puede deshabilitarse ni quitarse el rol ADMIN** (409), de modo que siempre queda al menos un administrador.
- Cambiar el rol, restablecer la contraseña o deshabilitar una cuenta **cierra sus sesiones** en Keycloak: el siguiente token refleja el cambio. Los access tokens ya emitidos vencen en 5 minutos.
- Las cuentas de servicio de las integraciones (`planificador-app` con rol `COORDINADOR`, `auditor-app` con rol `AUDITOR`) no aparecen en `/users` y no se modifican desde la API.
- Un token sin rol funcional recibe 403. Una cuenta sin rol no puede iniciar sesión por `/auth/login` (403).

**Registro de cuentas.** Hay dos formas de crear una cuenta:

1. **Registro público** con `POST /auth/register` (usuario, correo, nombre, apellido y contraseña). La persona **no elige su rol** (enviar `role` responde 400): la cuenta queda marcada con el rol técnico `PENDIENTE_APROBACION`, que no otorga funciones, y `/auth/login` responde 403 hasta que un ADMIN la apruebe. El ADMIN ve las cuentas pendientes con `GET /users?pendingApproval=true` y las aprueba asignándoles un rol con `PUT /users/:id/role`, que además quita la marca. Se desactiva con `SELF_REGISTRATION_ENABLED=false` (403).
2. **Alta por un ADMIN** con `POST /users`, que crea la cuenta con su rol y queda lista para iniciar sesión.

Así nadie puede darse a sí mismo un rol con privilegios.

Usuarios de demostración (importados con el realm; contraseñas solo para uso local):

| Usuario | Contraseña | Rol |
| --- | --- | --- |
| `admin.demo` | `Gestion.Usuarios2026` | `ADMIN` |
| `coordinador.demo` | `Planifica.Rutas2026` | `COORDINADOR` |
| `coordinador2.demo` | `Planifica.Jornada2026` | `COORDINADOR` |
| `auditor.demo` | `Revisa.Trazas2026` | `AUDITOR` |
| `equipo.demo` | `Valida.Campo2026` | `EQUIPO_SALUD` |

Política de contraseñas (Keycloak y validación de la API): entre 10 y 128 caracteres, con mayúscula, minúscula y número, y sin contener el nombre de usuario. Keycloak bloquea temporalmente una cuenta tras 5 intentos fallidos.

## Algoritmo

**Distancia.** `geo.util.ts` calcula la distancia de Haversine (radio medio terrestre 6371.0088 km) y la multiplica por `ROAD_FACTOR` (1.3 por defecto, configurable entre 1 y 2.5) para aproximar la distancia por vía. Cada distancia se redondea a 3 decimales (metros) antes de compararse.

**VULNERABILITY_WEIGHTED (voraz).** Desde la base, en cada paso y para cada candidata restante:

```
score = alpha * (vulnerabilityIndex / 100) + (1 - alpha) * (1 - d / dMax)
```

`d` es la distancia desde la posición actual y `dMax` la mayor distancia entre las candidatas de ese paso; si `dMax = 0`, se usa `d / dMax = 0`. Se visita la de mayor score (redondeado a 6 decimales) hasta completar `visitCount`. Si `returnToBase` es `true`, se suma el tramo de regreso.

**NEAREST_NEIGHBOR.** En cada paso visita la vereda más cercana. Siempre se ejecuta como comparación y su resultado aparece en `comparison`.

**Determinismo.** El orden de entrada no influye: las candidatas se ordenan por id y el comparador es total. Desempate: mayor vulnerabilidad y luego id ascendente. Con `alpha = 0`, el orden coincide con NEAREST_NEIGHBOR; con `alpha = 1`, se ordena por vulnerabilidad descendente. Las pruebas cubren ambos casos.

**Bandas de prioridad.** `ALTA` ≥ 70, `MEDIA` 40–69, `BAJA` < 40. Las respuestas para `routes:read` y `routes:write` solo muestran la banda. El índice numérico y el desglose del score solo se ven con `audit:read` (rol `AUDITOR`).

## Seguridad

- **Resource Server OAuth 2.0.** Valida los JWT con las claves publicadas en el JWKS de Keycloak: firma RS256, `iss`, `aud` (`rural-routes-api`) y `exp`.
- **Guards globales**: `ThrottlerGuard` → `JwtAuthGuard` → `ScopesGuard` → `RolesGuard`. Todo endpoint exige token, salvo los marcados con `@Public()` (`/health`, `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`).
- **Respuestas**: `401` si el token falta o es inválido (firma, emisor, audiencia o expiración); `403` si falta un scope o el rol.
- **Clientes del realm** (`keycloak/realm-export.json`, importado automáticamente):

  | Cliente | Tipo | Flujos | Uso |
  | --- | --- | --- | --- |
  | `rural-routes-web` | Público (sin secreto) | Authorization Code + PKCE (S256), Direct Access Grant | Inicio de sesión de personas desde un cliente o desde la API (`/auth/login`) |
  | `planificador-app` | Confidencial, `planificador-demo-secret` | Client Credentials | Integración con rol `COORDINADOR` |
  | `auditor-app` | Confidencial, `auditor-demo-secret` | Client Credentials | Integración con rol `AUDITOR` |
  | `rural-routes-admin-api` | Confidencial, `admin-api-demo-secret` | Client Credentials | Cuenta de servicio que usa la API para la Admin API (`view-users`, `query-users`, `manage-users`, `view-realm`) |

  El client scope compartido `rural-api` agrega la audiencia `rural-routes-api`, `sub`, `preferred_username`, `email`, `name` y `realm_access.roles`. Los scopes `routes:write`, `routes:review`, `audit:read` y `users:manage` tienen *role scope mappings*, así que Keycloak solo los incluye en el token si el usuario tiene el rol correspondiente.
- **Inicio de sesión**: `POST /auth/login` intercambia usuario y contraseña en Keycloak con el cliente público y devuelve access token, refresh token y el perfil con roles, scopes y permisos para que el cliente muestre solo las opciones permitidas. Keycloak rota el refresh token en cada uso. Para una aplicación web en producción se recomienda Authorization Code + PKCE directamente contra Keycloak (ya habilitado en `rural-routes-web`), de modo que la contraseña nunca pase por la API.
- **Defensa adicional**: `helmet`, rate limiting configurable (general y uno más estricto para `/auth/register`, `/auth/login`, `/auth/refresh` y `/auth/logout`), protección contra fuerza bruta en Keycloak, CORS por lista de orígenes y `ValidationPipe` con `whitelist`, `forbidNonWhitelisted` y `transform`.
- **Logs JSON** (`nestjs-pino`) con `correlationId` (cabecera `X-Correlation-Id` si es segura; si no, un UUID nuevo). No se registran cabeceras ni cuerpos: `authorization` y `cookie` se eliminan, y contraseñas y tokens nunca se escriben en los logs.
- **Secretos**: el repositorio solo tiene valores de demostración. Cámbielos fuera de un entorno local.

## Auditoría y validación humana

Cada intento de `POST /routes` genera un registro en `route_audit_logs`:

| Campo | Contenido |
| --- | --- |
| `id`, `occurred_at`, `correlation_id` | Identificación del intento |
| `actor_sub`, `actor_client_id`, `actor_username`, `actor_roles`, `scopes` | Actor según el token: identidad, cliente, rol funcional y scopes |
| `received_parameters`, `applied_parameters` | Cuerpo recibido y parámetros finales con valores por defecto |
| `algorithm_version`, `dataset_version`, `dataset_hash` | Versión del algoritmo y del dataset, y SHA-256 del archivo |
| `result`, `score_breakdown` | Resultado completo y desglose por paso con todas las candidatas, índices y componentes del score |
| `status`, `error_details`, `duration_ms` | `SUCCESS`, `VALIDATION_ERROR` o `FORBIDDEN` |
| `previous_hash`, `record_hash` | Cadena de integridad SHA-256 sobre JSON canónico |

- La ruta y su auditoría se escriben en **una sola transacción**. Si falla la auditoría, la ruta no se guarda y la API responde 500 (hay una prueba E2E para esto).
- La cadena se serializa con `pg_advisory_xact_lock`, así que cada `previous_hash` apunta al registro anterior aunque haya solicitudes concurrentes.
- `003_block_audit_changes.sql` crea triggers que impiden `UPDATE`, `DELETE` y también `TRUNCATE`.
- Los rechazos `400` y `403` de `POST /routes` (por scope o por rol) se auditan desde el filtro global de excepciones. Los `401` no se auditan porque no hay actor autenticado.
- `actor_username` y `actor_roles` se añadieron con la migración `004`. Entran en el `record_hash` solo cuando el registro los tiene, así que los registros anteriores siguen verificando con su hash original.
- `POST /audit/routes/:id/verify` recalcula la ruta con los parámetros guardados, incluido el `roadFactor`, y la compara sección por sección. Informa `matches`, `differences`, si cambió la versión o el hash del dataset o la versión del algoritmo, y la integridad del registro (`recordHashValid`, `previousHashValid`). En `/audit/routes/:id`, el `:id` acepta el id de auditoría o el `routeId`. El filtro `actor` acepta `sub`, `client_id` o `username`.

**Validación humana.** Toda ruta nace en estado `PENDIENTE_REVISION`. Un integrante de `EQUIPO_SALUD` distinto de quien la generó registra la decisión con `POST /routes/:id/review` (`APROBADA` o `RECHAZADA`; rechazar exige `observations`). La decisión queda en `route_reviews` con el revisor (`sub`, usuario y roles), la fecha y el `correlationId`. La migración `005` impide `UPDATE`, `DELETE` y `TRUNCATE` en esa tabla y garantiza una sola decisión por ruta. `GET /routes?reviewStatus=PENDIENTE_REVISION` sirve como bandeja de trabajo del equipo de salud.

## Ejecución con Docker

Requisitos: Docker con Compose v2.

```bash
docker compose up --build
```

Servicios:

| Servicio | URL |
| --- | --- |
| API | http://localhost:3000/api/v1 |
| Swagger (OAuth 2.0) | http://localhost:3000/docs |
| Keycloak | http://localhost:8080 (admin / admin_demo_password) |
| PostgreSQL | localhost:5433 (rural / rural_demo_password) |

El contenedor `api` ejecuta `npm run db:migrate` (aplica cada migración una sola vez y la registra en `schema_migrations` con su checksum) y luego inicia la API. Espera a que PostgreSQL y Keycloak estén sanos.

Keycloak importa el realm solo cuando el contenedor se crea (`--import-realm` no sobrescribe un realm existente). Si actualiza `keycloak/realm-export.json` con el stack ya creado, recree el contenedor:

```bash
docker compose up -d --force-recreate keycloak
```

Para detener y borrar los datos de demostración:

```bash
docker compose down -v
```

## Inicio de sesión y tokens

**Registrarse** (la cuenta queda pendiente hasta que un ADMIN le asigne un rol):

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register -H "Content-Type: application/json" -d '{"username":"promotora.guaduas","email":"promotora.guaduas@rural-health.test","firstName":"Marta","lastName":"Guzmán","password":"Promueve.Salud2026"}'
```

**Iniciar sesión (recomendado para la demostración):**

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d '{"username":"coordinador.demo","password":"Planifica.Rutas2026"}'
```

Respuesta resumida:

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": 300,
  "refreshToken": "eyJhbGciOiJIUzUxMiIs...",
  "refreshExpiresIn": 1800,
  "user": {
    "username": "coordinador.demo",
    "name": "Coordinadora Demo",
    "roles": ["COORDINADOR"],
    "scopes": ["routes:read", "routes:write"],
    "permissions": ["routes:generate", "routes:view", "veredas:view"]
  }
}
```

Renovar y cerrar la sesión:

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/refresh -H "Content-Type: application/json" -d '{"refreshToken":"<refreshToken>"}'
```

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/logout -H "Content-Type: application/json" -d '{"refreshToken":"<refreshToken>"}'
```

Un cliente web (por ejemplo en `http://localhost:5173` o `http://localhost:4200`, ya registrados como redirect URIs y orígenes) puede usar Authorization Code + PKCE directamente contra `http://localhost:8080/realms/rural-health/protocol/openid-connect/auth` con `client_id=rural-routes-web`.

**Integraciones de servidor (Client Credentials):**

```bash
curl -s -X POST http://localhost:8080/realms/rural-health/protocol/openid-connect/token -d grant_type=client_credentials -d client_id=planificador-app -d client_secret=planificador-demo-secret
```

```bash
curl -s -X POST http://localhost:8080/realms/rural-health/protocol/openid-connect/token -d grant_type=client_credentials -d client_id=auditor-app -d client_secret=auditor-demo-secret
```

El token (`accessToken` o `access_token`) se envía como `Authorization: Bearer <token>`. Los access tokens duran 5 minutos y la sesión 30 minutos de inactividad.

En Swagger (`/docs`), pulse **Authorize** y use el esquema `oauth2`:

- **authorizationCode** (PKCE) o **password**: `client_id` `rural-routes-web`, sin secreto, e inicie sesión con un usuario de demostración.
- **clientCredentials**: `planificador-app` o `auditor-app` con su secreto.

También puede pegar en `bearer` el `accessToken` de `/auth/login`.

`requests.http` tiene una colección para VS Code REST Client o el cliente HTTP de JetBrains. Ejecute los inicios de sesión, copie cada `accessToken` en `@adminToken`, `@coordinatorToken`, `@auditorToken` y `@teamToken`, y los ids generados en `@routeId` y `@userId`.

## Ejemplos de uso

Generar una ruta como coordinador, excluyendo una vereda con la vía cerrada:

```bash
curl -s -X POST http://localhost:3000/api/v1/routes -H "Authorization: Bearer $COORDINATOR_TOKEN" -H "Content-Type: application/json" -H "X-Correlation-Id: demo-jornada-0001" -d '{"excludedVeredaIds":["VS-04"]}'
```

Respuesta resumida (resultado real con el dataset incluido):

```json
{
  "routeId": "08ca7e80-49a9-4217-bf43-1cd99c21e601",
  "algorithmVersion": "1.0.0",
  "datasetVersion": "2026.11-sim.1",
  "parameters": { "strategy": "VULNERABILITY_WEIGHTED", "visitCount": 5, "alpha": 0.6, "returnToBase": true, "excludedVeredaIds": ["VS-04"], "roadFactor": 1.3 },
  "stops": [
    { "order": 1, "veredaId": "VS-03", "nombre": "Vereda Simulada 03", "legKm": 13.135, "cumulativeKm": 13.135, "priorityBand": "ALTA",
      "reason": "Obtuvo el mayor puntaje entre 11 candidatas al combinar vulnerabilidad (peso 0.6) y cercanía (peso 0.4). Prioridad ALTA; queda a 13.1 km de Base Simulada Puesto de Salud Rural." },
    { "order": 2, "veredaId": "VS-01", "legKm": 11.462, "cumulativeKm": 24.597, "priorityBand": "ALTA" },
    { "order": 3, "veredaId": "VS-06", "legKm": 17.087, "cumulativeKm": 41.684, "priorityBand": "ALTA" },
    { "order": 4, "veredaId": "VS-09", "legKm": 10.72, "cumulativeKm": 52.404, "priorityBand": "MEDIA" },
    { "order": 5, "veredaId": "VS-02", "legKm": 17.175, "cumulativeKm": 69.579, "priorityBand": "MEDIA" }
  ],
  "returnLeg": { "fromVeredaId": "VS-02", "toBaseId": "BASE-SIM-01", "legKm": 13.439, "cumulativeKm": 83.018 },
  "totalDistanceKm": 83.018,
  "notSelected": [
    { "veredaId": "VS-04", "excluded": true, "reason": "Excluida por solicitud del planificador (por ejemplo, por una vía cerrada)." }
  ],
  "comparison": { "strategy": "NEAREST_NEIGHBOR", "totalDistanceKm": 103.168, "selectedVeredaIds": ["VS-01", "VS-03", "VS-05", "VS-10", "VS-12"], "distanceDifferenceKm": -20.15, "sameSelection": false, "sameOrder": false },
  "createdBy": { "username": "coordinador.demo", "clientId": "rural-routes-web", "roles": ["COORDINADOR"] },
  "review": { "status": "PENDIENTE_REVISION", "decision": null, "observations": null, "reviewedBy": null, "reviewedAt": null },
  "disclaimer": "Sugerencia generada automáticamente con datos simulados (dataset 2026.11-sim.1). No reemplaza el criterio del equipo de salud: requiere revisión y validación humana antes de programar la jornada."
}
```

Validar la ruta como equipo de salud:

```bash
curl -s -X POST http://localhost:3000/api/v1/routes/<routeId>/review -H "Authorization: Bearer $TEAM_TOKEN" -H "Content-Type: application/json" -d '{"decision":"APROBADA","observations":"Vías transitables según el reporte del día."}'
```

Crear una cuenta como administrador:

```bash
curl -s -X POST http://localhost:3000/api/v1/users -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"username":"enfermera.zipaquira","email":"enfermera.zipaquira@rural-health.test","firstName":"Laura","lastName":"Rincón","role":"EQUIPO_SALUD","password":"Visita.Rural2026"}'
```

Otros endpoints (prefijo `/api/v1`):

| Método y ruta | Scope | Rol | Descripción |
| --- | --- | --- | --- |
| `POST /auth/register` | público | | Registra una cuenta pendiente de aprobación (201), 409 si ya existe, 400 si intenta elegir rol |
| `POST /auth/login` | público | con rol funcional | Inicia sesión (200), 401 credenciales, 403 sin rol o pendiente de aprobación, 429 demasiados intentos |
| `POST /auth/refresh` | público | | Renueva y rota los tokens |
| `POST /auth/logout` | público | | Cierra la sesión del refresh token (204) |
| `GET /auth/me` | token válido | cualquiera | Identidad, roles, scopes y permisos |
| `GET /auth/roles` | token válido | cualquiera | Catálogo de roles con sus funciones |
| `POST /routes` | `routes:write` | `COORDINADOR` | Genera una ruta (201), 400 si los parámetros son inválidos |
| `GET /routes?from&to&strategy&reviewStatus&createdBy&page&limit` | `routes:read` | todos | Lista paginada de rutas |
| `GET /routes/:id` | `routes:read` | todos | Ruta guardada con su validación |
| `POST /routes/:id/review` | `routes:review` | `EQUIPO_SALUD` | Valida la ruta (201), 403 si la generó, 409 si ya fue validada |
| `GET /veredas` | `routes:read` | todos | Catálogo con `priorityBand`, sin el índice numérico |
| `GET /audit/routes?from&to&actor&status&page&limit` | `audit:read` | `AUDITOR` | Lista paginada de intentos |
| `GET /audit/routes/:id` | `audit:read` | `AUDITOR` | Detalle con el desglose completo e integridad |
| `POST /audit/routes/:id/verify` | `audit:read` | `AUDITOR` | Recalcula y compara (200), 409 si el intento no fue exitoso |
| `GET /users?search&role&enabled&pendingApproval&page&limit` | `users:manage` | `ADMIN` | Lista de cuentas con rol funcional y pendientes de aprobación |
| `GET /users/:id` | `users:manage` | `ADMIN` | Detalle de una cuenta |
| `POST /users` | `users:manage` | `ADMIN` | Crea una cuenta con rol (201), 409 si ya existe |
| `PATCH /users/:id` | `users:manage` | `ADMIN` | Edita datos, habilita o deshabilita |
| `PUT /users/:id/role` | `users:manage` | `ADMIN` | Aprueba una cuenta registrada o cambia su rol, y cierra sus sesiones |
| `PUT /users/:id/password` | `users:manage` | `ADMIN` | Restablece la contraseña (204) |
| `PUT /users/me/password` | token válido | cualquiera | Cambia la contraseña propia verificando la actual (204) |
| `GET /health` | público | | Estado de la base de datos y del dataset |

Parámetros de `POST /routes`, todos opcionales:

| Campo | Defecto | Regla |
| --- | --- | --- |
| `strategy` | `VULNERABILITY_WEIGHTED` | `VULNERABILITY_WEIGHTED` o `NEAREST_NEIGHBOR` |
| `visitCount` | 5 | Entero entre 1 y el número de veredas disponibles tras las exclusiones |
| `alpha` | 0.6 | Entre 0 y 1 |
| `returnToBase` | `true` | Booleano |
| `excludedVeredaIds` | `[]` | Ids existentes, sin repetir |

## Desarrollo local y pruebas

```bash
npm ci
```

```bash
cp .env.example .env
```

```bash
docker compose up -d postgres keycloak
```

```bash
npm run db:migrate
```

```bash
npm run start:dev
```

Pruebas:

```bash
npm test
```

```bash
npm run test:cov
```

```bash
npm run test:e2e
```

Las pruebas E2E no dependen de Keycloak. `test/utils/jwks-test.util.ts` genera en memoria un par de claves RSA y firma los tokens de prueba, y `test/utils/fake-keycloak.util.ts` levanta un Keycloak local mínimo (JWKS, endpoint de tokens, logout y la parte de la Admin API que usa el módulo `users`), con usuarios por rol y scopes filtrados por rol como en el realm real. Sí necesitan PostgreSQL: la suite recrea la base `rural_routes_e2e` (variable `TEST_URL_DB`, por defecto en `localhost:5433`), aplica las migraciones con `run-sql.js` y ejecuta los casos contra la aplicación completa.

**Resultados obtenidos (4 de noviembre de 2026):**

- Unitarias: 12 suites y 110 pruebas en verde.
- E2E: 1 suite y 79 pruebas en verde: 201, 400, 401, 403, 404, 409; aislamiento de `audit:read`; `/verify`; triggers append-only; rollback transaccional; cadena de hashes; registro público pendiente de aprobación y su aprobación por un ADMIN; inicio de sesión, refresh con rotación y logout; matriz de acceso por rol; exigencia simultánea de rol y scope; validación humana con segregación de funciones; y gestión de usuarios.
- Verificación manual contra el Keycloak real del `docker compose` con los usuarios de demostración: registro, bloqueo hasta la aprobación y aprobación por un ADMIN; inicio de sesión por rol, scopes filtrados por rol, matriz 403/200, validación, auditoría con usuario y rol del actor, creación, cambio de rol, restablecimiento y deshabilitación de cuentas, refresh y logout.
- Cobertura con umbral obligatorio del 90 % en `jest.coverageThreshold`:

  | Ruta | Sentencias | Ramas | Funciones | Líneas |
  | --- | --- | --- | --- | --- |
  | `src/common/utils` | 100 % | 100 % | 100 % | 100 % |
  | `src/route_engine` | 100 % | 98.07 % | 100 % | 100 % |
  | `src/route_engine/strategies` | 100 % | 93.93 % | 100 % | 100 % |

La cobertura global de las pruebas unitarias es menor (41 %) porque controladores, guards y servicios con base de datos se prueban en la suite E2E, que no mide cobertura.

Otros comandos: `npm run lint`, `npm run typecheck`, `npm run build`.

## Configuración

| Variable | Defecto | Descripción |
| --- | --- | --- |
| `URL_DB` | obligatoria | Cadena de conexión a PostgreSQL |
| `PORT` | 3000 | Puerto HTTP |
| `ROAD_FACTOR` | 1.3 | Factor sobre Haversine (1 a 2.5) |
| `VEREDAS_DATA_PATH` | `data/veredas.json` | Dataset validado al arrancar. Si es inválido, la API no inicia |
| `OAUTH_ISSUER` | obligatoria | `iss` esperado |
| `OAUTH_AUDIENCE` | `rural-routes-api` | `aud` esperado |
| `OAUTH_JWKS_URI` | obligatoria | URL del JWKS |
| `OAUTH_TOKEN_URL` | `<issuer>/protocol/openid-connect/token` | URL pública del endpoint de tokens, usada por Swagger |
| `OAUTH_AUTHORIZATION_URL` | `<issuer>/protocol/openid-connect/auth` | URL pública de autorización, usada por Swagger (PKCE) |
| `KEYCLOAK_BASE_URL` | origen de `OAUTH_ISSUER` | URL de Keycloak accesible desde la API (en Docker, `http://keycloak:8080`) |
| `KEYCLOAK_REALM` | se toma de `OAUTH_ISSUER` | Realm |
| `KEYCLOAK_TIMEOUT_MS` | 5000 | Tiempo máximo de cada llamada a Keycloak |
| `LOGIN_CLIENT_ID` | `rural-routes-web` | Cliente público para `/auth/login` |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | `rural-routes-admin-api`, vacío | Cuenta de servicio para la Admin API. Sin secreto, `/users` responde 503 |
| `CORS_ORIGINS` | vacío (CORS deshabilitado) | Orígenes separados por comas |
| `RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX` | 60000, 100 | Ventana y límite general por IP |
| `LOGIN_RATE_LIMIT_MAX` | 10 | Límite por IP y ventana para `/auth/register`, `/auth/login`, `/auth/refresh` y `/auth/logout` |
| `SELF_REGISTRATION_ENABLED` | `true` | `false` desactiva `POST /auth/register` |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent` |
| `SWAGGER_ENABLED` | `true` | Publica `/docs` |
| `TEST_URL_DB` | `postgres://rural:rural_demo_password@localhost:5433/rural_routes_e2e` | Base desechable para E2E |

En Docker, la API valida el `iss` contra `http://localhost:8080/realms/rural-health`, que Keycloak emite gracias a `KC_HOSTNAME`, y descarga el JWKS, pide tokens y usa la Admin API por la red interna (`http://keycloak:8080/...`).

## Estructura y decisiones

La estructura sigue el árbol solicitado y la organización del repositorio de referencia: módulos planos en `src/`, carpetas en snake_case, archivos en kebab-case y pruebas unitarias junto al archivo que prueban. Además del árbol hay estos archivos pequeños, todos dentro de carpetas existentes:

| Archivo | Motivo |
| --- | --- |
| `src/app.config.ts` | Validación tipada de variables de entorno |
| `src/app.setup.ts` | Prefijo, helmet, CORS, `ValidationPipe` y Swagger, compartidos por `main.ts` y las pruebas E2E |
| `src/auth/authenticated-user.ts` | Tipo del actor, enums de scopes y roles, y lectura de claims |
| `src/auth/role-permissions.ts` | Catálogo de roles: función, scopes y permisos |
| `src/auth/keycloak-http.ts` | Llamadas HTTP a Keycloak con tiempo máximo y manejo de errores |
| `src/auth/auth.controller.ts`, `auth.service.ts`, `dto/` | Registro, inicio de sesión, refresh, logout, perfil y catálogo de roles |
| `src/auth/keycloak-admin.service.ts` | Cliente de la Admin API de Keycloak, compartido por el registro y el módulo `users` |
| `src/auth/account-rules.ts` | Reglas de nombre de usuario y contraseña, comunes al registro y al alta por ADMIN |
| `src/auth/decorators/roles.decorator.ts`, `credential-endpoint.decorator.ts`, `guard/roles.guard.ts` | `@Roles()`, límite estricto para endpoints de credenciales y guard de roles |
| `src/users/` | Módulo de gestión de usuarios, como en el repositorio de referencia |
| `src/routes/entities/route-review.entity.ts`, `dto/review-route.dto.ts`, `dto/filter-route.dto.ts` | Validación humana y listado de rutas |
| `database/migrations/004_add_actor_identity.sql`, `005_create_route_reviews.sql` | Usuario y roles del actor; tabla append-only de validaciones |
| `test/utils/fake-keycloak.util.ts` | Keycloak local para las pruebas E2E |
| `src/audit/audit-writer.service.ts` | Escritura encadenada de la auditoría (transacción de la ruta e intentos fallidos) |
| `src/routes/route-attempt.middleware.ts` | Marca los intentos de `POST /routes` para medir su duración y auditar 400 y 403 |
| `src/route_engine/strategies/greedy-selection.ts` | Bucle voraz y desempates compartidos por ambas estrategias |
| `src/common/filters/failed-attempt-recorder.ts` | Contrato para auditar rechazos sin acoplar `common` con `audit` |
| `src/common/utils/priority-band.util.ts`, `correlation-id.util.ts` | Bandas de prioridad y correlationId |
| `src/common/utils/hash.util.spec.ts`, `pagination.util.spec.ts` | Pruebas de las utilidades |
| `.dockerignore`, `package-lock.json` | Build reproducible con `npm ci` y contexto de Docker reducido |

El código, las migraciones, el Dockerfile, el compose, `.env.example` y `requests.http` no contienen comentarios. La documentación está en este README y en las descripciones de Swagger.

**Limitaciones conocidas.** La distancia por vía es una aproximación (Haversine × factor) y no considera el estado real de las vías. Las estrategias son voraces y no garantizan la ruta óptima. Keycloak corre en modo `start-dev` con almacenamiento local, adecuado solo para la demostración: los usuarios creados desde la API se pierden al recrear su contenedor. `/auth/login` usa el Direct Access Grant para facilitar la demostración; en producción conviene que los clientes usen Authorization Code + PKCE. Un cambio de rol o una deshabilitación se aplica al siguiente token: un access token ya emitido sigue siendo válido hasta que vence (5 minutos).
