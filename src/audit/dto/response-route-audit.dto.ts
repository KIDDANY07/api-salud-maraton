import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AppRole } from '../../auth/authenticated-user'
import { PageMetaDto } from '../../common/dto/pagination.dto'
import { AuditStatus } from '../entities/route-audit-log.entity'

const FREE_FORM_OBJECT = {
  type: 'object',
  additionalProperties: true,
  nullable: true,
} as const

export class AuditActorDto {
  @ApiProperty({ nullable: true, type: String })
  sub!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'planificador-app' })
  clientId!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'coordinador.demo' })
  username!: string | null

  @ApiProperty({
    enum: AppRole,
    isArray: true,
    description: 'Roles funcionales del actor al momento del intento',
  })
  roles!: string[]
}

export class RouteAuditSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty({
    example: 12,
    description: 'Posición en la cadena de auditoría',
  })
  sequence!: number

  @ApiProperty({ format: 'date-time' })
  timestamp!: string

  @ApiProperty()
  correlationId!: string

  @ApiProperty({ type: AuditActorDto })
  actor!: AuditActorDto

  @ApiProperty({ type: [String] })
  scopes!: string[]

  @ApiProperty({ enum: AuditStatus })
  status!: AuditStatus

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  routeId!: string | null

  @ApiProperty({ example: '1.0.0' })
  algorithmVersion!: string

  @ApiProperty({ example: '2026.11-sim.1' })
  datasetVersion!: string

  @ApiProperty({ description: 'SHA-256 del archivo de veredas usado' })
  datasetHash!: string

  @ApiProperty({ example: 12 })
  durationMs!: number

  @ApiProperty()
  previousHash!: string

  @ApiProperty()
  recordHash!: string
}

export class RecordIntegrityDto {
  @ApiProperty({
    description: 'true si recordHash coincide con el contenido del registro',
  })
  recordHashValid!: boolean

  @ApiProperty({
    description:
      'true si previousHash coincide con el recordHash del registro anterior',
  })
  previousHashValid!: boolean
}

export class RouteAuditDetailDto extends RouteAuditSummaryDto {
  @ApiProperty({
    ...FREE_FORM_OBJECT,
    description: 'Cuerpo recibido tal como llegó',
  })
  receivedParameters!: unknown

  @ApiProperty({
    ...FREE_FORM_OBJECT,
    description:
      'Parámetros aplicados después de completar los valores por defecto',
  })
  appliedParameters!: unknown

  @ApiProperty({
    ...FREE_FORM_OBJECT,
    description: 'Resultado completo de la ruta',
  })
  result!: unknown

  @ApiProperty({
    ...FREE_FORM_OBJECT,
    description:
      'Desglose del cálculo por paso, con todas las candidatas, el índice de vulnerabilidad y los componentes del score',
  })
  scoreBreakdown!: unknown

  @ApiProperty({ ...FREE_FORM_OBJECT })
  errorDetails!: unknown

  @ApiProperty({ type: RecordIntegrityDto })
  integrity!: RecordIntegrityDto
}

export class PaginatedRouteAuditDto {
  @ApiProperty({ type: [RouteAuditSummaryDto] })
  items!: RouteAuditSummaryDto[]

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto
}

export class RouteVerificationDto {
  @ApiProperty({ format: 'uuid' })
  auditId!: string

  @ApiProperty({ format: 'uuid' })
  routeId!: string

  @ApiProperty({
    description: 'true si la ruta recalculada coincide con la original',
  })
  matches!: boolean

  @ApiProperty({ type: [String], description: 'Secciones que difieren' })
  differences!: string[]

  @ApiProperty()
  storedResultHash!: string

  @ApiProperty({ nullable: true, type: String })
  recomputedResultHash!: string | null

  @ApiProperty({ description: 'true si la versión del dataset cambió' })
  datasetVersionChanged!: boolean

  @ApiProperty({ description: 'true si el contenido del dataset cambió' })
  datasetHashChanged!: boolean

  @ApiProperty()
  storedDatasetVersion!: string

  @ApiProperty()
  currentDatasetVersion!: string

  @ApiProperty()
  algorithmVersionChanged!: boolean

  @ApiProperty()
  storedAlgorithmVersion!: string

  @ApiProperty()
  currentAlgorithmVersion!: string

  @ApiPropertyOptional({ nullable: true, type: String })
  recomputationError!: string | null

  @ApiProperty({ type: RecordIntegrityDto })
  integrity!: RecordIntegrityDto

  @ApiProperty()
  message!: string

  @ApiProperty({ format: 'date-time' })
  verifiedAt!: string
}
