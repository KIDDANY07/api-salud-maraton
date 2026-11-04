# Priorización de visitas domiciliarias rurales (Cundinamarca)

Microservicio NestJS que sugiere el orden en que un equipo de salud visita veredas rurales durante una jornada. Combina el índice de vulnerabilidad de cada vereda con la distancia por vía aproximada, compara la ruta con una estrategia de vecino más cercano y deja un registro de auditoría verificable de cada intento.

> **Advertencia.** Es una demostración de arquitectura y lógica de priorización. Usa **datos simulados** (`"simulated": true`), sin datos personales ni clínicos, y con nombres ficticios del tipo "Vereda Simulada 01". El resultado es una **sugerencia que requiere revisión y validación humana** y no reemplaza el criterio del equipo de salud.

## Contenido

1. [Arquitectura](#arquitectura)
2. [Algoritmo](#algoritmo)
3. [Seguridad](#seguridad)
4. [Auditoría](#auditoría)
5. [Ejecución con Docker](#ejecución-con-docker)
6. [Obtención de tokens](#obtención-de-tokens)
7. [Ejemplos de uso](#ejemplos-de-uso)
8. [Desarrollo local y pruebas](#desarrollo-local-y-pruebas)
9. [Configuración](#configuración)
10. [Estructura y decisiones](#estructura-y-decisiones)

## Arquitectura

```
                    ┌────────────────────────────┐
  Cliente OAuth ───►│ Keycloak (realm rural-health)│  Client Credentials
                    └─────────────┬──────────────┘
                                  │ JWT RS256 (iss, aud, exp, scope)
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ API NestJS  /api/v1                                                  │
│  ThrottlerGuard → JwtAuthGuard (JWKS) → ScopesGuard → ValidationPipe │
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
| `routes` | `POST /routes` y `GET /routes/:id`. Guarda la ruta y su auditoría en la misma transacción. Importa `route_engine`, `veredas` y `audit`. |
| `audit` | Escritura append-only con cadena de hashes, consulta paginada, detalle y verificación. Importa `route_engine` y `veredas`, **nunca** `routes`. |
| `veredas` | Carga y valida `data/veredas.json` al arrancar, calcula su SHA-256 y expone el catálogo público con `priorityBand`. |
| `auth` | Estrategia `passport-jwt` + `jwks-rsa`, guards globales y decoradores `@Public()`, `@Scopes()`, `@GetUser()`. |
| `common` | Utilidades (Haversine, hashes canónicos, paginación, bandas de prioridad, correlationId), DTOs comunes y filtro global de excepciones. |
| `health` | `GET /health` público: estado de la base de datos y del dataset. |

Para agregar una estrategia nueva basta con implementar `RouteStrategy` (`src/route_engine/strategies/route-strategy.interface.ts`), registrarla en `RouteEngineModule` y añadir su nombre al enum `RouteStrategyName`. El controlador no cambia.

## Algoritmo

**Distancia.** `geo.util.ts` calcula la distancia de Haversine (radio medio terrestre 6371.0088 km) y la multiplica por `ROAD_FACTOR` (1.3 por defecto, configurable entre 1 y 2.5) para aproximar la distancia por vía. Cada distancia se redondea a 3 decimales (metros) antes de compararse.

**VULNERABILITY_WEIGHTED (voraz).** Desde la base, en cada paso y para cada candidata restante:

```
score = alpha * (vulnerabilityIndex / 100) + (1 - alpha) * (1 - d / dMax)
```

`d` es la distancia desde la posición actual y `dMax` la mayor distancia entre las candidatas de ese paso; si `dMax = 0`, se usa `d / dMax = 0`. Se visita la de mayor score (redondeado a 6 decimales) hasta completar `visitCount`. Si `returnToBase` es `true`, se suma el tramo de regreso.

**NEAREST_NEIGHBOR.** En cada paso visita la vereda más cercana. Siempre se ejecuta como comparación y su resultado aparece en `comparison`.

**Determinismo.** El orden de entrada no influye: las candidatas se ordenan por id y el comparador es total. Desempate: mayor vulnerabilidad y luego id ascendente. Con `alpha = 0`, el orden coincide con NEAREST_NEIGHBOR; con `alpha = 1`, se ordena por vulnerabilidad descendente. Las pruebas cubren ambos casos.

**Bandas de prioridad.** `ALTA` ≥ 70, `MEDIA` 40–69, `BAJA` < 40. Las respuestas para `routes:read` y `routes:write` solo muestran la banda. El índice numérico y el desglose del score solo se ven con `audit:read`.

## Seguridad

- **Resource Server OAuth 2.0.** Valida los JWT con las claves publicadas en el JWKS de Keycloak: firma RS256, `iss`, `aud` (`rural-routes-api`) y `exp`.
- **Guards globales**: `ThrottlerGuard` → `JwtAuthGuard` → `ScopesGuard`. Todo endpoint exige token, salvo los marcados con `@Public()` (solo `/health`).
- **Respuestas**: `401` si el token falta o es inválido (firma, emisor, audiencia o expiración); `403` si falta un scope.
- **Clientes del realm** (`keycloak/realm-export.json`, importado automáticamente):

  | Cliente | Secreto de demostración | Scopes |
  | --- | --- | --- |
  | `planificador-app` | `planificador-demo-secret` | `routes:read`, `routes:write` |
  | `auditor-app` | `auditor-demo-secret` | `routes:read`, `audit:read` |

  Cada cliente incluye mappers de audiencia (`rural-routes-api`), `sub` y `client_id`.
- **Defensa adicional**: `helmet`, rate limiting configurable, CORS por lista de orígenes y `ValidationPipe` con `whitelist`, `forbidNonWhitelisted` y `transform`.
- **Logs JSON** (`nestjs-pino`) con `correlationId` (cabecera `X-Correlation-Id` si es segura; si no, un UUID nuevo). No se registran cabeceras: `authorization` y `cookie` se eliminan.
- **Secretos**: el repositorio solo tiene valores de demostración. Cámbielos fuera de un entorno local.

## Auditoría

Cada intento de `POST /routes` genera un registro en `route_audit_logs`:

| Campo | Contenido |
| --- | --- |
| `id`, `occurred_at`, `correlation_id` | Identificación del intento |
| `actor_sub`, `actor_client_id`, `scopes` | Actor según el token |
| `received_parameters`, `applied_parameters` | Cuerpo recibido y parámetros finales con valores por defecto |
| `algorithm_version`, `dataset_version`, `dataset_hash` | Versión del algoritmo y del dataset, y SHA-256 del archivo |
| `result`, `score_breakdown` | Resultado completo y desglose por paso con todas las candidatas, índices y componentes del score |
| `status`, `error_details`, `duration_ms` | `SUCCESS`, `VALIDATION_ERROR` o `FORBIDDEN` |
| `previous_hash`, `record_hash` | Cadena de integridad SHA-256 sobre JSON canónico |

- La ruta y su auditoría se escriben en **una sola transacción**. Si falla la auditoría, la ruta no se guarda y la API responde 500 (hay una prueba E2E para esto).
- La cadena se serializa con `pg_advisory_xact_lock`, así que cada `previous_hash` apunta al registro anterior aunque haya solicitudes concurrentes.
- `003_block_audit_changes.sql` crea triggers que impiden `UPDATE`, `DELETE` y también `TRUNCATE`.
- Los rechazos `400` y `403` de `POST /routes` se auditan desde el filtro global de excepciones. Los `401` no se auditan porque no hay actor autenticado.
- `POST /audit/routes/:id/verify` recalcula la ruta con los parámetros guardados, incluido el `roadFactor`, y la compara sección por sección. Informa `matches`, `differences`, si cambió la versión o el hash del dataset o la versión del algoritmo, y la integridad del registro (`recordHashValid`, `previousHashValid`). En `/audit/routes/:id`, el `:id` acepta el id de auditoría o el `routeId`.

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

Para detener y borrar los datos de demostración:

```bash
docker compose down -v
```

## Obtención de tokens

```bash
curl -s -X POST http://localhost:8080/realms/rural-health/protocol/openid-connect/token -d grant_type=client_credentials -d client_id=planificador-app -d client_secret=planificador-demo-secret
```

```bash
curl -s -X POST http://localhost:8080/realms/rural-health/protocol/openid-connect/token -d grant_type=client_credentials -d client_id=auditor-app -d client_secret=auditor-demo-secret
```

El campo `access_token` de la respuesta se envía como `Authorization: Bearer <token>`. Los tokens duran 5 minutos.

En Swagger (`/docs`), pulse **Authorize**, elija `oauth2` (Client Credentials), escriba el `client_id` y el `client_secret` y marque los scopes. También puede pegar un token en `bearer`.

`requests.http` tiene una colección de solicitudes para VS Code REST Client o el cliente HTTP de JetBrains. Ejecute las dos primeras solicitudes, copie los tokens en `@plannerToken` y `@auditorToken`, y el `routeId` generado en `@routeId`.

## Ejemplos de uso

Generar una ruta, excluyendo una vereda con la vía cerrada:

```bash
curl -s -X POST http://localhost:3000/api/v1/routes -H "Authorization: Bearer $PLANNER_TOKEN" -H "Content-Type: application/json" -H "X-Correlation-Id: demo-jornada-0001" -d '{"excludedVeredaIds":["VS-04"]}'
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
  "disclaimer": "Sugerencia generada automáticamente con datos simulados (dataset 2026.11-sim.1). No reemplaza el criterio del equipo de salud: requiere revisión y validación humana antes de programar la jornada."
}
```

Otros endpoints (prefijo `/api/v1`):

| Método y ruta | Scope | Descripción |
| --- | --- | --- |
| `POST /routes` | `routes:write` | Genera una ruta (201), 400 si los parámetros son inválidos |
| `GET /routes/:id` | `routes:read` | Ruta guardada |
| `GET /veredas` | `routes:read` | Catálogo con `priorityBand`, sin el índice numérico |
| `GET /audit/routes?from&to&actor&status&page&limit` | `audit:read` | Lista paginada de intentos |
| `GET /audit/routes/:id` | `audit:read` | Detalle con el desglose completo e integridad |
| `POST /audit/routes/:id/verify` | `audit:read` | Recalcula y compara (200), 409 si el intento no fue exitoso |
| `GET /health` | público | Estado de la base de datos y del dataset |

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

Las pruebas E2E no dependen de Keycloak: `test/utils/jwks-test.util.ts` levanta un JWKS local con un par de claves RSA generado en memoria y firma los tokens de prueba. Sí necesitan PostgreSQL: la suite recrea la base `rural_routes_e2e` (variable `TEST_URL_DB`, por defecto en `localhost:5433`), aplica las migraciones con `run-sql.js` y ejecuta los casos contra la aplicación completa.

**Resultados obtenidos (4 de noviembre de 2026):**

- Unitarias: 8 suites y 84 pruebas en verde.
- E2E: 1 suite y 32 pruebas en verde (201, 400, 401, 403, 404, 409, aislamiento de `audit:read`, `/verify`, triggers append-only, rollback transaccional y cadena de hashes).
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
| `OAUTH_TOKEN_URL` | `<issuer>/protocol/openid-connect/token` | Usada por Swagger |
| `CORS_ORIGINS` | vacío (CORS deshabilitado) | Orígenes separados por comas |
| `RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX` | 60000, 100 | Ventana y límite por IP |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent` |
| `SWAGGER_ENABLED` | `true` | Publica `/docs` |
| `TEST_URL_DB` | `postgres://rural:rural_demo_password@localhost:5433/rural_routes_e2e` | Base desechable para E2E |

En Docker, la API valida el `iss` contra `http://localhost:8080/realms/rural-health`, que Keycloak emite gracias a `KC_HOSTNAME`, y descarga el JWKS por la red interna (`http://keycloak:8080/...`).

## Estructura y decisiones

La estructura sigue el árbol solicitado y la organización del repositorio de referencia: módulos planos en `src/`, carpetas en snake_case, archivos en kebab-case y pruebas unitarias junto al archivo que prueban. Además del árbol hay estos archivos pequeños, todos dentro de carpetas existentes:

| Archivo | Motivo |
| --- | --- |
| `src/app.config.ts` | Validación tipada de variables de entorno |
| `src/app.setup.ts` | Prefijo, helmet, CORS, `ValidationPipe` y Swagger, compartidos por `main.ts` y las pruebas E2E |
| `src/auth/authenticated-user.ts` | Tipo del actor, enum de scopes y lectura de claims |
| `src/audit/audit-writer.service.ts` | Escritura encadenada de la auditoría (transacción de la ruta e intentos fallidos) |
| `src/routes/route-attempt.middleware.ts` | Marca los intentos de `POST /routes` para medir su duración y auditar 400 y 403 |
| `src/route_engine/strategies/greedy-selection.ts` | Bucle voraz y desempates compartidos por ambas estrategias |
| `src/common/filters/failed-attempt-recorder.ts` | Contrato para auditar rechazos sin acoplar `common` con `audit` |
| `src/common/utils/priority-band.util.ts`, `correlation-id.util.ts` | Bandas de prioridad y correlationId |
| `src/common/utils/hash.util.spec.ts`, `pagination.util.spec.ts` | Pruebas de las utilidades |
| `.dockerignore`, `package-lock.json` | Build reproducible con `npm ci` y contexto de Docker reducido |

El código, las migraciones, el Dockerfile, el compose, `.env.example` y `requests.http` no contienen comentarios. La documentación está en este README y en las descripciones de Swagger.

**Limitaciones conocidas.** La distancia por vía es una aproximación (Haversine × factor) y no considera el estado real de las vías. Las estrategias son voraces y no garantizan la ruta óptima. Keycloak corre en modo `start-dev` con almacenamiento local, adecuado solo para la demostración.
