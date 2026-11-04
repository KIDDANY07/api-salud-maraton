import type { GeoPoint } from '../../common/utils/geo.util'

export enum RouteStrategyName {
  VULNERABILITY_WEIGHTED = 'VULNERABILITY_WEIGHTED',
  NEAREST_NEIGHBOR = 'NEAREST_NEIGHBOR',
}

export interface RoutePlace extends GeoPoint {
  id: string
  nombre: string
}

export interface RouteCandidate extends RoutePlace {
  provincia: string
  vulnerabilityIndex: number
}

export type TieBreak = 'NONE' | 'VULNERABILITY' | 'ID'

export interface ScoreComponents {
  normalizedDistance: number
  vulnerabilityComponent: number
  proximityComponent: number
}

export interface CandidateEvaluation {
  rank: number
  veredaId: string
  nombre: string
  vulnerabilityIndex: number
  distanceKm: number
  score: number | null
  components: ScoreComponents | null
}

export interface StrategyStep {
  order: number
  fromId: string
  fromNombre: string
  candidateCount: number
  dMaxKm: number
  selectedVeredaId: string
  legKm: number
  tieBreak: TieBreak
  tiedWithIds: string[]
  reason: string
  candidates: CandidateEvaluation[]
}

export interface StrategyContext {
  base: RoutePlace
  candidates: readonly RouteCandidate[]
  visitCount: number
  alpha: number
  distanceKm: (from: GeoPoint, to: GeoPoint) => number
}

export interface StrategyResult {
  strategy: RouteStrategyName
  orderedVeredaIds: string[]
  steps: StrategyStep[]
}

export interface RouteStrategy {
  readonly name: RouteStrategyName
  readonly description: string
  readonly formula: string
  select(context: StrategyContext): StrategyResult
}

export const ROUTE_STRATEGIES = Symbol('ROUTE_STRATEGIES')
