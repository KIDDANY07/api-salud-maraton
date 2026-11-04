# Despliegue en Railway

El sistema se despliega como cinco servicios en un mismo proyecto de Railway:

| Servicio (nombre sugerido) | Origen | Configuración |
| --- | --- | --- |
| `Postgres` | Plantilla PostgreSQL de Railway | Base de datos de la API |
| `PostgresKeycloak` | Plantilla PostgreSQL de Railway | Base de datos de Keycloak (separada de la API) |
| `keycloak` | Este repositorio, rama `v2`, Root Directory `/keycloak` | `keycloak/Dockerfile`, `keycloak/railway.json` |
| `api` | Este repositorio, rama `v2`, Root Directory `/` | `Dockerfile`, `railway.json` |
| `web` | Carpeta `client` (repositorio propio o `railway up`) | `client/Dockerfile`, `client/railway.json` |

Las referencias `${{Servicio.VARIABLE}}` de este documento usan esos nombres. Si nombra los servicios de otra forma, ajústelas.

## 1. Crear los servicios y sus dominios

1. Cree el proyecto y agregue dos bases PostgreSQL: `Postgres` y `PostgresKeycloak`.
2. Agregue un servicio desde el repositorio `KIDDANY07/api-salud-maraton` y llámelo `keycloak`. En **Settings**:
   - **Source → Branch**: `v2`.
   - **Root Directory**: `/keycloak`.
   - **Config-as-code → Railway Config File**: `/keycloak/railway.json`. Railway no busca este archivo dentro del Root Directory, por eso la ruta va completa.
3. Agregue otro servicio desde el mismo repositorio y llámelo `api`. En **Settings**:
   - **Branch**: `v2`.
   - **Root Directory**: `/`. Railway toma `railway.json` de la raíz.
4. Agregue el servicio `web` con el cliente (ver la sección 5).
5. En **Settings → Networking** de `keycloak`, `api` y `web`, pulse **Generate Domain** antes del primer despliegue. Las variables de los pasos siguientes usan esos dominios, y Keycloak los necesita la primera vez que importa el realm.

## 2. Variables de `keycloak`

| Variable | Valor |
| --- | --- |
| `KC_DB_URL` | `jdbc:postgresql://${{PostgresKeycloak.PGHOST}}:${{PostgresKeycloak.PGPORT}}/${{PostgresKeycloak.PGDATABASE}}` |
| `KC_DB_USERNAME` | `${{PostgresKeycloak.PGUSER}}` |
| `KC_DB_PASSWORD` | `${{PostgresKeycloak.PGPASSWORD}}` |
| `KC_HOSTNAME` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `KC_BOOTSTRAP_ADMIN_USERNAME` | Usuario de la consola de administración de Keycloak |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | Contraseña fuerte para esa consola |
| `API_PUBLIC_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` |
| `FRONTEND_URL` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Secreto aleatorio largo. Debe ser el mismo en `api` |
| `PLANIFICADOR_CLIENT_SECRET` | Secreto aleatorio para la integración `planificador-app` |
| `AUDITOR_CLIENT_SECRET` | Secreto aleatorio para la integración `auditor-app` |
| `INITIAL_ADMIN_PASSWORD` | Contraseña del administrador inicial `kiddany07` |
| `DEMO_USERS_ENABLED` | `false` en producción: importa deshabilitadas las cuentas demo, cuyas contraseñas son públicas |

La imagen ya fija `KC_HTTP_ENABLED=true`, `KC_PROXY_HEADERS=xforwarded`, PostgreSQL y el modo `start --optimized`. Escucha en `PORT`, que Railway asigna, o en 8080 si no existe. El healthcheck usa `/realms/rural-health/.well-known/openid-configuration`.

`keycloak/realm-export.json` usa marcadores `${VARIABLE:valor_local}`. Keycloak los resuelve con las variables anteriores al importar el realm, y en `docker compose` local se usan los valores por defecto. **El realm se importa solo la primera vez**, cuando la base de Keycloak está vacía. Después, los cambios de URLs o secretos se hacen en la consola de Keycloak (`https://<dominio-keycloak>/admin`) o vaciando `PostgresKeycloak` para que se vuelva a importar.

## 3. Variables de `api`

| Variable | Valor |
| --- | --- |
| `URL_DB` | `${{Postgres.DATABASE_URL}}` |
| `OAUTH_ISSUER` | `https://${{keycloak.RAILWAY_PUBLIC_DOMAIN}}/realms/rural-health` |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | El mismo valor configurado en `keycloak` |
| `CORS_ORIGINS` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `TRUST_PROXY` | `1` |
| `NODE_ENV` | `production` |

Opcionales: `ROAD_FACTOR`, `RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX`, `SELF_REGISTRATION_ENABLED`, `SWAGGER_ENABLED` y `LOG_LEVEL`.

A partir de `OAUTH_ISSUER` la API deriva el JWKS, los endpoints de token y autorización, la URL base de Keycloak y el realm. Solo hace falta definirlos por separado si Keycloak está en otra ubicación.

`TRUST_PROXY=1` es necesario en Railway. Las peticiones llegan a través de su proxy y, sin esta variable, el rate limit trataría a todos los usuarios como una sola IP.

El contenedor ejecuta `npm run db:migrate` antes de iniciar, así que las migraciones se aplican solas en cada despliegue y solo una vez. El healthcheck usa `/api/v1/health`.

## 4. Orden del primer despliegue

1. `Postgres` y `PostgresKeycloak`.
2. `keycloak`. Espere a que el healthcheck pase, normalmente entre uno y dos minutos.
3. `api`.
4. `web`.

Compruebe:

- `https://<dominio-api>/api/v1/health` responde `{"status":"ok", …}`.
- `https://<dominio-api>/docs` abre Swagger. Con **Authorize → password**, use `client_id` `rural-routes-web` e inicie sesión.
- `https://<dominio-web>` permite iniciar sesión con `kiddany07` y la contraseña de `INITIAL_ADMIN_PASSWORD`.

## 5. Frontend (`web`)

El cliente está en `../client`, fuera de este repositorio. Hay dos opciones para desplegarlo:

- Subirlo a un repositorio propio y crear el servicio `web` desde él, con Root Directory `/`.
- Desplegarlo con la CLI desde esa carpeta: `railway link` y luego `railway up --service web`.

Variable de `web`:

| Variable | Valor |
| --- | --- |
| `VITE_API_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}/api/v1` |

`VITE_API_URL` se incorpora al compilar: Railway la pasa como build argument porque el Dockerfile la declara con `ARG`. Si cambia el dominio de la API, vuelva a desplegar `web`. nginx sirve la aplicación en `PORT`, con fallback a `index.html` para las rutas internas, y el healthcheck usa `/healthz`.

## Seguridad antes de publicar

- `keycloak/realm-export.json` está en el repositorio con las contraseñas demo y el valor por defecto de `INITIAL_ADMIN_PASSWORD`. Defina `INITIAL_ADMIN_PASSWORD` y `DEMO_USERS_ENABLED=false` en Railway, y cambie la contraseña de `kiddany07` desde **Mi perfil** después del primer inicio de sesión.
- Use secretos nuevos para `KEYCLOAK_ADMIN_CLIENT_SECRET`, `PLANIFICADOR_CLIENT_SECRET` y `AUDITOR_CLIENT_SECRET`. Los valores por defecto del realm son de demostración.
- Si no quiere registro público, defina `SELF_REGISTRATION_ENABLED=false` en `api`.
