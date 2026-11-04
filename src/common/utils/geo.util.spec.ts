import {
  DEFAULT_ROAD_FACTOR,
  EARTH_RADIUS_KM,
  haversineDistanceKm,
  roadDistanceKm,
  roundTo,
} from './geo.util'

const ROSETTA_RADIUS_KM = 6372.8
const ROSETTA_DISTANCE_KM = 2887.2599506071106

describe('geo.util', () => {
  describe('haversineDistanceKm', () => {
    it('reproduce la distancia de referencia Nashville (BNA) a Los Ángeles (LAX)', () => {
      const nashville = { lat: 36.12, lng: -86.67 }
      const losAngeles = { lat: 33.94, lng: -118.4 }
      const expected =
        (ROSETTA_DISTANCE_KM * EARTH_RADIUS_KM) / ROSETTA_RADIUS_KM
      expect(haversineDistanceKm(nashville, losAngeles)).toBeCloseTo(
        expected,
        6,
      )
    })

    it('mide un grado de latitud sobre el ecuador como 2πR/360', () => {
      const distance = haversineDistanceKm(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      )
      expect(distance).toBeCloseTo((2 * Math.PI * EARTH_RADIUS_KM) / 360, 9)
      expect(distance).toBeCloseTo(111.195, 3)
    })

    it('es simétrica y vale cero para el mismo punto', () => {
      const bogota = { lat: 4.711, lng: -74.0721 }
      const zipaquira = { lat: 5.0221, lng: -74.0048 }
      expect(haversineDistanceKm(bogota, zipaquira)).toBeCloseTo(
        haversineDistanceKm(zipaquira, bogota),
        12,
      )
      expect(haversineDistanceKm(bogota, bogota)).toBe(0)
    })
  })

  describe('roadDistanceKm', () => {
    const from = { lat: 5.131, lng: -74.16 }
    const to = { lat: 5.162, lng: -74.198 }

    it('aplica por defecto el factor de vía 1.3', () => {
      expect(DEFAULT_ROAD_FACTOR).toBe(1.3)
      expect(roadDistanceKm(from, to)).toBeCloseTo(
        haversineDistanceKm(from, to) * 1.3,
        12,
      )
    })

    it('admite un factor configurable', () => {
      expect(roadDistanceKm(from, to, 2)).toBeCloseTo(
        haversineDistanceKm(from, to) * 2,
        12,
      )
    })

    it('rechaza factores menores que 1 o no finitos', () => {
      expect(() => roadDistanceKm(from, to, 0.5)).toThrow(RangeError)
      expect(() => roadDistanceKm(from, to, Number.NaN)).toThrow(RangeError)
    })
  })

  describe('roundTo', () => {
    it('redondea al número de decimales indicado', () => {
      expect(roundTo(1.23456, 3)).toBe(1.235)
      expect(roundTo(1.0005, 3)).toBe(1.001)
      expect(roundTo(10, 2)).toBe(10)
    })

    it('normaliza el cero negativo', () => {
      expect(Object.is(roundTo(-0.0000001, 3), 0)).toBe(true)
    })
  })
})
