import { roundTo } from '../../common/utils/geo.util'
import type {
  CandidateEvaluation,
  RouteCandidate,
  RoutePlace,
  RouteStrategyName,
  ScoreComponents,
  StrategyContext,
  StrategyResult,
  StrategyStep,
  TieBreak,
} from './route-strategy.interface'

export const DISTANCE_DECIMALS = 3
export const SCORE_DECIMALS = 6

export interface MeasuredCandidate {
  candidate: RouteCandidate
  distanceKm: number
}

export interface ScoredCandidate extends MeasuredCandidate {
  score: number | null
  components: ScoreComponents | null
}

export interface SelectionDetails {
  selected: ScoredCandidate
  from: RoutePlace
  candidateCount: number
  tieBreak: TieBreak
  tiedWith: RouteCandidate[]
  alpha: number
}

export interface GreedyPolicy {
  strategy: RouteStrategyName
  score(
    measured: MeasuredCandidate,
    dMaxKm: number,
    alpha: number,
  ): ScoredCandidate
  comparePrimary(left: ScoredCandidate, right: ScoredCandidate): number
  describe(details: SelectionDetails): string
}

export function compareIdsAscending(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}

export function formatKm(distanceKm: number): string {
  return distanceKm.toFixed(1)
}

export function formatWeight(weight: number): string {
  return String(roundTo(weight, 4))
}

export function joinNames(candidates: RouteCandidate[]): string {
  return candidates.map((candidate) => candidate.nombre).join(', ')
}

function rankingComparator(policy: GreedyPolicy) {
  return (left: ScoredCandidate, right: ScoredCandidate): number =>
    policy.comparePrimary(left, right) ||
    right.candidate.vulnerabilityIndex - left.candidate.vulnerabilityIndex ||
    compareIdsAscending(left.candidate.id, right.candidate.id)
}

function detectTieBreak(
  ranked: ScoredCandidate[],
  policy: GreedyPolicy,
): { tieBreak: TieBreak; tiedWith: RouteCandidate[] } {
  const [winner, ...others] = ranked
  const tiedOnPrimary = others.filter(
    (other) => policy.comparePrimary(winner, other) === 0,
  )
  if (tiedOnPrimary.length === 0) {
    return { tieBreak: 'NONE', tiedWith: [] }
  }
  const tiedOnVulnerability = tiedOnPrimary.some(
    (other) =>
      other.candidate.vulnerabilityIndex ===
      winner.candidate.vulnerabilityIndex,
  )
  return {
    tieBreak: tiedOnVulnerability ? 'ID' : 'VULNERABILITY',
    tiedWith: tiedOnPrimary.map((other) => other.candidate),
  }
}

function toEvaluation(
  scored: ScoredCandidate,
  index: number,
): CandidateEvaluation {
  return {
    rank: index + 1,
    veredaId: scored.candidate.id,
    nombre: scored.candidate.nombre,
    vulnerabilityIndex: scored.candidate.vulnerabilityIndex,
    distanceKm: scored.distanceKm,
    score: scored.score,
    components: scored.components,
  }
}

export function runGreedySelection(
  context: StrategyContext,
  policy: GreedyPolicy,
): StrategyResult {
  const remaining = [...context.candidates]
  const steps: StrategyStep[] = []
  let position: RoutePlace = context.base
  while (steps.length < context.visitCount && remaining.length > 0) {
    const from = position
    const measured = remaining.map((candidate) => ({
      candidate,
      distanceKm: roundTo(
        context.distanceKm(from, candidate),
        DISTANCE_DECIMALS,
      ),
    }))
    const dMaxKm = Math.max(...measured.map((item) => item.distanceKm))
    const ranked = measured
      .map((item) => policy.score(item, dMaxKm, context.alpha))
      .sort(rankingComparator(policy))
    const selected = ranked[0]
    const { tieBreak, tiedWith } = detectTieBreak(ranked, policy)
    steps.push({
      order: steps.length + 1,
      fromId: from.id,
      fromNombre: from.nombre,
      candidateCount: ranked.length,
      dMaxKm,
      selectedVeredaId: selected.candidate.id,
      legKm: selected.distanceKm,
      tieBreak,
      tiedWithIds: tiedWith.map((candidate) => candidate.id),
      reason: policy.describe({
        selected,
        from,
        candidateCount: ranked.length,
        tieBreak,
        tiedWith,
        alpha: context.alpha,
      }),
      candidates: ranked.map(toEvaluation),
    })
    remaining.splice(remaining.indexOf(selected.candidate), 1)
    position = selected.candidate
  }
  return {
    strategy: policy.strategy,
    orderedVeredaIds: steps.map((step) => step.selectedVeredaId),
    steps,
  }
}
