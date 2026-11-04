import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_ROAD_FACTOR,
  roadDistanceKm,
  roundTo,
  type GeoPoint,
} from '../common/utils/geo.util'
import {
  priorityBandOf,
  type PriorityBand,
} from '../common/utils/priority-band.util'
import {
  compareIdsAscending,
  DISTANCE_DECIMALS,
} from './strategies/greedy-selection'
import {
  ROUTE_STRATEGIES,
  RouteStrategyName,
  type RouteCandidate,
  type RoutePlace,
  type RouteStrategy,
  type StrategyResult,
  type StrategyStep,
} from './strategies/route-strategy.interface'

export const ALGORITHM_VERSION = '1.0.0'
export const COMPARISON_STRATEGY = RouteStrategyName.NEAREST_NEIGHBOR
export const MIN_ROAD_FACTOR = 1
export const MAX_ROAD_FACTOR = 2.5

export const DEFAULT_ROUTE_PARAMETERS = {
  strategy: RouteStrategyName.VULNERABILITY_WEIGHTED,
  visitCount: 5,
  alpha: 0.6,
  returnToBase: true,
} as const

export interface RouteDataset {
  datasetVersion: string
  base: RoutePlace
  veredas: readonly RouteCandidate[]
}

export interface RouteParametersInput {
  strategy?: RouteStrategyName
  visitCount?: number
  alpha?: number
  returnToBase?: boolean
  excludedVeredaIds?: string[]
}

export interface AppliedRouteParameters {
  strategy: RouteStrategyName
  visitCount: number
  alpha: number
  returnToBase: boolean
  excludedVeredaIds: string[]
  roadFactor: number
}

export interface RouteStop {
  order: number
  veredaId: string
  nombre: string
  provincia: string
  legKm: number
  cumulativeKm: number
  priorityBand: PriorityBand
  reason: string
}

export interface ReturnLeg {
  fromVeredaId: string
  toBaseId: string
  legKm: number
  cumulativeKm: number
}

export interface NotSelectedVereda {
  veredaId: string
  nombre: string
  provincia: string
  priorityBand: PriorityBand
  excluded: boolean
  reason: string
}

export interface ComparisonStop {
  order: number
  veredaId: string
  nombre: string
}

export interface StrategyComparison {
  strategy: RouteStrategyName
  totalDistanceKm: number
  selectedVeredaIds: string[]
  selectedVeredas: ComparisonStop[]
  distanceDifferenceKm: number
  sameSelection: boolean
  sameOrder: boolean
}

export interface RoutePlan {
  algorithmVersion: string
  datasetVersion: string
  parameters: AppliedRouteParameters
  base: RoutePlace
  stops: RouteStop[]
  returnLeg: ReturnLeg | null
  totalDistanceKm: number
  notSelected: NotSelectedVereda[]
  comparison: StrategyComparison
}

export interface BreakdownCandidate {
  veredaId: string
  nombre: string
  vulnerabilityIndex: number
  priorityBand: PriorityBand
}

export interface RouteScoreBreakdown {
  strategy: RouteStrategyName
  formula: string
  roadFactor: number
  candidates: BreakdownCandidate[]
  excludedVeredaIds: string[]
  steps: StrategyStep[]
  comparison: {
    strategy: RouteStrategyName
    formula: string
    steps: StrategyStep[]
  }
}

export interface RouteComputation {
  plan: RoutePlan
  breakdown: RouteScoreBreakdown
}

export class RouteValidationError extends Error {
  constructor(readonly details: string[]) {
    super(details.join('; '))
    this.name = 'RouteValidationError'
  }
}

interface Itinerary {
  stops: RouteStop[]
  returnLeg: ReturnLeg | null
  totalDistanceKm: number
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareIdsAscending)
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    compareIdsAscending(left.id, right.id),
  )
}

@Injectable()
export class RouteCalculatorService {
  private readonly strategies: ReadonlyMap<RouteStrategyName, RouteStrategy>

  constructor(@Inject(ROUTE_STRATEGIES) strategies: RouteStrategy[]) {
    this.strategies = new Map(
      strategies.map((strategy) => [strategy.name, strategy]),
    )
    if (!this.strategies.has(COMPARISON_STRATEGY)) {
      throw new Error(
        `La estrategia de comparación ${COMPARISON_STRATEGY} debe estar registrada`,
      )
    }
  }

  availableStrategies(): RouteStrategyName[] {
    return [...this.strategies.keys()].sort(compareIdsAscending)
  }

  resolveParameters(
    input: RouteParametersInput,
    dataset: RouteDataset,
    roadFactor: number = DEFAULT_ROAD_FACTOR,
  ): AppliedRouteParameters {
    const strategy = input.strategy ?? DEFAULT_ROUTE_PARAMETERS.strategy
    const visitCount = input.visitCount ?? DEFAULT_ROUTE_PARAMETERS.visitCount
    const alpha = input.alpha ?? DEFAULT_ROUTE_PARAMETERS.alpha
    const returnToBase =
      input.returnToBase ?? DEFAULT_ROUTE_PARAMETERS.returnToBase
    const excludedVeredaIds = uniqueSorted(input.excludedVeredaIds ?? [])
    const knownIds = new Set(dataset.veredas.map((vereda) => vereda.id))
    const errors: string[] = []
    if (!this.strategies.has(strategy)) {
      errors.push(
        `strategy debe ser una de: ${this.availableStrategies().join(', ')}`,
      )
    }
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      errors.push('alpha debe estar entre 0 y 1')
    }
    if (
      !Number.isFinite(roadFactor) ||
      roadFactor < MIN_ROAD_FACTOR ||
      roadFactor > MAX_ROAD_FACTOR
    ) {
      errors.push(
        `roadFactor debe estar entre ${MIN_ROAD_FACTOR} y ${MAX_ROAD_FACTOR}`,
      )
    }
    const unknownIds = excludedVeredaIds.filter((id) => !knownIds.has(id))
    if (unknownIds.length > 0) {
      errors.push(
        `excludedVeredaIds contiene veredas inexistentes: ${unknownIds.join(', ')}`,
      )
    }
    const availableCount =
      dataset.veredas.length -
      excludedVeredaIds.filter((id) => knownIds.has(id)).length
    if (!Number.isInteger(visitCount) || visitCount < 1) {
      errors.push('visitCount debe ser un entero mayor o igual a 1')
    } else if (availableCount === 0) {
      errors.push('No quedan veredas disponibles después de las exclusiones')
    } else if (visitCount > availableCount) {
      errors.push(
        `visitCount debe estar entre 1 y ${availableCount}, el número de veredas disponibles`,
      )
    }
    if (errors.length > 0) {
      throw new RouteValidationError(errors)
    }
    return {
      strategy,
      visitCount,
      alpha,
      returnToBase,
      excludedVeredaIds,
      roadFactor,
    }
  }

  calculate(
    dataset: RouteDataset,
    input: RouteParametersInput,
    roadFactor: number = DEFAULT_ROAD_FACTOR,
  ): RouteComputation {
    const parameters = this.resolveParameters(input, dataset, roadFactor)
    const excluded = new Set(parameters.excludedVeredaIds)
    const candidates = sortById(
      dataset.veredas.filter((vereda) => !excluded.has(vereda.id)),
    )
    const distanceKm = (from: GeoPoint, to: GeoPoint) =>
      roadDistanceKm(from, to, parameters.roadFactor)
    const context = {
      base: dataset.base,
      candidates,
      visitCount: parameters.visitCount,
      alpha: parameters.alpha,
      distanceKm,
    }
    const strategy = this.strategyFor(parameters.strategy)
    const comparisonStrategy = this.strategyFor(COMPARISON_STRATEGY)
    const primary = strategy.select(context)
    const reference = comparisonStrategy.select(context)
    const itinerary = this.buildItinerary(primary, dataset, parameters)
    const referenceItinerary = this.buildItinerary(
      reference,
      dataset,
      parameters,
    )
    return {
      plan: {
        algorithmVersion: ALGORITHM_VERSION,
        datasetVersion: dataset.datasetVersion,
        parameters,
        base: { ...dataset.base },
        stops: itinerary.stops,
        returnLeg: itinerary.returnLeg,
        totalDistanceKm: itinerary.totalDistanceKm,
        notSelected: this.buildNotSelected(dataset, primary, parameters),
        comparison: this.buildComparison(
          primary,
          itinerary,
          reference,
          referenceItinerary,
        ),
      },
      breakdown: {
        strategy: strategy.name,
        formula: strategy.formula,
        roadFactor: parameters.roadFactor,
        candidates: candidates.map((candidate) => ({
          veredaId: candidate.id,
          nombre: candidate.nombre,
          vulnerabilityIndex: candidate.vulnerabilityIndex,
          priorityBand: priorityBandOf(candidate.vulnerabilityIndex),
        })),
        excludedVeredaIds: parameters.excludedVeredaIds,
        steps: primary.steps,
        comparison: {
          strategy: comparisonStrategy.name,
          formula: comparisonStrategy.formula,
          steps: reference.steps,
        },
      },
    }
  }

  private strategyFor(name: RouteStrategyName): RouteStrategy {
    return this.strategies.get(name) as RouteStrategy
  }

  private buildItinerary(
    result: StrategyResult,
    dataset: RouteDataset,
    parameters: AppliedRouteParameters,
  ): Itinerary {
    const byId = new Map(dataset.veredas.map((vereda) => [vereda.id, vereda]))
    let cumulativeKm = 0
    const stops = result.steps.map((step): RouteStop => {
      const vereda = byId.get(step.selectedVeredaId) as RouteCandidate
      cumulativeKm = roundTo(cumulativeKm + step.legKm, DISTANCE_DECIMALS)
      return {
        order: step.order,
        veredaId: vereda.id,
        nombre: vereda.nombre,
        provincia: vereda.provincia,
        legKm: step.legKm,
        cumulativeKm,
        priorityBand: priorityBandOf(vereda.vulnerabilityIndex),
        reason: step.reason,
      }
    })
    const lastStop = stops[stops.length - 1]
    if (!parameters.returnToBase || !lastStop) {
      return { stops, returnLeg: null, totalDistanceKm: cumulativeKm }
    }
    const lastVereda = byId.get(lastStop.veredaId) as RouteCandidate
    const legKm = roundTo(
      roadDistanceKm(lastVereda, dataset.base, parameters.roadFactor),
      DISTANCE_DECIMALS,
    )
    const totalDistanceKm = roundTo(cumulativeKm + legKm, DISTANCE_DECIMALS)
    return {
      stops,
      returnLeg: {
        fromVeredaId: lastVereda.id,
        toBaseId: dataset.base.id,
        legKm,
        cumulativeKm: totalDistanceKm,
      },
      totalDistanceKm,
    }
  }

  private buildNotSelected(
    dataset: RouteDataset,
    result: StrategyResult,
    parameters: AppliedRouteParameters,
  ): NotSelectedVereda[] {
    const selected = new Set(result.orderedVeredaIds)
    const excluded = new Set(parameters.excludedVeredaIds)
    const capacityReason =
      parameters.strategy === RouteStrategyName.NEAREST_NEIGHBOR
        ? `No seleccionada: el cupo de ${parameters.visitCount} visitas de la jornada se completó con veredas más cercanas en cada paso.`
        : `No seleccionada: el cupo de ${parameters.visitCount} visitas de la jornada se completó con veredas de mayor puntaje combinado de vulnerabilidad y cercanía.`
    return sortById(dataset.veredas)
      .filter((vereda) => !selected.has(vereda.id))
      .map((vereda) => {
        const isExcluded = excluded.has(vereda.id)
        return {
          veredaId: vereda.id,
          nombre: vereda.nombre,
          provincia: vereda.provincia,
          priorityBand: priorityBandOf(vereda.vulnerabilityIndex),
          excluded: isExcluded,
          reason: isExcluded
            ? 'Excluida por solicitud del planificador (por ejemplo, por una vía cerrada).'
            : capacityReason,
        }
      })
      .sort(
        (left, right) =>
          Number(right.excluded) - Number(left.excluded) ||
          compareIdsAscending(left.veredaId, right.veredaId),
      )
  }

  private buildComparison(
    primary: StrategyResult,
    primaryItinerary: Itinerary,
    reference: StrategyResult,
    referenceItinerary: Itinerary,
  ): StrategyComparison {
    const primaryIds = primary.orderedVeredaIds
    const referenceIds = reference.orderedVeredaIds
    const referenceSet = new Set(referenceIds)
    return {
      strategy: reference.strategy,
      totalDistanceKm: referenceItinerary.totalDistanceKm,
      selectedVeredaIds: [...referenceIds],
      selectedVeredas: referenceItinerary.stops.map((stop) => ({
        order: stop.order,
        veredaId: stop.veredaId,
        nombre: stop.nombre,
      })),
      distanceDifferenceKm: roundTo(
        primaryItinerary.totalDistanceKm - referenceItinerary.totalDistanceKm,
        DISTANCE_DECIMALS,
      ),
      sameSelection:
        primaryIds.length === referenceIds.length &&
        primaryIds.every((id) => referenceSet.has(id)),
      sameOrder:
        primaryIds.length === referenceIds.length &&
        primaryIds.every((id, index) => referenceIds[index] === id),
    }
  }
}
