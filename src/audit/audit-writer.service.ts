import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { DataSource, EntityManager } from 'typeorm'
import type { AuthenticatedUser } from '../auth/authenticated-user'
import type {
  FailedAttempt,
  FailedAttemptRecorder,
} from '../common/filters/failed-attempt-recorder'
import {
  ALGORITHM_VERSION,
  type AppliedRouteParameters,
  type RoutePlan,
  type RouteScoreBreakdown,
} from '../route_engine/route-calculator.service'
import { VeredasCatalogService } from '../veredas/veredas-catalog.service'
import { AuditChainService, GENESIS_HASH } from './audit-chain.service'
import {
  AuditStatus,
  RouteAuditLog,
  type AuditErrorDetails,
} from './entities/route-audit-log.entity'

export const AUDIT_CHAIN_LOCK_KEY = 7241053201

export interface AuditEntry {
  occurredAt: Date
  correlationId: string
  actor: AuthenticatedUser | undefined
  status: AuditStatus
  routeId: string | null
  receivedParameters: unknown
  appliedParameters: AppliedRouteParameters | null
  algorithmVersion: string
  datasetVersion: string
  datasetHash: string
  result: RoutePlan | null
  scoreBreakdown: RouteScoreBreakdown | null
  errorDetails: AuditErrorDetails | null
  durationMs: number
}

export function toJsonSafe<T>(value: T): T | null {
  if (value === undefined || value === null) {
    return null
  }
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      return null
    }
    return JSON.parse(serialized.replace(/\\u0000/g, '')) as T
  } catch {
    return null
  }
}

@Injectable()
export class AuditWriterService implements FailedAttemptRecorder {
  constructor(
    private readonly dataSource: DataSource,
    private readonly chain: AuditChainService,
    private readonly catalog: VeredasCatalogService,
  ) {}

  async appendInTransaction(
    manager: EntityManager,
    entry: AuditEntry,
  ): Promise<RouteAuditLog> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [
      AUDIT_CHAIN_LOCK_KEY,
    ])
    const rows: Array<{ record_hash: string }> = await manager.query(
      'SELECT record_hash FROM route_audit_logs ORDER BY sequence DESC LIMIT 1',
    )
    const previousHash = rows[0]?.record_hash.trim() ?? GENESIS_HASH
    const record = manager.create(RouteAuditLog, {
      id: randomUUID(),
      occurredAt: entry.occurredAt,
      correlationId: entry.correlationId,
      actorSub: entry.actor?.sub ?? null,
      actorClientId: entry.actor?.clientId ?? null,
      scopes: [...(entry.actor?.scopes ?? [])],
      status: entry.status,
      routeId: entry.routeId,
      receivedParameters: toJsonSafe(entry.receivedParameters as object | null),
      appliedParameters: toJsonSafe(entry.appliedParameters),
      algorithmVersion: entry.algorithmVersion,
      datasetVersion: entry.datasetVersion,
      datasetHash: entry.datasetHash,
      result: toJsonSafe(entry.result),
      scoreBreakdown: toJsonSafe(entry.scoreBreakdown),
      errorDetails: toJsonSafe(entry.errorDetails),
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      previousHash,
    })
    record.recordHash = this.chain.computeRecordHash(record)
    await manager.insert(RouteAuditLog, record)
    return record
  }

  async recordFailedAttempt(attempt: FailedAttempt): Promise<void> {
    const status =
      attempt.status === 'FORBIDDEN'
        ? AuditStatus.FORBIDDEN
        : AuditStatus.VALIDATION_ERROR
    await this.dataSource.transaction((manager) =>
      this.appendInTransaction(manager, {
        occurredAt: new Date(),
        correlationId: attempt.correlationId,
        actor: attempt.user,
        status,
        routeId: null,
        receivedParameters: attempt.receivedParameters,
        appliedParameters: null,
        algorithmVersion: ALGORITHM_VERSION,
        datasetVersion: this.catalog.datasetVersion,
        datasetHash: this.catalog.datasetHash,
        result: null,
        scoreBreakdown: null,
        errorDetails: attempt.errorDetails,
        durationMs: attempt.durationMs,
      }),
    )
  }
}
