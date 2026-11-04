import { Test } from '@nestjs/testing'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roadDistanceKm, roundTo } from '../common/utils/geo.util'
import {
  ALGORITHM_VERSION,
  DEFAULT_ROUTE_PARAMETERS,
  RouteCalculatorService,
  RouteValidationError,
  type RouteDataset,
} from './route-calculator.service'
import { RouteEngineModule } from './route-engine.module'
import { NearestNeighborStrategy } from './strategies/nearest-neighbor.strategy'
import {
  RouteStrategyName,
  type RouteCandidate,
} from './strategies/route-strategy.interface'
import { VulnerabilityWeightedStrategy } from './strategies/vulnerability-weighted.strategy'

interface DatasetFile {
  datasetVersion: string
  base: RouteDataset['base']
  veredas: RouteCandidate[]
}

const datasetFile = JSON.parse(
  readFileSync(join(process.cwd(), 'data', 'veredas.json'), 'utf8'),
) as DatasetFile

const dataset: RouteDataset = {
  datasetVersion: datasetFile.datasetVersion,
  base: datasetFile.base,
  veredas: datasetFile.veredas,
}

function expectValidationError(action: () => unknown, fragment: string) {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(RouteValidationError)
    expect((error as RouteValidationError).details.join(' | ')).toContain(
      fragment,
    )
    return
  }
  throw new Error('Se esperaba RouteValidationError')
}

describe('RouteCalculatorService', () => {
  let calculator: RouteCalculatorService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RouteEngineModule],
    }).compile()
    calculator = moduleRef.get(RouteCalculatorService)
  })

  it('registra ambas estrategias mediante el módulo', () => {
    expect(calculator.availableStrategies()).toEqual([
      RouteStrategyName.NEAREST_NEIGHBOR,
      RouteStrategyName.VULNERABILITY_WEIGHTED,
    ])
  })

  it('exige que la estrategia de comparación esté registrada', () => {
    expect(
      () => new RouteCalculatorService([new VulnerabilityWeightedStrategy()]),
    ).toThrow('NEAREST_NEIGHBOR')
  })

  describe('parámetros', () => {
    it('aplica los valores por defecto', () => {
      const { plan } = calculator.calculate(dataset, {})
      expect(plan.parameters).toEqual({
        ...DEFAULT_ROUTE_PARAMETERS,
        excludedVeredaIds: [],
        roadFactor: 1.3,
      })
      expect(plan.stops).toHaveLength(5)
      expect(plan.algorithmVersion).toBe(ALGORITHM_VERSION)
      expect(plan.datasetVersion).toBe(dataset.datasetVersion)
    })

    it.each([
      [0, 'visitCount debe ser un entero mayor o igual a 1'],
      [2.5, 'visitCount debe ser un entero mayor o igual a 1'],
      [13, 'visitCount debe estar entre 1 y 12'],
    ])('rechaza visitCount = %d', (visitCount, message) => {
      expectValidationError(
        () => calculator.calculate(dataset, { visitCount }),
        message,
      )
    })

    it('acepta visitCount igual al total de veredas disponibles', () => {
      const { plan } = calculator.calculate(dataset, { visitCount: 12 })
      expect(plan.stops).toHaveLength(12)
      expect(plan.notSelected).toHaveLength(0)
    })

    it('valida visitCount contra las veredas que quedan tras excluir', () => {
      const excludedVeredaIds = [
        'VS-01',
        'VS-02',
        'VS-03',
        'VS-04',
        'VS-05',
        'VS-06',
        'VS-07',
        'VS-08',
      ]
      expectValidationError(
        () =>
          calculator.calculate(dataset, { visitCount: 5, excludedVeredaIds }),
        'visitCount debe estar entre 1 y 4',
      )
      const { plan } = calculator.calculate(dataset, {
        visitCount: 4,
        excludedVeredaIds,
      })
      expect(plan.stops.map((stop) => stop.veredaId).sort()).toEqual([
        'VS-09',
        'VS-10',
        'VS-11',
        'VS-12',
      ])
    })

    it('rechaza exclusiones de veredas inexistentes', () => {
      expectValidationError(
        () =>
          calculator.calculate(dataset, {
            excludedVeredaIds: ['VS-99', 'VS-01'],
          }),
        'veredas inexistentes: VS-99',
      )
    })

    it('rechaza excluir todas las veredas', () => {
      expectValidationError(
        () =>
          calculator.calculate(dataset, {
            visitCount: 1,
            excludedVeredaIds: dataset.veredas.map((vereda) => vereda.id),
          }),
        'No quedan veredas disponibles',
      )
    })

    it('rechaza alpha, roadFactor y estrategia fuera de rango', () => {
      expectValidationError(
        () => calculator.calculate(dataset, { alpha: 1.5 }),
        'alpha debe estar entre 0 y 1',
      )
      expectValidationError(
        () => calculator.calculate(dataset, {}, 0.9),
        'roadFactor debe estar entre 1 y 2.5',
      )
      expectValidationError(
        () =>
          calculator.calculate(dataset, {
            strategy: 'RANDOM' as RouteStrategyName,
          }),
        'strategy debe ser una de',
      )
    })

    it('normaliza las exclusiones repetidas y desordenadas', () => {
      const { plan } = calculator.calculate(dataset, {
        excludedVeredaIds: ['VS-04', 'VS-02', 'VS-04'],
      })
      expect(plan.parameters.excludedVeredaIds).toEqual(['VS-02', 'VS-04'])
    })
  })

  describe('excludedVeredaIds', () => {
    it('omite las veredas excluidas y las reporta con su motivo', () => {
      const withoutExclusion = calculator.calculate(dataset, {})
      const excludedId = withoutExclusion.plan.stops[0].veredaId
      const { plan, breakdown } = calculator.calculate(dataset, {
        excludedVeredaIds: [excludedId],
      })
      expect(plan.stops.map((stop) => stop.veredaId)).not.toContain(excludedId)
      expect(plan.comparison.selectedVeredaIds).not.toContain(excludedId)
      expect(plan.notSelected[0]).toMatchObject({
        veredaId: excludedId,
        excluded: true,
      })
      expect(plan.notSelected[0].reason).toContain('Excluida por solicitud')
      expect(breakdown.candidates.map((item) => item.veredaId)).not.toContain(
        excludedId,
      )
      expect(breakdown.excludedVeredaIds).toEqual([excludedId])
    })
  })

  describe('ruta generada', () => {
    it('acumula los tramos y suma el regreso a la base', () => {
      const { plan } = calculator.calculate(dataset, {})
      let cumulative = 0
      for (const stop of plan.stops) {
        cumulative = roundTo(cumulative + stop.legKm, 3)
        expect(stop.cumulativeKm).toBe(cumulative)
        expect(stop.reason.length).toBeGreaterThan(20)
      }
      const last = dataset.veredas.find(
        (vereda) => vereda.id === plan.stops[4].veredaId,
      ) as RouteCandidate
      const expectedReturn = roundTo(roadDistanceKm(last, dataset.base), 3)
      expect(plan.returnLeg).toEqual({
        fromVeredaId: last.id,
        toBaseId: dataset.base.id,
        legKm: expectedReturn,
        cumulativeKm: roundTo(cumulative + expectedReturn, 3),
      })
      expect(plan.totalDistanceKm).toBe(plan.returnLeg?.cumulativeKm)
    })

    it('no suma el regreso cuando returnToBase es false', () => {
      const { plan } = calculator.calculate(dataset, { returnToBase: false })
      expect(plan.returnLeg).toBeNull()
      expect(plan.totalDistanceKm).toBe(plan.stops[4].cumulativeKm)
    })

    it('lista las veredas no seleccionadas con su motivo', () => {
      const { plan } = calculator.calculate(dataset, {})
      expect(plan.notSelected).toHaveLength(7)
      expect(plan.notSelected.every((item) => !item.excluded)).toBe(true)
      expect(plan.notSelected[0].reason).toContain('mayor puntaje combinado')
      const nearest = calculator.calculate(dataset, {
        strategy: RouteStrategyName.NEAREST_NEIGHBOR,
      })
      expect(nearest.plan.notSelected[0].reason).toContain('más cercanas')
    })

    it('no expone el índice de vulnerabilidad en el plan público', () => {
      const { plan, breakdown } = calculator.calculate(dataset, {})
      expect(JSON.stringify(plan)).not.toContain('vulnerabilityIndex')
      expect(JSON.stringify(breakdown)).toContain('vulnerabilityIndex')
    })

    it('incluye la comparación con NEAREST_NEIGHBOR', () => {
      const { plan, breakdown } = calculator.calculate(dataset, {})
      const nearest = calculator.calculate(dataset, {
        strategy: RouteStrategyName.NEAREST_NEIGHBOR,
      })
      expect(plan.comparison.strategy).toBe(RouteStrategyName.NEAREST_NEIGHBOR)
      expect(plan.comparison.totalDistanceKm).toBe(nearest.plan.totalDistanceKm)
      expect(plan.comparison.selectedVeredaIds).toEqual(
        nearest.plan.stops.map((stop) => stop.veredaId),
      )
      expect(plan.comparison.selectedVeredas[0]).toEqual({
        order: 1,
        veredaId: nearest.plan.stops[0].veredaId,
        nombre: nearest.plan.stops[0].nombre,
      })
      expect(plan.comparison.distanceDifferenceKm).toBe(
        roundTo(plan.totalDistanceKm - nearest.plan.totalDistanceKm, 3),
      )
      expect(breakdown.comparison.steps).toHaveLength(5)
      expect(nearest.plan.comparison.sameOrder).toBe(true)
      expect(nearest.plan.comparison.sameSelection).toBe(true)
      expect(nearest.plan.comparison.distanceDifferenceKm).toBe(0)
    })

    it('con alpha = 0 coincide con NEAREST_NEIGHBOR en el dataset real', () => {
      for (const visitCount of [1, 3, 5, 8, 12]) {
        const { plan } = calculator.calculate(dataset, { alpha: 0, visitCount })
        expect(plan.comparison.sameOrder).toBe(true)
        expect(plan.comparison.distanceDifferenceKm).toBe(0)
      }
    })

    it('con alpha = 1 visita en orden de vulnerabilidad descendente', () => {
      const { breakdown } = calculator.calculate(dataset, {
        alpha: 1,
        visitCount: 12,
      })
      const byId = new Map(
        dataset.veredas.map((vereda) => [vereda.id, vereda.vulnerabilityIndex]),
      )
      const visited = breakdown.steps.map(
        (step) => byId.get(step.selectedVeredaId) as number,
      )
      expect(visited).toEqual([...visited].sort((left, right) => right - left))
      expect(breakdown.steps[0].selectedVeredaId).toBe('VS-03')
    })

    it('es determinista para las mismas entradas y cualquier orden del dataset', () => {
      const first = calculator.calculate(dataset, {
        alpha: 0.45,
        visitCount: 6,
      })
      const reordered: RouteDataset = {
        ...dataset,
        veredas: [...dataset.veredas].reverse(),
      }
      const second = calculator.calculate(reordered, {
        alpha: 0.45,
        visitCount: 6,
      })
      expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    })

    it('usa el factor de vía recibido', () => {
      const standard = calculator.calculate(dataset, { visitCount: 1 })
      const doubled = calculator.calculate(dataset, { visitCount: 1 }, 2.4)
      expect(doubled.plan.parameters.roadFactor).toBe(2.4)
      expect(doubled.plan.stops[0].legKm).toBeGreaterThan(
        standard.plan.stops[0].legKm,
      )
    })

    it('documenta en el desglose la fórmula y las candidatas', () => {
      const { breakdown } = calculator.calculate(dataset, {})
      expect(breakdown.strategy).toBe(RouteStrategyName.VULNERABILITY_WEIGHTED)
      expect(breakdown.formula).toBe(
        new VulnerabilityWeightedStrategy().formula,
      )
      expect(breakdown.comparison.formula).toBe(
        new NearestNeighborStrategy().formula,
      )
      expect(breakdown.candidates).toHaveLength(12)
      expect(breakdown.steps[0].candidates).toHaveLength(12)
      expect(breakdown.steps[4].candidates).toHaveLength(8)
    })
  })
})
