import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { ApiScope, type AuthenticatedUser } from '../auth/authenticated-user'
import { GetUser } from '../auth/decorators/get-user.decorator'
import { Scopes } from '../auth/decorators/scopes.decorator'
import type { RequestWithContext } from '../common/filters/failed-attempt-recorder'
import { correlationIdOf } from '../common/utils/correlation-id.util'
import { CreateRouteDto } from './dto/create-route.dto'
import { RouteResponseDto } from './dto/response-route.dto'
import { RoutesService } from './routes.service'

@ApiTags('Rutas')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido' })
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Scopes(ApiScope.ROUTES_WRITE)
  @ApiOAuth2([ApiScope.ROUTES_WRITE], 'oauth2')
  @ApiOperation({
    summary: 'Genera una ruta sugerida para la jornada',
    description:
      'Calcula el orden de visita con la estrategia elegida y la compara con NEAREST_NEIGHBOR. Cada intento, exitoso o rechazado, queda en la auditoría append-only. El resultado es una sugerencia que requiere validación humana.',
  })
  @ApiCreatedResponse({ type: RouteResponseDto })
  @ApiBadRequestResponse({ description: 'Parámetros inválidos' })
  @ApiForbiddenResponse({
    description: 'El token no tiene el scope routes:write',
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

  @Get(':id')
  @Scopes(ApiScope.ROUTES_READ)
  @ApiOAuth2([ApiScope.ROUTES_READ], 'oauth2')
  @ApiOperation({ summary: 'Consulta una ruta generada' })
  @ApiOkResponse({ type: RouteResponseDto })
  @ApiNotFoundResponse({ description: 'Ruta no encontrada' })
  @ApiForbiddenResponse({
    description: 'El token no tiene el scope routes:read',
  })
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<RouteResponseDto> {
    return this.routesService.findOne(id)
  }
}
