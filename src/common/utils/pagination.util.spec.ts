import { correlationIdOf, resolveCorrelationId } from './correlation-id.util'
import {
  buildPage,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  resolvePageWindow,
} from './pagination.util'
import { PriorityBand, priorityBandOf } from './priority-band.util'

describe('pagination.util', () => {
  it('usa valores por defecto cuando no se indican', () => {
    expect(resolvePageWindow()).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    })
  })

  it('calcula skip y limita el tamaño máximo', () => {
    expect(resolvePageWindow(3, 10)).toMatchObject({ skip: 20, take: 10 })
    expect(resolvePageWindow(1, 5000).limit).toBe(MAX_PAGE_SIZE)
  })

  it('descarta valores inválidos', () => {
    expect(resolvePageWindow(0, -4)).toMatchObject({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    })
    expect(resolvePageWindow(Number.NaN, 2.7)).toMatchObject({
      page: 1,
      limit: 2,
    })
  })

  it('construye los metadatos de la página', () => {
    const window = resolvePageWindow(2, 10)
    expect(buildPage(['a'], 21, window).meta).toEqual({
      page: 2,
      limit: 10,
      totalItems: 21,
      totalPages: 3,
      hasNextPage: true,
    })
    expect(buildPage([], 0, resolvePageWindow()).meta).toMatchObject({
      totalPages: 0,
      hasNextPage: false,
    })
  })
})

describe('priority-band.util', () => {
  it.each([
    [100, PriorityBand.ALTA],
    [70, PriorityBand.ALTA],
    [69.9, PriorityBand.MEDIA],
    [40, PriorityBand.MEDIA],
    [39, PriorityBand.BAJA],
    [0, PriorityBand.BAJA],
  ])('clasifica el índice %d como %s', (index, band) => {
    expect(priorityBandOf(index)).toBe(band)
  })
})

describe('correlation-id.util', () => {
  it('conserva un identificador seguro recibido en la cabecera', () => {
    expect(resolveCorrelationId('req-12345678')).toBe('req-12345678')
    expect(resolveCorrelationId(['req-abcdefgh', 'otro'])).toBe('req-abcdefgh')
  })

  it('genera uno nuevo si falta o contiene caracteres no permitidos', () => {
    const uuid = /^[0-9a-f-]{36}$/
    expect(resolveCorrelationId(undefined)).toMatch(uuid)
    expect(resolveCorrelationId('corto')).toMatch(uuid)
    expect(resolveCorrelationId('inyeccion\n{"x":1}')).toMatch(uuid)
  })

  it('obtiene el id de la solicitud o genera uno', () => {
    expect(correlationIdOf({ id: 'abc-12345678' })).toBe('abc-12345678')
    expect(correlationIdOf({ id: 42 })).toMatch(/^[0-9a-f-]{36}$/)
  })
})
