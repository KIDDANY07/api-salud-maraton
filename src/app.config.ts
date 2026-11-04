import {
  MAX_ROAD_FACTOR,
  MIN_ROAD_FACTOR,
} from './route_engine/route-calculator.service'

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

export interface AppEnvironment {
  NODE_ENV: string
  PORT: number
  URL_DB: string
  ROAD_FACTOR: number
  VEREDAS_DATA_PATH: string
  OAUTH_ISSUER: string
  OAUTH_AUDIENCE: string
  OAUTH_JWKS_URI: string
  OAUTH_TOKEN_URL: string
  OAUTH_AUTHORIZATION_URL: string
  KEYCLOAK_BASE_URL: string
  KEYCLOAK_REALM: string
  LOGIN_CLIENT_ID: string
  KEYCLOAK_ADMIN_CLIENT_ID: string
  KEYCLOAK_ADMIN_CLIENT_SECRET: string
  KEYCLOAK_TIMEOUT_MS: number
  CORS_ORIGINS: string[]
  RATE_LIMIT_TTL_MS: number
  RATE_LIMIT_MAX: number
  LOGIN_RATE_LIMIT_MAX: number
  SELF_REGISTRATION_ENABLED: boolean
  LOG_LEVEL: LogLevel
  SWAGGER_ENABLED: boolean
}

type RawEnvironment = Record<string, unknown>

function readString(
  env: RawEnvironment,
  key: string,
  errors: string[],
  fallback?: string,
): string {
  const value = env[key]
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (fallback !== undefined) {
    return fallback
  }
  errors.push(`${key} es obligatoria`)
  return ''
}

function readNumber(
  env: RawEnvironment,
  key: string,
  errors: string[],
  fallback: number,
  range: { min: number; max: number; integer?: boolean },
): number {
  const raw = env[key]
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim())
        : fallback
  const outOfRange =
    !Number.isFinite(value) ||
    value < range.min ||
    value > range.max ||
    (range.integer === true && !Number.isInteger(value))
  if (outOfRange) {
    errors.push(`${key} debe ser un número entre ${range.min} y ${range.max}`)
  }
  return value
}

function readUrl(
  env: RawEnvironment,
  key: string,
  errors: string[],
  fallback?: string,
): string {
  const value = readString(env, key, errors, fallback)
  if (value.length > 0 && !URL.canParse(value)) {
    errors.push(`${key} debe ser una URL válida`)
  }
  return value
}

function originOf(url: string): string | undefined {
  return URL.canParse(url) ? new URL(url).origin : undefined
}

function realmOf(issuer: string): string | undefined {
  if (!URL.canParse(issuer)) {
    return undefined
  }
  const match = /\/realms\/([^/]+)\/?$/.exec(new URL(issuer).pathname)
  return match ? decodeURIComponent(match[1]) : undefined
}

export function validateEnvironment(env: RawEnvironment): AppEnvironment {
  const errors: string[] = []
  const issuer = readUrl(env, 'OAUTH_ISSUER', errors)
  const logLevel = readString(env, 'LOG_LEVEL', errors, 'info') as LogLevel
  if (!LOG_LEVELS.includes(logLevel)) {
    errors.push(`LOG_LEVEL debe ser uno de: ${LOG_LEVELS.join(', ')}`)
  }
  const corsOrigins = readString(env, 'CORS_ORIGINS', errors, '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  const config: AppEnvironment = {
    NODE_ENV: readString(env, 'NODE_ENV', errors, 'development'),
    PORT: readNumber(env, 'PORT', errors, 3000, {
      min: 1,
      max: 65535,
      integer: true,
    }),
    URL_DB: readUrl(env, 'URL_DB', errors),
    ROAD_FACTOR: readNumber(env, 'ROAD_FACTOR', errors, 1.3, {
      min: MIN_ROAD_FACTOR,
      max: MAX_ROAD_FACTOR,
    }),
    VEREDAS_DATA_PATH: readString(
      env,
      'VEREDAS_DATA_PATH',
      errors,
      'data/veredas.json',
    ),
    OAUTH_ISSUER: issuer,
    OAUTH_AUDIENCE: readString(
      env,
      'OAUTH_AUDIENCE',
      errors,
      'rural-routes-api',
    ),
    OAUTH_JWKS_URI: readUrl(env, 'OAUTH_JWKS_URI', errors),
    OAUTH_TOKEN_URL: readUrl(
      env,
      'OAUTH_TOKEN_URL',
      errors,
      `${issuer}/protocol/openid-connect/token`,
    ),
    OAUTH_AUTHORIZATION_URL: readUrl(
      env,
      'OAUTH_AUTHORIZATION_URL',
      errors,
      `${issuer}/protocol/openid-connect/auth`,
    ),
    KEYCLOAK_BASE_URL: readUrl(
      env,
      'KEYCLOAK_BASE_URL',
      errors,
      originOf(issuer),
    ).replace(/\/+$/, ''),
    KEYCLOAK_REALM: readString(env, 'KEYCLOAK_REALM', errors, realmOf(issuer)),
    LOGIN_CLIENT_ID: readString(
      env,
      'LOGIN_CLIENT_ID',
      errors,
      'rural-routes-web',
    ),
    KEYCLOAK_ADMIN_CLIENT_ID: readString(
      env,
      'KEYCLOAK_ADMIN_CLIENT_ID',
      errors,
      'rural-routes-admin-api',
    ),
    KEYCLOAK_ADMIN_CLIENT_SECRET: readString(
      env,
      'KEYCLOAK_ADMIN_CLIENT_SECRET',
      errors,
      '',
    ),
    KEYCLOAK_TIMEOUT_MS: readNumber(env, 'KEYCLOAK_TIMEOUT_MS', errors, 5000, {
      min: 500,
      max: 60000,
      integer: true,
    }),
    CORS_ORIGINS: corsOrigins,
    RATE_LIMIT_TTL_MS: readNumber(env, 'RATE_LIMIT_TTL_MS', errors, 60000, {
      min: 1000,
      max: 3600000,
      integer: true,
    }),
    RATE_LIMIT_MAX: readNumber(env, 'RATE_LIMIT_MAX', errors, 100, {
      min: 1,
      max: 100000,
      integer: true,
    }),
    LOGIN_RATE_LIMIT_MAX: readNumber(env, 'LOGIN_RATE_LIMIT_MAX', errors, 10, {
      min: 1,
      max: 100000,
      integer: true,
    }),
    LOG_LEVEL: logLevel,
    SELF_REGISTRATION_ENABLED:
      readString(
        env,
        'SELF_REGISTRATION_ENABLED',
        errors,
        'true',
      ).toLowerCase() !== 'false',
    SWAGGER_ENABLED:
      readString(env, 'SWAGGER_ENABLED', errors, 'true').toLowerCase() !==
      'false',
  }
  if (errors.length > 0) {
    throw new Error(`Configuración inválida: ${errors.join('; ')}`)
  }
  return config
}
