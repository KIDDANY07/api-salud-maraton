import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'

export interface KeycloakEndpoints {
  tokenUrl: string
  logoutUrl: string
  adminBaseUrl: string
  timeoutMs: number
}

export interface KeycloakResponse<T = unknown> {
  status: number
  body: T | null
  headers: Headers
}

export function keycloakEndpointsFrom(
  config: ConfigService,
): KeycloakEndpoints {
  const baseUrl = config.getOrThrow<string>('KEYCLOAK_BASE_URL')
  const realm = encodeURIComponent(config.getOrThrow<string>('KEYCLOAK_REALM'))
  const oidcBase = `${baseUrl}/realms/${realm}/protocol/openid-connect`
  return {
    tokenUrl: `${oidcBase}/token`,
    logoutUrl: `${oidcBase}/logout`,
    adminBaseUrl: `${baseUrl}/admin/realms/${realm}`,
    timeoutMs: config.getOrThrow<number>('KEYCLOAK_TIMEOUT_MS'),
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw: text }
  }
}

export async function keycloakRequest<T = unknown>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<KeycloakResponse<T>> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new ServiceUnavailableException(
      'El servidor de autorización no está disponible',
    )
  }
  return {
    status: response.status,
    body: (await parseBody(response)) as T | null,
    headers: response.headers,
  }
}

export function postForm<T = unknown>(
  url: string,
  form: Record<string, string>,
  timeoutMs: number,
): Promise<KeycloakResponse<T>> {
  return keycloakRequest<T>(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    },
    timeoutMs,
  )
}

export function oauthErrorOf(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    return typeof body.error === 'string' ? body.error : null
  }
  return null
}

export function decodeJwtPayload<T>(token: string): T {
  const [, payload] = token.split('.')
  if (!payload) {
    throw new ServiceUnavailableException(
      'El servidor de autorización devolvió un token con formato inesperado',
    )
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T
}
