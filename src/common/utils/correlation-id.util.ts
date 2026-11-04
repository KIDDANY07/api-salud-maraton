import { randomUUID } from 'node:crypto'

export const CORRELATION_ID_HEADER = 'x-correlation-id'

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{8,100}$/

export function resolveCorrelationId(
  headerValue: string | string[] | undefined,
): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (candidate !== undefined && SAFE_CORRELATION_ID.test(candidate)) {
    return candidate
  }
  return randomUUID()
}

export function correlationIdOf(request: { id?: unknown }): string {
  return typeof request.id === 'string' && request.id.length > 0
    ? request.id
    : resolveCorrelationId(undefined)
}
