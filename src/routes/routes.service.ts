import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { DataSource, QueryFailedError, Repository } from 'typeorm'
import { AuditWriterService } from '../audit/audit-writer.service'
import { AuditStatus } from '../audit/entities/route-audit-log.entity'
import type { AuthenticatedUser } from '../auth/authenticated-user'
import {
  buildPage,
  resolvePageWindow,
  type Page,
} from '../common/utils/pagination.util'
import {
  RouteCalculatorService,
  RouteValidationError,
  type RouteComputation,
} from '../route_engine/route-calculator.service'
import { VeredasCatalogService } from '../veredas/veredas-catalog.service'
import type { CreateRouteDto } from './dto/create-route.dto'
import type { FilterRouteDto } from './dto/filter-route.dto'
import type {
  RouteActorDto,
  RouteResponseDto,
  RouteReviewDto,
  RouteSummaryDto,
} from './dto/response-route.dto'
import type { ReviewRouteDto } from './dto/review-route.dto'
import { RouteReview, RouteReviewStatus } from './entities/route-review.entity'
import { Route } from './entities/route.entity'

const UNIQUE_VIOLATION = '23505'

export interface RouteRequestContext {
  correlationId: string
  receivedParameters: unknown
  startedAt: number
}

export function buildDisclaimer(datasetVersion: string): string {
  return `Sugerencia generada automáticamente con datos simulados (dataset ${datasetVersion}). No reemplaza el criterio del equipo de salud: requiere revisión y validación humana antes de programar la jornada.`
}

export function creatorOf(route: Route): RouteActorDto {
  return {
    sub: route.createdBySub,
    username: route.createdByUsername,
    clientId: route.createdByClientId,
    roles: [...(route.createdByRoles ?? [])],
  }
}

export function reviewStatusOf(
  review: RouteReview | null | undefined,
): RouteReviewStatus {
  if (!review) {
    return RouteReviewStatus.PENDIENTE_REVISION
  }
  return review.decision as string as RouteReviewStatus
}

export function toReviewDto(
  review: RouteReview | null | undefined,
): RouteReviewDto {
  if (!review) {
    return {
      status: RouteReviewStatus.PENDIENTE_REVISION,
      decision: null,
      observations: null,
      reviewedBy: null,
      reviewedAt: null,
    }
  }
  return {
    status: reviewStatusOf(review),
    decision: review.decision,
    observations: review.observations,
    reviewedBy: {
      sub: review.reviewerSub,
      username: review.reviewerUsername,
      clientId: null,
      roles: [...review.reviewerRoles],
    },
    reviewedAt: review.reviewedAt.toISOString(),
  }
}

export function toRouteResponse(route: Route): RouteResponseDto {
  const plan = route.result
  return {
    routeId: route.id,
    generatedAt: route.generatedAt.toISOString(),
    algorithmVersion: plan.algorithmVersion,
    datasetVersion: plan.datasetVersion,
    parameters: plan.parameters,
    base: plan.base,
    stops: plan.stops,
    returnLeg: plan.returnLeg,
    totalDistanceKm: plan.totalDistanceKm,
    notSelected: plan.notSelected,
    comparison: plan.comparison,
    createdBy: creatorOf(route),
    review: toReviewDto(route.review),
    disclaimer: buildDisclaimer(plan.datasetVersion),
  }
}

export function toRouteSummary(route: Route): RouteSummaryDto {
  return {
    routeId: route.id,
    generatedAt: route.generatedAt.toISOString(),
    strategy: route.result.parameters.strategy,
    visitCount: route.result.parameters.visitCount,
    veredaIds: route.result.stops.map((stop) => stop.veredaId),
    totalDistanceKm: route.totalDistanceKm,
    datasetVersion: route.datasetVersion,
    createdBy: creatorOf(route),
    reviewStatus: reviewStatusOf(route.review),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
  )
}

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name)

  constructor(
    @InjectRepository(Route)
    private readonly routeRepository: Repository<Route>,
    @InjectRepository(RouteReview)
    private readonly reviewRepository: Repository<RouteReview>,
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
    const route = this.routeRepository.create({
      id: randomUUID(),
      generatedAt: new Date(),
      strategy: computation.plan.parameters.strategy,
      algorithmVersion: computation.plan.algorithmVersion,
      datasetVersion: dataset.datasetVersion,
      datasetHash: dataset.datasetHash,
      parameters: computation.plan.parameters,
      result: computation.plan,
      totalDistanceKm: computation.plan.totalDistanceKm,
      createdBySub: user.sub,
      createdByClientId: user.clientId,
      createdByUsername: user.username,
      createdByRoles: [...user.roles],
    })
    await this.dataSource.transaction(async (manager) => {
      await manager.insert(Route, route)
      await this.auditWriter.appendInTransaction(manager, {
        occurredAt: route.generatedAt,
        correlationId: context.correlationId,
        actor: user,
        status: AuditStatus.SUCCESS,
        routeId: route.id,
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
        routeId: route.id,
        strategy: computation.plan.parameters.strategy,
        totalDistanceKm: computation.plan.totalDistanceKm,
      },
      'Ruta sugerida generada y auditada',
    )
    return toRouteResponse({ ...route, review: null })
  }

  async list(filter: FilterRouteDto): Promise<Page<RouteSummaryDto>> {
    const from = filter.from ? new Date(filter.from) : undefined
    const to = filter.to ? new Date(filter.to) : undefined
    if (from && to && from > to) {
      throw new BadRequestException('from debe ser anterior o igual a to')
    }
    const window = resolvePageWindow(filter.page, filter.limit)
    const query = this.routeRepository
      .createQueryBuilder('route')
      .leftJoinAndMapOne(
        'route.review',
        RouteReview,
        'review',
        'review.routeId = route.id',
      )
      .orderBy('route.generatedAt', 'DESC')
      .addOrderBy('route.id', 'ASC')
      .skip(window.skip)
      .take(window.take)
    if (from) {
      query.andWhere('route.generatedAt >= :from', { from })
    }
    if (to) {
      query.andWhere('route.generatedAt <= :to', { to })
    }
    if (filter.strategy) {
      query.andWhere('route.strategy = :strategy', {
        strategy: filter.strategy,
      })
    }
    if (filter.createdBy) {
      query.andWhere(
        '(route.createdBySub = :createdBy OR route.createdByUsername = :createdBy OR route.createdByClientId = :createdBy)',
        { createdBy: filter.createdBy },
      )
    }
    if (filter.reviewStatus === RouteReviewStatus.PENDIENTE_REVISION) {
      query.andWhere('review.id IS NULL')
    } else if (filter.reviewStatus) {
      query.andWhere('review.decision = :decision', {
        decision: filter.reviewStatus,
      })
    }
    const [routes, total] = await query.getManyAndCount()
    return buildPage(
      routes.map((route) => toRouteSummary(route)),
      total,
      window,
    )
  }

  async findOne(id: string): Promise<RouteResponseDto> {
    return toRouteResponse(await this.loadRoute(id))
  }

  async review(
    id: string,
    dto: ReviewRouteDto,
    reviewer: AuthenticatedUser,
    correlationId: string,
  ): Promise<RouteResponseDto> {
    const route = await this.loadRoute(id)
    if (!reviewer.sub) {
      throw new ForbiddenException(
        'El token no identifica a la persona que valida la ruta',
      )
    }
    if (route.createdBySub !== null && route.createdBySub === reviewer.sub) {
      throw new ForbiddenException(
        'Segregación de funciones: no puede validar una ruta que usted mismo generó',
      )
    }
    if (route.review) {
      throw new ConflictException(
        `La ruta ya fue validada con decisión ${route.review.decision}`,
      )
    }
    const review = this.reviewRepository.create({
      id: randomUUID(),
      routeId: route.id,
      decision: dto.decision,
      observations: dto.observations?.length ? dto.observations : null,
      reviewedAt: new Date(),
      reviewerSub: reviewer.sub,
      reviewerUsername: reviewer.username,
      reviewerRoles: [...reviewer.roles],
      correlationId,
    })
    try {
      await this.reviewRepository.insert(review)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('La ruta ya fue validada')
      }
      throw error
    }
    this.logger.log(
      { routeId: route.id, decision: review.decision, reviewer: reviewer.sub },
      'Ruta validada por el equipo de salud',
    )
    return toRouteResponse({ ...route, review })
  }

  private async loadRoute(id: string): Promise<Route> {
    const route = await this.routeRepository
      .createQueryBuilder('route')
      .leftJoinAndMapOne(
        'route.review',
        RouteReview,
        'review',
        'review.routeId = route.id',
      )
      .where('route.id = :id', { id })
      .getOne()
    if (!route) {
      throw new NotFoundException(`No existe una ruta con id ${id}`)
    }
    return route
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
