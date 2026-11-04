import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { LessThan, Repository } from 'typeorm'
import { canonicalHash, canonicalJson } from '../common/utils/hash.util'
import {
  buildPage,
  resolvePageWindow,
  type Page,
} from '../common/utils/pagination.util'
import {
  ALGORITHM_VERSION,
  RouteCalculatorService,
  RouteValidationError,
  type RouteComputation,
  type RoutePlan,
  type RouteScoreBreakdown,
} from '../route_engine/route-calculator.service'
import { VeredasCatalogService } from '../veredas/veredas-catalog.service'
import {
  AuditChainService,
  GENESIS_HASH,
  type RecordIntegrity,
} from './audit-chain.service'
import type { FilterRouteAuditDto } from './dto/filter-route-audit.dto'
import type {
  RouteAuditDetailDto,
  RouteAuditSummaryDto,
  RouteVerificationDto,
} from './dto/response-route-audit.dto'
import { AuditStatus, RouteAuditLog } from './entities/route-audit-log.entity'

type ComparableSections = Record<string, unknown>

function comparableSections(
  plan: RoutePlan,
  breakdown: RouteScoreBreakdown | null,
): ComparableSections {
  return {
    parameters: plan.parameters,
    base: plan.base,
    stops: plan.stops,
    returnLeg: plan.returnLeg,
    totalDistanceKm: plan.totalDistanceKm,
    notSelected: plan.notSelected,
    comparison: plan.comparison,
    breakdownCandidates: breakdown?.candidates ?? null,
    breakdownSteps: breakdown?.steps ?? null,
    breakdownComparisonSteps: breakdown?.comparison.steps ?? null,
  }
}

function differingSections(
  stored: ComparableSections,
  recomputed: ComparableSections,
): string[] {
  return Object.keys(stored).filter(
    (key) => canonicalJson(stored[key]) !== canonicalJson(recomputed[key]),
  )
}

function verificationMessage(
  matches: boolean,
  datasetChanged: boolean,
  storedVersion: string,
  currentVersion: string,
): string {
  const datasetNote = `el dataset cambió de ${storedVersion} a ${currentVersion}`
  if (matches && !datasetChanged) {
    return 'La ruta recalculada coincide con la original.'
  }
  if (matches) {
    return `La ruta recalculada coincide con la original, aunque ${datasetNote}.`
  }
  if (datasetChanged) {
    return `La ruta recalculada no coincide con la original; ${datasetNote}, lo que puede explicar la diferencia.`
  }
  return 'La ruta recalculada no coincide con la original usando el mismo dataset: revise la integridad del registro o cambios en el algoritmo.'
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(
    @InjectRepository(RouteAuditLog)
    private readonly auditRepository: Repository<RouteAuditLog>,
    private readonly chain: AuditChainService,
    private readonly calculator: RouteCalculatorService,
    private readonly catalog: VeredasCatalogService,
  ) {}

  async list(filter: FilterRouteAuditDto): Promise<Page<RouteAuditSummaryDto>> {
    const from = filter.from ? new Date(filter.from) : undefined
    const to = filter.to ? new Date(filter.to) : undefined
    if (from && to && from > to) {
      throw new BadRequestException('from debe ser anterior o igual a to')
    }
    const window = resolvePageWindow(filter.page, filter.limit)
    const query = this.auditRepository
      .createQueryBuilder('audit')
      .orderBy('audit.sequence', 'DESC')
      .skip(window.skip)
      .take(window.take)
    if (from) {
      query.andWhere('audit.occurredAt >= :from', { from })
    }
    if (to) {
      query.andWhere('audit.occurredAt <= :to', { to })
    }
    if (filter.status) {
      query.andWhere('audit.status = :status', { status: filter.status })
    }
    if (filter.actor) {
      query.andWhere(
        '(audit.actorSub = :actor OR audit.actorClientId = :actor)',
        { actor: filter.actor },
      )
    }
    const [records, total] = await query.getManyAndCount()
    return buildPage(
      records.map((record) => this.toSummary(record)),
      total,
      window,
    )
  }

  async findOne(id: string): Promise<RouteAuditDetailDto> {
    const record = await this.findRecord(id)
    return {
      ...this.toSummary(record),
      receivedParameters: record.receivedParameters ?? null,
      appliedParameters: record.appliedParameters,
      result: record.result,
      scoreBreakdown: record.scoreBreakdown,
      errorDetails: record.errorDetails,
      integrity: await this.checkIntegrity(record),
    }
  }

  async verify(id: string): Promise<RouteVerificationDto> {
    const record = await this.findRecord(id)
    if (
      record.status !== AuditStatus.SUCCESS ||
      !record.routeId ||
      !record.appliedParameters ||
      !record.result
    ) {
      throw new ConflictException(
        'Solo se pueden verificar registros de auditoría con estado SUCCESS',
      )
    }
    const dataset = this.catalog.getDataset()
    const stored = comparableSections(record.result, record.scoreBreakdown)
    const { roadFactor, ...parameters } = record.appliedParameters
    let recomputed: RouteComputation | null = null
    let recomputationError: string | null = null
    try {
      recomputed = this.calculator.calculate(dataset, parameters, roadFactor)
    } catch (error) {
      if (!(error instanceof RouteValidationError)) {
        throw error
      }
      recomputationError = error.message
    }
    const recomputedSections = recomputed
      ? comparableSections(recomputed.plan, recomputed.breakdown)
      : null
    const differences = recomputedSections
      ? differingSections(stored, recomputedSections)
      : ['parameters']
    const matches = recomputedSections !== null && differences.length === 0
    const datasetVersionChanged =
      record.datasetVersion !== dataset.datasetVersion
    const datasetHashChanged = record.datasetHash.trim() !== dataset.datasetHash
    this.logger.log(
      { auditId: record.id, routeId: record.routeId, matches },
      'Verificación de ruta completada',
    )
    return {
      auditId: record.id,
      routeId: record.routeId,
      matches,
      differences,
      storedResultHash: canonicalHash(stored),
      recomputedResultHash: recomputedSections
        ? canonicalHash(recomputedSections)
        : null,
      datasetVersionChanged,
      datasetHashChanged,
      storedDatasetVersion: record.datasetVersion,
      currentDatasetVersion: dataset.datasetVersion,
      algorithmVersionChanged: record.algorithmVersion !== ALGORITHM_VERSION,
      storedAlgorithmVersion: record.algorithmVersion,
      currentAlgorithmVersion: ALGORITHM_VERSION,
      recomputationError,
      integrity: await this.checkIntegrity(record),
      message: verificationMessage(
        matches,
        datasetVersionChanged || datasetHashChanged,
        record.datasetVersion,
        dataset.datasetVersion,
      ),
      verifiedAt: new Date().toISOString(),
    }
  }

  private async findRecord(id: string): Promise<RouteAuditLog> {
    const record = await this.auditRepository.findOne({
      where: [{ id }, { routeId: id }],
      order: { sequence: 'ASC' },
    })
    if (!record) {
      throw new NotFoundException(
        `No existe un registro de auditoría para el id ${id}`,
      )
    }
    return record
  }

  private async checkIntegrity(
    record: RouteAuditLog,
  ): Promise<RecordIntegrity> {
    const predecessor = await this.auditRepository.findOne({
      where: { sequence: LessThan(record.sequence) },
      order: { sequence: 'DESC' },
      select: { id: true, recordHash: true },
    })
    return this.chain.checkRecord(
      record,
      predecessor?.recordHash ?? GENESIS_HASH,
    )
  }

  private toSummary(record: RouteAuditLog): RouteAuditSummaryDto {
    return {
      id: record.id,
      sequence: Number(record.sequence),
      timestamp: record.occurredAt.toISOString(),
      correlationId: record.correlationId,
      actor: { sub: record.actorSub, clientId: record.actorClientId },
      scopes: record.scopes,
      status: record.status,
      routeId: record.routeId,
      algorithmVersion: record.algorithmVersion,
      datasetVersion: record.datasetVersion,
      datasetHash: record.datasetHash.trim(),
      durationMs: record.durationMs,
      previousHash: record.previousHash.trim(),
      recordHash: record.recordHash.trim(),
    }
  }
}
