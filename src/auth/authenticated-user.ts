export enum ApiScope {
  ROUTES_READ = 'routes:read',
  ROUTES_WRITE = 'routes:write',
  AUDIT_READ = 'audit:read',
}

export interface AuthenticatedUser {
  sub: string | null
  clientId: string | null
  scopes: string[]
}

export interface AccessTokenClaims {
  sub?: string
  azp?: string
  client_id?: string
  scope?: string
  scp?: string | string[]
}

function parseScopes(claims: AccessTokenClaims): string[] {
  const raw = claims.scope ?? claims.scp ?? []
  const values = Array.isArray(raw) ? raw : raw.split(' ')
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort()
}

export function toAuthenticatedUser(
  claims: AccessTokenClaims,
): AuthenticatedUser {
  return {
    sub: typeof claims.sub === 'string' ? claims.sub : null,
    clientId: claims.client_id ?? claims.azp ?? null,
    scopes: parseScopes(claims),
  }
}
