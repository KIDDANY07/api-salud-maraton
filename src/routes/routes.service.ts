import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { DataSource, Repository } from 'typeorm'
import { AuditWriterService } from '../audit/audit-writer.service'
import { AuditStatus } from '../audit/entities/route-audit-log.entity'
import type { AuthenticatedUser } from '../auth/authenticated-user'
import {
  RouteCalculatorService,
  RouteValidationError,
  type RouteComputation,
  type RoutePlan,
} from '../route_engine/route-calculator.service'
import { VeredasCatalogService } from '../veredas/veredas-catalog.service'
import type { CreateRouteDto } from './dto/create-route.dto'
import type { RouteResponseDto } from './dto/response-route.dto'
import { Route } from './entities/route.entity'

export interface RouteRequestContext {
  correlationId: string
  receivedParameters: unknown
  startedAt: number
}

export function buildDisclaimer(datasetVersion: string): string {
  return `Sugerencia generada automáticamente con datos simulados (dataset ${datasetVersion}). No reemplaza el criterio del equipo de salud: requiere revisión y validación humana antes de programar la jornada.`
}

export function toRouteResponse(
  routeId: string,
  generatedAt: Date,
  plan: RoutePlan,
): RouteResponseDto {
  return {
    routeId,
    generatedAt: generatedAt.toISOString(),
    algorithmVersion: plan.algorithmVersion,
    datasetVersion: plan.datasetVersion,
    parameters: plan.parameters,
    base: plan.base,
    stops: plan.stops,
    returnLeg: plan.returnLeg,
    totalDistanceKm: plan.totalDistanceKm,
    notSelected: plan.notSelected,
    comparison: plan.comparison,
    disclaimer: buildDisclaimer(plan.datasetVersion),
  }
}

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name)

  constructor(
    @InjectRepository(Route)
    private readonly routeRepository: Repository<Route>,
    private readonly dataSource: DataSource,
    private readonly calculator: RouteCalculatorService,
    private readonly catalog: VeredasCatalogService,
    private readonly auditWriter: AuditWriterService,
    private readonly config: ConfigService,
  ) {}

  async create(
    dto: CreateRouteDto,
    user: AuthenticatedUser,
    context: RouteRequestContext,
  ): Promise<RouteResponseDto> {
    const dataset = this.catalog.getDataset()
    const computation = this.compute(dto)
    const routeId = randomUUID()
    const generatedAt = new Date()
    await this.dataSource.transaction(async (manager) => {
      await manager.insert(Route, {
        id: routeId,
        generatedAt,
        strategy: computation.plan.parameters.strategy,
        algorithmVersion: computation.plan.algorithmVersion,
        datasetVersion: dataset.datasetVersion,
        datasetHash: dataset.datasetHash,
        parameters: computation.plan.parameters,
        result: computation.plan,
        totalDistanceKm: computation.plan.totalDistanceKm,
        createdBySub: user.sub,
        createdByClientId: user.clientId,
      })
      await this.auditWriter.appendInTransaction(manager, {
        occurredAt: generatedAt,
        correlationId: context.correlationId,
        actor: user,
        status: AuditStatus.SUCCESS,
        routeId,
        receivedParameters: context.receivedParameters,
        appliedParameters: computation.plan.parameters,
        algorithmVersion: computation.plan.algorithmVersion,
        datasetVersion: dataset.datasetVersion,
        datasetHash: dataset.datasetHash,
        result: computation.plan,
        scoreBreakdown: computation.breakdown,
        errorDetails: null,
        durationMs: performance.now() - context.startedAt,
      })
    })
    this.logger.log(
      {
        routeId,
        strategy: computation.plan.parameters.strategy,
        totalDistanceKm: computation.plan.totalDistanceKm,
      },
      'Ruta sugerida generada y auditada',
    )
    return toRouteResponse(routeId, generatedAt, computation.plan)
  }

  async findOne(id: string): Promise<RouteResponseDto> {
    const route = await this.routeRepository.findOneBy({ id })
    if (!route) {
      throw new NotFoundException(`No existe una ruta con id ${id}`)
    }
    return toRouteResponse(route.id, route.generatedAt, route.result)
  }

  private compute(dto: CreateRouteDto): RouteComputation {
    try {
      return this.calculator.calculate(
        this.catalog.getDataset(),
        dto,
        this.config.getOrThrow<number>('ROAD_FACTOR'),
      )
    } catch (error) {
      if (error instanceof RouteValidationError) {
        throw new BadRequestException(error.details)
      }
      throw error
    }
  }
}
