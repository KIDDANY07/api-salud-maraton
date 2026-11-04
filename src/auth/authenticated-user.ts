export enum ApiScope {
  ROUTES_READ = 'routes:read',
  ROUTES_WRITE = 'routes:write',
  ROUTES_REVIEW = 'routes:review',
  AUDIT_READ = 'audit:read',
  USERS_MANAGE = 'users:manage',
}

export enum AppRole {
  ADMIN = 'ADMIN',
  COORDINADOR = 'COORDINADOR',
  AUDITOR = 'AUDITOR',
  EQUIPO_SALUD = 'EQUIPO_SALUD',
}

export const APP_ROLES: readonly AppRole[] = Object.values(AppRole)

export const PENDING_APPROVAL_ROLE = 'PENDIENTE_APROBACION'

export interface AuthenticatedUser {
  sub: string | null
  clientId: string | null
  username: string | null
  name: string | null
  email: string | null
  roles: AppRole[]
  scopes: string[]
}

export interface AccessTokenClaims {
  sub?: string
  azp?: string
  client_id?: string
  scope?: string
  scp?: string | string[]
  preferred_username?: string
  name?: string
  email?: string
  realm_access?: { roles?: unknown }
}

function parseScopes(claims: AccessTokenClaims): string[] {
  const raw = claims.scope ?? claims.scp ?? []
  const values = Array.isArray(raw) ? raw : raw.split(' ')
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort()
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.includes(value as AppRole)
}

export function parseAppRoles(raw: unknown): AppRole[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return [...new Set(raw.filter(isAppRole))].sort()
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function toAuthenticatedUser(
  claims: AccessTokenClaims,
): AuthenticatedUser {
  return {
    sub: optionalText(claims.sub),
    clientId: optionalText(claims.client_id) ?? optionalText(claims.azp),
    username: optionalText(claims.preferred_username),
    name: optionalText(claims.name),
    email: optionalText(claims.email),
    roles: parseAppRoles(claims.realm_access?.roles),
    scopes: parseScopes(claims),
  }
}

export function displayNameOf(user: AuthenticatedUser): string | null {
  return user.username ?? user.clientId ?? user.sub
}
