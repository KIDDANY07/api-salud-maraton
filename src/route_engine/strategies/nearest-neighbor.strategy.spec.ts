import type { GeoPoint } from '../../common/utils/geo.util'
import {
  compareIdsAscending,
  formatWeight,
  joinNames,
} from './greedy-selection'
import { NearestNeighborStrategy } from './nearest-neighbor.strategy'
import {
  RouteStrategyName,
  type RouteCandidate,
  type StrategyContext,
} from './route-strategy.interface'

const manhattan = (from: GeoPoint, to: GeoPoint) =>
  Math.abs(from.lat - to.lat) + Math.abs(from.lng - to.lng)

const base = { id: 'BASE', nombre: 'Base de prueba', lat: 0, lng: 0 }

const candidate = (
  id: string,
  lng: number,
  vulnerabilityIndex: number,
  lat = 0,
): RouteCandidate => ({
  id,
  nombre: `Vereda ${id}`,
  provincia: 'Prueba',
  lat,
  lng,
  vulnerabilityIndex,
})

const contextWith = (
  candidates: RouteCandidate[],
  visitCount = candidates.length,
): StrategyContext => ({
  base,
  candidates,
  visitCount,
  alpha: 0.6,
  distanceKm: manhattan,
})

describe('NearestNeighborStrategy', () => {
  const strategy = new NearestNeighborStrategy()
  const line = [
    candidate('A1', 1, 10),
    candidate('A2', 3, 90),
    candidate('A3', 5, 50),
    candidate('A4', -5, 70),
  ]

  it('se identifica como NEAREST_NEIGHBOR y describe su criterio', () => {
    expect(strategy.name).toBe(RouteStrategyName.NEAREST_NEIGHBOR)
    expect(strategy.description).toContain('más cercana')
    expect(strategy.formula).toContain('menor distancia')
  })

  it('elige en cada paso la vereda más cercana a la posición actual', () => {
    const result = strategy.select(contextWith(line))
    expect(result.strategy).toBe(RouteStrategyName.NEAREST_NEIGHBOR)
    expect(result.orderedVeredaIds).toEqual(['A1', 'A2', 'A3', 'A4'])
    expect(result.steps.map((step) => step.legKm)).toEqual([1, 2, 2, 10])
    expect(result.steps[0].reason).toBe(
      'Es la vereda más cercana a Base de prueba entre 4 candidatas (1.0 km). Prioridad BAJA.',
    )
    expect(result.steps[3].reason).toContain('Única vereda candidata restante')
  })

  it('se detiene al completar visitCount', () => {
    const result = strategy.select(contextWith(line, 2))
    expect(result.orderedVeredaIds).toEqual(['A1', 'A2'])
    expect(result.steps[1].fromId).toBe('A1')
    expect(result.steps[1].candidates).toHaveLength(3)
  })

  it('no genera score para esta estrategia', () => {
    const [first] = strategy.select(contextWith(line, 1)).steps
    expect(first.candidates.every((item) => item.score === null)).toBe(true)
    expect(first.candidates.every((item) => item.components === null)).toBe(
      true,
    )
    expect(first.candidates.map((item) => item.rank)).toEqual([1, 2, 3, 4])
  })

  it('desempata por mayor vulnerabilidad', () => {
    const tied = [candidate('T-B', 2, 80), candidate('T-A', -2, 40)]
    const [step] = strategy.select(contextWith(tied, 1)).steps
    expect(step.selectedVeredaId).toBe('T-B')
    expect(step.tieBreak).toBe('VULNERABILITY')
    expect(step.tiedWithIds).toEqual(['T-A'])
    expect(step.reason).toContain('se eligió por tener mayor vulnerabilidad')
  })

  it('desempata por id ascendente cuando también empata la vulnerabilidad', () => {
    const tied = [
      candidate('T-C', 2, 50),
      candidate('T-B', -2, 50),
      candidate('T-A', 0, 50, 2),
    ]
    const [step] = strategy.select(contextWith(tied, 1)).steps
    expect(step.selectedVeredaId).toBe('T-A')
    expect(step.tieBreak).toBe('ID')
    expect(step.tiedWithIds).toEqual(['T-B', 'T-C'])
    expect(step.reason).toContain('identificador ascendente')
  })

  it('es determinista sin importar el orden de entrada', () => {
    const expected = strategy.select(contextWith(line))
    const shuffled = [line[2], line[0], line[3], line[1]]
    expect(strategy.select(contextWith(shuffled))).toEqual(expected)
  })
})

describe('greedy-selection helpers', () => {
  it('compara ids de forma independiente de la configuración regional', () => {
    expect(['b', 'B', 'a'].sort(compareIdsAscending)).toEqual(['B', 'a', 'b'])
    expect(compareIdsAscending('x', 'x')).toBe(0)
  })

  it('formatea pesos y nombres', () => {
    expect(formatWeight(1 - 0.7)).toBe('0.3')
    expect(
      joinNames([
        {
          id: '1',
          nombre: 'Uno',
          provincia: 'P',
          lat: 0,
          lng: 0,
          vulnerabilityIndex: 1,
        },
        {
          id: '2',
          nombre: 'Dos',
          provincia: 'P',
          lat: 0,
          lng: 0,
          vulnerabilityIndex: 1,
        },
      ]),
    ).toBe('Uno, Dos')
  })
})
