import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOAuth2,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { performance } from 'node:perf_hooks'
import {
  APP_ROLES,
  ApiScope,
  AppRole,
  type AuthenticatedUser,
} from '../auth/authenticated-user'
import { GetUser } from '../auth/decorators/get-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Scopes } from '../auth/decorators/scopes.decorator'
import type { RequestWithContext } from '../common/filters/failed-attempt-recorder'
import { correlationIdOf } from '../common/utils/correlation-id.util'
import { CreateRouteDto } from './dto/create-route.dto'
import { FilterRouteDto } from './dto/filter-route.dto'
import { PaginatedRoutesDto, RouteResponseDto } from './dto/response-route.dto'
import { ReviewRouteDto } from './dto/review-route.dto'
import { RoutesService } from './routes.service'

const ROUTE_ID_PIPE = new ParseUUIDPipe({ version: '4' })

@ApiTags('Rutas')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido' })
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Scopes(ApiScope.ROUTES_WRITE)
  @Roles(AppRole.COORDINADOR)
  @ApiOAuth2([ApiScope.ROUTES_WRITE], 'oauth2')
  @ApiOperation({
    summary: 'Genera una ruta sugerida para la jornada',
    description:
      'Solo COORDINADOR con scope routes:write. Calcula el orden de visita con la estrategia elegida y la compara con NEAREST_NEIGHBOR. Cada intento, exitoso o rechazado, queda en la auditoría append-only. La ruta nace en estado PENDIENTE_REVISION y requiere validación humana.',
  })
  @ApiCreatedResponse({ type: RouteResponseDto })
  @ApiBadRequestResponse({ description: 'Parámetros inválidos' })
  @ApiForbiddenResponse({
    description: 'Requiere el rol COORDINADOR y el scope routes:write',
  })
  create(
    @Body() dto: CreateRouteDto,
    @GetUser() user: AuthenticatedUser,
    @Req() request: RequestWithContext,
  ): Promise<RouteResponseDto> {
    return this.routesService.create(dto, user, {
      correlationId: correlationIdOf(request),
      receivedParameters: request.body as unknown,
      startedAt: request.routeGenerationAttempt?.startedAt ?? performance.now(),
    })
  }

  @Get()
  @Scopes(ApiScope.ROUTES_READ)
  @Roles(...APP_ROLES)
  @ApiOAuth2([ApiScope.ROUTES_READ], 'oauth2')
  @ApiOperation({
    summary: 'Lista las rutas generadas',
    description:
      'Filtra por fechas, estrategia, estado de revisión y autor, con paginación. Útil para que el equipo de salud vea las rutas pendientes de validar.',
  })
  @ApiOkResponse({ type: PaginatedRoutesDto })
  @ApiBadRequestResponse({ description: 'Filtros inválidos' })
  @ApiForbiddenResponse({
    description: 'Requiere el scope routes:read y un rol funcional',
  })
  list(@Query() filter: FilterRouteDto): Promise<PaginatedRoutesDto> {
    return this.routesService.list(filter)
  }

  @Get(':id')
  @Scopes(ApiScope.ROUTES_READ)
  @Roles(...APP_ROLES)
  @ApiOAuth2([ApiScope.ROUTES_READ], 'oauth2')
  @ApiOperation({ summary: 'Consulta una ruta generada y su validación' })
  @ApiOkResponse({ type: RouteResponseDto })
  @ApiNotFoundResponse({ description: 'Ruta no encontrada' })
  @ApiForbiddenResponse({
    description: 'Requiere el scope routes:read y un rol funcional',
  })
  findOne(@Param('id', ROUTE_ID_PIPE) id: string): Promise<RouteResponseDto> {
    return this.routesService.findOne(id)
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.CREATED)
  @Scopes(ApiScope.ROUTES_REVIEW)
  @Roles(AppRole.EQUIPO_SALUD)
  @ApiOAuth2([ApiScope.ROUTES_REVIEW], 'oauth2')
  @ApiOperation({
    summary: 'Registra la validación humana de una ruta',
    description:
      'Solo EQUIPO_SALUD con scope routes:review. La decisión es definitiva (tabla append-only). Quien generó la ruta no puede validarla.',
  })
  @ApiCreatedResponse({ type: RouteResponseDto })
  @ApiBadRequestResponse({
    description: 'Decisión inválida o rechazo sin observaciones',
  })
  @ApiForbiddenResponse({
    description:
      'Requiere el rol EQUIPO_SALUD y el scope routes:review, y no haber generado la ruta',
  })
  @ApiNotFoundResponse({ description: 'Ruta no encontrada' })
  @ApiConflictResponse({ description: 'La ruta ya fue validada' })
  review(
    @Param('id', ROUTE_ID_PIPE) id: string,
    @Body() dto: ReviewRouteDto,
    @GetUser() user: AuthenticatedUser,
    @Req() request: RequestWithContext,
  ): Promise<RouteResponseDto> {
    return this.routesService.review(id, dto, user, correlationIdOf(request))
  }
}
