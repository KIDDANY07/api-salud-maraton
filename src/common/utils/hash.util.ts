import { createHash } from 'node:crypto'

export const SHA256_HEX_LENGTH = 64

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function normalizeForCanonicalJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : normalizeForCanonicalJson(item),
    )
  }
  const source = value as Record<string, unknown>
  const sortedEntries = Object.keys(source)
    .filter((key) => source[key] !== undefined)
    .sort()
    .map((key) => [key, normalizeForCanonicalJson(source[key])] as const)
  return Object.fromEntries(sortedEntries)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeForCanonicalJson(value)) ?? 'null'
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}
