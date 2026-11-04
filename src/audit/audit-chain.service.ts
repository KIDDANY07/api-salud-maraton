import { Injectable } from '@nestjs/common'
import { canonicalHash } from '../common/utils/hash.util'
import type { RouteAuditLog } from './entities/route-audit-log.entity'

export const GENESIS_HASH = '0'.repeat(64)

export type HashableAuditRecord = Omit<RouteAuditLog, 'sequence' | 'recordHash'>

export type ChainRecord = HashableAuditRecord & { recordHash: string }

export interface ChainVerification {
  valid: boolean
  checkedRecords: number
  firstInvalidRecordId: string | null
  reason: string | null
}

export interface RecordIntegrity {
  recordHashValid: boolean
  previousHashValid: boolean
}

function actorIdentityFields(
  record: HashableAuditRecord,
): Record<string, unknown> {
  if (record.actorRoles === null || record.actorRoles === undefined) {
    return {}
  }
  return {
    actorUsername: record.actorUsername ?? null,
    actorRoles: [...record.actorRoles],
  }
}

function toHashPayload(record: HashableAuditRecord): Record<string, unknown> {
  return {
    ...actorIdentityFields(record),
    id: record.id,
    occurredAt: new Date(record.occurredAt).toISOString(),
    correlationId: record.correlationId,
    actorSub: record.actorSub,
    actorClientId: record.actorClientId,
    scopes: [...record.scopes],
    status: record.status,
    routeId: record.routeId,
    receivedParameters: record.receivedParameters ?? null,
    appliedParameters: record.appliedParameters,
    algorithmVersion: record.algorithmVersion,
    datasetVersion: record.datasetVersion,
    datasetHash: record.datasetHash.trim(),
    result: record.result,
    scoreBreakdown: record.scoreBreakdown,
    errorDetails: record.errorDetails,
    durationMs: record.durationMs,
    previousHash: record.previousHash.trim(),
  }
}

@Injectable()
export class AuditChainService {
  computeRecordHash(record: HashableAuditRecord): string {
    return canonicalHash(toHashPayload(record))
  }

  checkRecord(
    record: ChainRecord,
    expectedPreviousHash: string,
  ): RecordIntegrity {
    return {
      recordHashValid:
        this.computeRecordHash(record) === record.recordHash.trim(),
      previousHashValid:
        record.previousHash.trim() === expectedPreviousHash.trim(),
    }
  }

  verifyChain(records: readonly ChainRecord[]): ChainVerification {
    let expectedPreviousHash = GENESIS_HASH
    for (const [index, record] of records.entries()) {
      const integrity = this.checkRecord(record, expectedPreviousHash)
      if (!integrity.previousHashValid) {
        return {
          valid: false,
          checkedRecords: index + 1,
          firstInvalidRecordId: record.id,
          reason:
            'previousHash no coincide con el recordHash del registro anterior',
        }
      }
      if (!integrity.recordHashValid) {
        return {
          valid: false,
          checkedRecords: index + 1,
          firstInvalidRecordId: record.id,
          reason: 'recordHash no coincide con el contenido del registro',
        }
      }
      expectedPreviousHash = record.recordHash
    }
    return {
      valid: true,
      checkedRecords: records.length,
      firstInvalidRecordId: null,
      reason: null,
    }
  }
}
