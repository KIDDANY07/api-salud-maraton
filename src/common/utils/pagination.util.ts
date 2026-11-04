export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export interface PageWindow {
  page: number
  limit: number
  skip: number
  take: number
}

export interface PageMeta {
  page: number
  limit: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
}

export interface Page<T> {
  items: T[]
  meta: PageMeta
}

function toPositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }
  const integer = Math.floor(value)
  return integer >= 1 ? integer : fallback
}

export function resolvePageWindow(page?: number, limit?: number): PageWindow {
  const safePage = toPositiveInteger(page, DEFAULT_PAGE)
  const safeLimit = Math.min(
    toPositiveInteger(limit, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  )
  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    take: safeLimit,
  }
}

export function buildPage<T>(
  items: T[],
  totalItems: number,
  window: PageWindow,
): Page<T> {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / window.limit)
  return {
    items,
    meta: {
      page: window.page,
      limit: window.limit,
      totalItems,
      totalPages,
      hasNextPage: window.page < totalPages,
    },
  }
}
