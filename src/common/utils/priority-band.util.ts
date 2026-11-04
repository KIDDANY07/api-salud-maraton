export enum PriorityBand {
  ALTA = 'ALTA',
  MEDIA = 'MEDIA',
  BAJA = 'BAJA',
}

export const HIGH_PRIORITY_THRESHOLD = 70
export const MEDIUM_PRIORITY_THRESHOLD = 40

export function priorityBandOf(vulnerabilityIndex: number): PriorityBand {
  if (vulnerabilityIndex >= HIGH_PRIORITY_THRESHOLD) {
    return PriorityBand.ALTA
  }
  if (vulnerabilityIndex >= MEDIUM_PRIORITY_THRESHOLD) {
    return PriorityBand.MEDIA
  }
  return PriorityBand.BAJA
}
