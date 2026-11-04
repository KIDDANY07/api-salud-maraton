import { Inject, Injectable } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { sha256Hex } from '../common/utils/hash.util'
import type { RouteDataset } from '../route_engine/route-calculator.service'
import type {
  RouteCandidate,
  RoutePlace,
} from '../route_engine/strategies/route-strategy.interface'

export const VEREDAS_DATASET = Symbol('VEREDAS_DATASET')

export const CUNDINAMARCA_BOUNDS = {
  minLat: 3.7,
  maxLat: 5.9,
  minLng: -74.95,
  maxLng: -73.0,
} as const

export interface VeredasDataset extends RouteDataset {
  simulated: true
  datasetHash: string
  sourcePath: string
}

export class InvalidVeredasDatasetError extends Error {
  constructor(
    readonly problems: string[],
    sourcePath: string,
  ) {
    super(
      `El archivo de veredas ${sourcePath} es inválido: ${problems.join('; ')}`,
    )
    this.name = 'InvalidVeredasDatasetError'
  }
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function validatePlace(
  value: unknown,
  label: string,
  problems: string[],
): value is UnknownRecord & RoutePlace {
  if (!isRecord(value)) {
    problems.push(`${label} debe ser un objeto`)
    return false
  }
  const initialProblems = problems.length
  if (!isNonEmptyString(value.id)) {
    problems.push(`${label}.id debe ser un texto no vacío`)
  }
  if (!isNonEmptyString(value.nombre)) {
    problems.push(`${label}.nombre debe ser un texto no vacío`)
  }
  const { minLat, maxLat, minLng, maxLng } = CUNDINAMARCA_BOUNDS
  if (!isFiniteNumber(value.lat) || value.lat < minLat || value.lat > maxLat) {
    problems.push(
      `${label}.lat debe ser un número entre ${minLat} y ${maxLat} (Cundinamarca)`,
    )
  }
  if (!isFiniteNumber(value.lng) || value.lng < minLng || value.lng > maxLng) {
    problems.push(
      `${label}.lng debe ser un número entre ${minLng} y ${maxLng} (Cundinamarca)`,
    )
  }
  return problems.length === initialProblems
}

function validateVereda(
  value: unknown,
  index: number,
  problems: string[],
): RouteCandidate | null {
  const label = `veredas[${index}]`
  const placeIsValid = validatePlace(value, label, problems)
  if (!isRecord(value)) {
    return null
  }
  let isValid = placeIsValid
  if (!isNonEmptyString(value.provincia)) {
    problems.push(`${label}.provincia debe ser un texto no vacío`)
    isValid = false
  }
  const index100 = value.vulnerabilityIndex
  if (!isFiniteNumber(index100) || index100 < 0 || index100 > 100) {
    problems.push(`${label}.vulnerabilityIndex debe estar entre 0 y 100`)
    isValid = false
  }
  if (!isValid) {
    return null
  }
  return {
    id: value.id as string,
    nombre: value.nombre as string,
    provincia: value.provincia as string,
    lat: value.lat as number,
    lng: value.lng as number,
    vulnerabilityIndex: index100 as number,
  }
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id)
    }
    seen.add(id)
  }
  return [...duplicates]
}

export function parseVeredasDataset(
  rawContent: string,
  sourcePath = 'veredas.json',
): VeredasDataset {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    throw new InvalidVeredasDatasetError(
      ['el contenido no es JSON válido'],
      sourcePath,
    )
  }
  const problems: string[] = []
  if (!isRecord(parsed)) {
    throw new InvalidVeredasDatasetError(
      ['la raíz debe ser un objeto'],
      sourcePath,
    )
  }
  if (!isNonEmptyString(parsed.datasetVersion)) {
    problems.push('datasetVersion debe ser un texto no vacío')
  }
  if (parsed.simulated !== true) {
    problems.push('simulated debe ser true: solo se admiten datos simulados')
  }
  const baseIsValid = validatePlace(parsed.base, 'base', problems)
  const veredas: RouteCandidate[] = []
  if (!Array.isArray(parsed.veredas) || parsed.veredas.length === 0) {
    problems.push('veredas debe ser una lista con al menos un elemento')
  } else {
    parsed.veredas.forEach((item, index) => {
      const vereda = validateVereda(item, index, problems)
      if (vereda) {
        veredas.push(vereda)
      }
    })
    const duplicates = findDuplicates(veredas.map((vereda) => vereda.id))
    if (duplicates.length > 0) {
      problems.push(`hay ids de vereda repetidos: ${duplicates.join(', ')}`)
    }
  }
  if (problems.length > 0 || !baseIsValid) {
    throw new InvalidVeredasDatasetError(problems, sourcePath)
  }
  const base = parsed.base as RoutePlace
  return {
    datasetVersion: parsed.datasetVersion as string,
    simulated: true,
    base: { id: base.id, nombre: base.nombre, lat: base.lat, lng: base.lng },
    veredas,
    datasetHash: sha256Hex(rawContent),
    sourcePath,
  }
}

export function loadVeredasDataset(
  path: string,
  workingDirectory: string = process.cwd(),
): VeredasDataset {
  const absolutePath = isAbsolute(path) ? path : resolve(workingDirectory, path)
  let rawContent: string
  try {
    rawContent = readFileSync(absolutePath, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new InvalidVeredasDatasetError(
      [`no se pudo leer el archivo (${reason})`],
      absolutePath,
    )
  }
  return parseVeredasDataset(rawContent, absolutePath)
}

@Injectable()
export class VeredasCatalogService {
  constructor(
    @Inject(VEREDAS_DATASET) private readonly dataset: VeredasDataset,
  ) {}

  getDataset(): VeredasDataset {
    return this.dataset
  }

  get datasetVersion(): string {
    return this.dataset.datasetVersion
  }

  get datasetHash(): string {
    return this.dataset.datasetHash
  }
}
