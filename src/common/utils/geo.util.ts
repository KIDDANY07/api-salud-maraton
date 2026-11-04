export interface GeoPoint {
  lat: number
  lng: number
}

export const EARTH_RADIUS_KM = 6371.0088
export const DEFAULT_ROAD_FACTOR = 1.3

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

export function haversineDistanceKm(from: GeoPoint, to: GeoPoint): number {
  const deltaLat = toRadians(to.lat - from.lat)
  const deltaLng = toRadians(to.lng - from.lng)
  const fromLat = toRadians(from.lat)
  const toLat = toRadians(to.lat)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2
  const centralAngle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * centralAngle
}

export function roadDistanceKm(
  from: GeoPoint,
  to: GeoPoint,
  roadFactor: number = DEFAULT_ROAD_FACTOR,
): number {
  if (!Number.isFinite(roadFactor) || roadFactor < 1) {
    throw new RangeError(
      'El factor de vía debe ser un número mayor o igual a 1',
    )
  }
  return haversineDistanceKm(from, to) * roadFactor
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}
