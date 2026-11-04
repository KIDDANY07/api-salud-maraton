import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256Hex } from '../common/utils/hash.util'
import { PriorityBand } from '../common/utils/priority-band.util'
import {
  InvalidVeredasDatasetError,
  loadVeredasDataset,
  parseVeredasDataset,
  VeredasCatalogService,
} from './veredas-catalog.service'
import { VeredasService } from './veredas.service'

const DATA_PATH = join(process.cwd(), 'data', 'veredas.json')
const rawDataset = readFileSync(DATA_PATH, 'utf8')

type MutableDataset = {
  datasetVersion?: unknown
  simulated?: unknown
  base?: unknown
  veredas?: Array<Record<string, unknown>>
}

function mutated(change: (dataset: MutableDataset) => void): string {
  const dataset = JSON.parse(rawDataset) as MutableDataset
  change(dataset)
  return JSON.stringify(dataset)
}

function problemsOf(content: string): string {
  try {
    parseVeredasDataset(content)
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidVeredasDatasetError)
    return (error as InvalidVeredasDatasetError).problems.join(' | ')
  }
  throw new Error('Se esperaba InvalidVeredasDatasetError')
}

describe('veredas-catalog', () => {
  it('carga el archivo real con 12 veredas simuladas y su hash SHA-256', () => {
    const dataset = loadVeredasDataset(DATA_PATH)
    expect(dataset.simulated).toBe(true)
    expect(dataset.veredas).toHaveLength(12)
    expect(dataset.datasetHash).toBe(sha256Hex(rawDataset))
    expect(
      dataset.veredas.every((v) => v.nombre.startsWith('Vereda Simulada')),
    ).toBe(true)
  })

  it('resuelve rutas relativas al directorio de trabajo', () => {
    const dataset = loadVeredasDataset('data/veredas.json', process.cwd())
    expect(dataset.sourcePath).toBe(DATA_PATH)
  })

  it('falla si el archivo no existe', () => {
    expect(() => loadVeredasDataset('data/no-existe.json')).toThrow(
      'no se pudo leer el archivo',
    )
  })

  it('falla con JSON inválido o raíz incorrecta', () => {
    expect(problemsOf('{ no es json')).toContain('no es JSON válido')
    expect(problemsOf('[]')).toContain('la raíz debe ser un objeto')
  })

  it('exige datos simulados y versión', () => {
    const problems = problemsOf(
      mutated((dataset) => {
        dataset.simulated = false
        dataset.datasetVersion = ''
      }),
    )
    expect(problems).toContain('simulated debe ser true')
    expect(problems).toContain('datasetVersion')
  })

  it('valida la base de salida', () => {
    expect(problemsOf(mutated((dataset) => (dataset.base = null)))).toContain(
      'base debe ser un objeto',
    )
    expect(
      problemsOf(
        mutated(
          (dataset) =>
            (dataset.base = { id: '', nombre: 'x', lat: 5, lng: -74 }),
        ),
      ),
    ).toContain('base.id')
  })

  it('valida coordenadas dentro de Cundinamarca e índice entre 0 y 100', () => {
    const problems = problemsOf(
      mutated((dataset) => {
        const [first, second] = dataset.veredas ?? []
        first.lat = 10.4
        first.lng = -75.5
        second.vulnerabilityIndex = 101
        second.provincia = ''
        second.nombre = 7
      }),
    )
    expect(problems).toContain('veredas[0].lat')
    expect(problems).toContain('veredas[0].lng')
    expect(problems).toContain('veredas[1].vulnerabilityIndex')
    expect(problems).toContain('veredas[1].provincia')
    expect(problems).toContain('veredas[1].nombre')
  })

  it('rechaza listas vacías, elementos no objeto e ids repetidos', () => {
    expect(problemsOf(mutated((dataset) => (dataset.veredas = [])))).toContain(
      'al menos un elemento',
    )
    const problems = problemsOf(
      mutated((dataset) => {
        const veredas = dataset.veredas ?? []
        veredas[1].id = veredas[0].id
        veredas.push('texto' as unknown as Record<string, unknown>)
      }),
    )
    expect(problems).toContain('ids de vereda repetidos: VS-01')
    expect(problems).toContain('veredas[12] debe ser un objeto')
  })

  it('expone el dataset y el catálogo público sin índice numérico', () => {
    const catalog = new VeredasCatalogService(parseVeredasDataset(rawDataset))
    expect(catalog.datasetVersion).toBe('2026.11-sim.1')
    expect(catalog.datasetHash).toBe(sha256Hex(rawDataset))
    const publicCatalog = new VeredasService(catalog).listPublicCatalog()
    expect(publicCatalog.veredas).toHaveLength(12)
    expect(JSON.stringify(publicCatalog)).not.toContain('vulnerabilityIndex')
    expect(publicCatalog.veredas[2]).toMatchObject({
      id: 'VS-03',
      priorityBand: PriorityBand.ALTA,
    })
  })
})
