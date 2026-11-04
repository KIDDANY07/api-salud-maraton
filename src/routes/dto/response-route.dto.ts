import { ApiProperty } from '@nestjs/swagger'
import { AppRole } from '../../auth/authenticated-user'
import { PageMetaDto } from '../../common/dto/pagination.dto'
import { PriorityBand } from '../../common/utils/priority-band.util'
import { RouteStrategyName } from '../../route_engine/strategies/route-strategy.interface'
import { BasePlaceDto } from '../../veredas/dto/response-vereda.dto'
import {
  ReviewDecision,
  RouteReviewStatus,
} from '../entities/route-review.entity'

export class RouteActorDto {
  @ApiProperty({ nullable: true, type: String })
  sub!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'coordinador.demo' })
  username!: string | null

  @ApiProperty({ nullable: true, type: String, example: 'rural-routes-web' })
  clientId!: string | null

  @ApiProperty({ enum: AppRole, isArray: true })
  roles!: string[]
}

export class RouteReviewDto {
  @ApiProperty({ enum: RouteReviewStatus })
  status!: RouteReviewStatus

  @ApiProperty({ enum: ReviewDecision, nullable: true })
  decision!: ReviewDecision | null

  @ApiProperty({ nullable: true, type: String })
  observations!: string | null

  @ApiProperty({ type: RouteActorDto, nullable: true })
  reviewedBy!: RouteActorDto | null

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  reviewedAt!: string | null
}

export class AppliedParametersDto {
  @ApiProperty({ enum: RouteStrategyName })
  strategy!: RouteStrategyName

  @ApiProperty({ example: 5 })
  visitCount!: number

  @ApiProperty({ example: 0.6 })
  alpha!: number

  @ApiProperty({ example: true })
  returnToBase!: boolean

  @ApiProperty({ type: [String], example: [] })
  excludedVeredaIds!: string[]

  @ApiProperty({
    example: 1.3,
    description:
      'Factor aplicado a la distancia Haversine para aproximar la distancia por vía',
  })
  roadFactor!: number
}

export class RouteStopDto {
  @ApiProperty({ example: 1 })
  order!: number

  @ApiProperty({ example: 'VS-01' })
  veredaId!: string

  @ApiProperty({ example: 'Vereda Simulada 01' })
  nombre!: string

  @ApiProperty({ example: 'Rionegro' })
  provincia!: string

  @ApiProperty({ example: 6.463, description: 'Distancia del tramo en km' })
  legKm!: number

  @ApiProperty({ example: 6.463, description: 'Kilómetros acumulados' })
  cumulativeKm!: number

  @ApiProperty({ enum: PriorityBand })
  priorityBand!: PriorityBand

  @ApiProperty({ description: 'Motivo de la selección en lenguaje claro' })
  reason!: string
}

export class ReturnLegDto {
  @ApiProperty({ example: 'VS-05' })
  fromVeredaId!: string

  @ApiProperty({ example: 'BASE-SIM-01' })
  toBaseId!: string

  @ApiProperty({ example: 18.2 })
  legKm!: number

  @ApiProperty({ example: 95.4 })
  cumulativeKm!: number
}

export class NotSelectedVeredaDto {
  @ApiProperty({ example: 'VS-12' })
  veredaId!: string

  @ApiProperty({ example: 'Vereda Simulada 12' })
  nombre!: string

  @ApiProperty({ example: 'Rionegro' })
  provincia!: string

  @ApiProperty({ enum: PriorityBand })
  priorityBand!: PriorityBand

  @ApiProperty({ description: 'true si fue excluida en la solicitud' })
  excluded!: boolean

  @ApiProperty({ description: 'Motivo por el que no se incluyó' })
  reason!: string
}

export class ComparisonStopDto {
  @ApiProperty({ example: 1 })
  order!: number

  @ApiProperty({ example: 'VS-01' })
  veredaId!: string

  @ApiProperty({ example: 'Vereda Simulada 01' })
  nombre!: string
}

export class StrategyComparisonDto {
  @ApiProperty({
    enum: RouteStrategyName,
    example: RouteStrategyName.NEAREST_NEIGHBOR,
  })
  strategy!: RouteStrategyName

  @ApiProperty({ example: 80.1 })
  totalDistanceKm!: number

  @ApiProperty({ type: [String] })
  selectedVeredaIds!: string[]

  @ApiProperty({ type: [ComparisonStopDto] })
  selectedVeredas!: ComparisonStopDto[]

  @ApiProperty({
    example: 15.3,
    description:
      'Distancia de la ruta sugerida menos la distancia de NEAREST_NEIGHBOR',
  })
  distanceDifferenceKm!: number

  @ApiProperty({
    description: 'true si ambas estrategias eligen las mismas veredas',
  })
  sameSelection!: boolean

  @ApiProperty({
    description: 'true si ambas estrategias producen el mismo orden',
  })
  sameOrder!: boolean
}

export class RouteResponseDto {
  @ApiProperty({ format: 'uuid' })
  routeId!: string

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string

  @ApiProperty({ example: '1.0.0' })
  algorithmVersion!: string

  @ApiProperty({ example: '2026.11-sim.1' })
  datasetVersion!: string

  @ApiProperty({ type: AppliedParametersDto })
  parameters!: AppliedParametersDto

  @ApiProperty({ type: BasePlaceDto })
  base!: BasePlaceDto

  @ApiProperty({ type: [RouteStopDto] })
  stops!: RouteStopDto[]

  @ApiProperty({ type: ReturnLegDto, nullable: true })
  returnLeg!: ReturnLegDto | null

  @ApiProperty({ example: 95.4 })
  totalDistanceKm!: number

  @ApiProperty({ type: [NotSelectedVeredaDto] })
  notSelected!: NotSelectedVeredaDto[]

  @ApiProperty({ type: StrategyComparisonDto })
  comparison!: StrategyComparisonDto

  @ApiProperty({ type: RouteActorDto })
  createdBy!: RouteActorDto

  @ApiProperty({
    type: RouteReviewDto,
    description:
      'Estado de la validación humana. Una ruta PENDIENTE_REVISION aún no debe programarse.',
  })
  review!: RouteReviewDto

  @ApiProperty({
    description:
      'Advertencia: sugerencia basada en datos simulados que requiere validación humana',
  })
  disclaimer!: string
}

export class RouteSummaryDto {
  @ApiProperty({ format: 'uuid' })
  routeId!: string

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string

  @ApiProperty({ enum: RouteStrategyName })
  strategy!: RouteStrategyName

  @ApiProperty({ example: 5 })
  visitCount!: number

  @ApiProperty({ type: [String], example: ['VS-03', 'VS-01'] })
  veredaIds!: string[]

  @ApiProperty({ example: 83.018 })
  totalDistanceKm!: number

  @ApiProperty({ example: '2026.11-sim.1' })
  datasetVersion!: string

  @ApiProperty({ type: RouteActorDto })
  createdBy!: RouteActorDto

  @ApiProperty({ enum: RouteReviewStatus })
  reviewStatus!: RouteReviewStatus
}

export class PaginatedRoutesDto {
  @ApiProperty({ type: [RouteSummaryDto] })
  items!: RouteSummaryDto[]

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto
}
