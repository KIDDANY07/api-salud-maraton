import { Injectable } from '@nestjs/common'
import { priorityBandOf } from '../../common/utils/priority-band.util'
import {
  formatKm,
  joinNames,
  runGreedySelection,
  type GreedyPolicy,
  type SelectionDetails,
} from './greedy-selection'
import {
  RouteStrategyName,
  type RouteStrategy,
  type StrategyContext,
  type StrategyResult,
} from './route-strategy.interface'

export const NEAREST_NEIGHBOR_FORMULA =
  'En cada paso se elige la vereda con menor distancia d desde la posición actual'

function describeSelection(details: SelectionDetails): string {
  const { selected, from, candidateCount, tieBreak, tiedWith } = details
  const band = priorityBandOf(selected.candidate.vulnerabilityIndex)
  const distance = formatKm(selected.distanceKm)
  if (candidateCount === 1) {
    return `Única vereda candidata restante; queda a ${distance} km de ${from.nombre}. Prioridad ${band}.`
  }
  if (tieBreak === 'VULNERABILITY') {
    return `Empató en distancia (${distance} km desde ${from.nombre}) con ${joinNames(tiedWith)}; se eligió por tener mayor vulnerabilidad. Prioridad ${band}.`
  }
  if (tieBreak === 'ID') {
    return `Empató en distancia (${distance} km desde ${from.nombre}) y vulnerabilidad con ${joinNames(tiedWith)}; se eligió por identificador ascendente. Prioridad ${band}.`
  }
  return `Es la vereda más cercana a ${from.nombre} entre ${candidateCount} candidatas (${distance} km). Prioridad ${band}.`
}

const nearestNeighborPolicy: GreedyPolicy = {
  strategy: RouteStrategyName.NEAREST_NEIGHBOR,
  score: (measured) => ({ ...measured, score: null, components: null }),
  comparePrimary: (left, right) => left.distanceKm - right.distanceKm,
  describe: describeSelection,
}

@Injectable()
export class NearestNeighborStrategy implements RouteStrategy {
  readonly name = RouteStrategyName.NEAREST_NEIGHBOR
  readonly formula = NEAREST_NEIGHBOR_FORMULA
  readonly description =
    'Selección voraz que en cada paso visita la vereda más cercana a la posición actual'

  select(context: StrategyContext): StrategyResult {
    return runGreedySelection(context, nearestNeighborPolicy)
  }
}
