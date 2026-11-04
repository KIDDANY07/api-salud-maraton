import {
  AuditChainService,
  GENESIS_HASH,
  type ChainRecord,
  type HashableAuditRecord,
} from './audit-chain.service'
import { toJsonSafe } from './audit-writer.service'
import { AuditStatus } from './entities/route-audit-log.entity'

const chain = new AuditChainService()

function draft(
  index: number,
  previousHash: string,
  overrides: Partial<HashableAuditRecord> = {},
): HashableAuditRecord {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    occurredAt: new Date(`2026-11-04T10:0${index}:00.000Z`),
    correlationId: `corr-${index}-abcdef`,
    actorSub: `sub-${index}`,
    actorClientId: 'planificador-app',
    actorUsername: `coordinador-${index}`,
    actorRoles: ['COORDINADOR'],
    scopes: ['routes:read', 'routes:write'],
    status: AuditStatus.SUCCESS,
    routeId: `10000000-0000-4000-8000-00000000000${index}`,
    receivedParameters: { visitCount: 5 },
    appliedParameters: null,
    algorithmVersion: '1.0.0',
    datasetVersion: '2026.11-sim.1',
    datasetHash: 'a'.repeat(64),
    result: null,
    scoreBreakdown: null,
    errorDetails: null,
    durationMs: 10 + index,
    previousHash,
    ...overrides,
  }
}

function buildChain(length: number): ChainRecord[] {
  const records: ChainRecord[] = []
  let previousHash = GENESIS_HASH
  for (let index = 1; index <= length; index += 1) {
    const record = draft(index, previousHash)
    const recordHash = chain.computeRecordHash(record)
    records.push({ ...record, recordHash })
    previousHash = recordHash
  }
  return records
}

describe('AuditChainService', () => {
  it('incluye usuario y roles del actor en el hash de los registros nuevos', () => {
    const record = draft(1, GENESIS_HASH)
    const original = chain.computeRecordHash(record)
    expect(
      chain.computeRecordHash({ ...record, actorRoles: ['AUDITOR'] }),
    ).not.toBe(original)
    expect(
      chain.computeRecordHash({ ...record, actorUsername: 'otra-persona' }),
    ).not.toBe(original)
  })

  it('mantiene el hash de los registros anteriores a los roles', () => {
    const legacy = draft(1, GENESIS_HASH, {
      actorUsername: null,
      actorRoles: null,
    })
    const hash = chain.computeRecordHash(legacy)
    expect(
      chain.computeRecordHash({ ...legacy, actorUsername: 'ignorado' }),
    ).toBe(hash)
    expect(hash).not.toBe(chain.computeRecordHash(draft(1, GENESIS_HASH)))
  })

  it('usa un hash génesis de 64 ceros', () => {
    expect(GENESIS_HASH).toMatch(/^0{64}$/)
  })

  it('calcula un SHA-256 hexadecimal determinista', () => {
    const record = draft(1, GENESIS_HASH)
    const hash = chain.computeRecordHash(record)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(chain.computeRecordHash({ ...record })).toBe(hash)
  })

  it('no depende del orden de las claves ni del tipo de fecha', () => {
    const record = draft(1, GENESIS_HASH, {
      receivedParameters: { alpha: 0.6, visitCount: 5 },
    })
    const reordered = {
      ...record,
      occurredAt: record.occurredAt.toISOString() as unknown as Date,
      receivedParameters: { visitCount: 5, alpha: 0.6 },
    }
    expect(chain.computeRecordHash(reordered)).toBe(
      chain.computeRecordHash(record),
    )
  })

  it('el hash cambia si cambia cualquier campo, incluido previousHash', () => {
    const record = draft(1, GENESIS_HASH)
    const original = chain.computeRecordHash(record)
    expect(chain.computeRecordHash({ ...record, durationMs: 99 })).not.toBe(
      original,
    )
    expect(
      chain.computeRecordHash({ ...record, status: AuditStatus.FORBIDDEN }),
    ).not.toBe(original)
    expect(
      chain.computeRecordHash({ ...record, previousHash: 'f'.repeat(64) }),
    ).not.toBe(original)
  })

  it('valida una cadena íntegra', () => {
    expect(chain.verifyChain(buildChain(4))).toEqual({
      valid: true,
      checkedRecords: 4,
      firstInvalidRecordId: null,
      reason: null,
    })
    expect(chain.verifyChain([]).valid).toBe(true)
  })

  it('detecta un registro alterado', () => {
    const records = buildChain(3)
    records[1] = { ...records[1], durationMs: 1 }
    const verification = chain.verifyChain(records)
    expect(verification.valid).toBe(false)
    expect(verification.firstInvalidRecordId).toBe(records[1].id)
    expect(verification.reason).toContain('recordHash')
  })

  it('detecta un eslabón roto o un registro eliminado', () => {
    const records = buildChain(3)
    const verification = chain.verifyChain([records[0], records[2]])
    expect(verification.valid).toBe(false)
    expect(verification.checkedRecords).toBe(2)
    expect(verification.firstInvalidRecordId).toBe(records[2].id)
    expect(verification.reason).toContain('previousHash')
  })

  it('verifica un registro individual contra su predecesor', () => {
    const [first, second] = buildChain(2)
    expect(chain.checkRecord(second, first.recordHash)).toEqual({
      recordHashValid: true,
      previousHashValid: true,
    })
    expect(chain.checkRecord(second, GENESIS_HASH).previousHashValid).toBe(
      false,
    )
    expect(
      chain.checkRecord({ ...first, recordHash: 'b'.repeat(64) }, GENESIS_HASH)
        .recordHashValid,
    ).toBe(false)
  })
})

describe('toJsonSafe', () => {
  it('normaliza valores para almacenarlos como jsonb', () => {
    expect(toJsonSafe(undefined)).toBeNull()
    expect(toJsonSafe({ a: undefined, b: 'x\u0000y' })).toEqual({ b: 'xy' })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(toJsonSafe(circular)).toBeNull()
  })
})
