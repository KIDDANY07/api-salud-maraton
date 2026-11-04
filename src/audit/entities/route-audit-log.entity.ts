import { Column, Entity, PrimaryColumn } from 'typeorm'
import type {
  AppliedRouteParameters,
  RoutePlan,
  RouteScoreBreakdown,
} from '../../route_engine/route-calculator.service'

export enum AuditStatus {
  SUCCESS = 'SUCCESS',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  FORBIDDEN = 'FORBIDDEN',
}

export interface AuditErrorDetails {
  statusCode: number
  message: string | string[]
}

@Entity({ name: 'route_audit_logs' })
export class RouteAuditLog {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'bigint', insert: false, update: false })
  sequence!: string

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date

  @Column({ name: 'correlation_id', type: 'varchar', length: 100 })
  correlationId!: string

  @Column({ name: 'actor_sub', type: 'varchar', length: 255, nullable: true })
  actorSub!: string | null

  @Column({
    name: 'actor_client_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  actorClientId!: string | null

  @Column({
    name: 'actor_username',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  actorUsername!: string | null

  @Column({ name: 'actor_roles', type: 'text', array: true, nullable: true })
  actorRoles!: string[] | null

  @Column({ type: 'text', array: true })
  scopes!: string[]

  @Column({ type: 'varchar', length: 20 })
  status!: AuditStatus

  @Column({ name: 'route_id', type: 'uuid', nullable: true })
  routeId!: string | null

  @Column({ name: 'received_parameters', type: 'jsonb', nullable: true })
  receivedParameters!: object | null

  @Column({ name: 'applied_parameters', type: 'jsonb', nullable: true })
  appliedParameters!: AppliedRouteParameters | null

  @Column({ name: 'algorithm_version', type: 'varchar', length: 20 })
  algorithmVersion!: string

  @Column({ name: 'dataset_version', type: 'varchar', length: 50 })
  datasetVersion!: string

  @Column({ name: 'dataset_hash', type: 'char', length: 64 })
  datasetHash!: string

  @Column({ type: 'jsonb', nullable: true })
  result!: RoutePlan | null

  @Column({ name: 'score_breakdown', type: 'jsonb', nullable: true })
  scoreBreakdown!: RouteScoreBreakdown | null

  @Column({ name: 'error_details', type: 'jsonb', nullable: true })
  errorDetails!: AuditErrorDetails | null

  @Column({ name: 'duration_ms', type: 'integer' })
  durationMs!: number

  @Column({ name: 'previous_hash', type: 'char', length: 64 })
  previousHash!: string

  @Column({ name: 'record_hash', type: 'char', length: 64 })
  recordHash!: string
}
