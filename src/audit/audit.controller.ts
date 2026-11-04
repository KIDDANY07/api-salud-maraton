import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOAuth2,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ApiScope, AppRole } from '../auth/authenticated-user'
import { Roles } from '../auth/decorators/roles.decorator'
import { Scopes } from '../auth/decorators/scopes.decorator'
import { AuditService } from './audit.service'
import { FilterRouteAuditDto } from './dto/filter-route-audit.dto'
import {
  PaginatedRouteAuditDto,
  RouteAuditDetailDto,
  RouteVerificationDto,
} from './dto/response-route-audit.dto'

const AUDIT_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Id del registro de auditoría o routeId de la ruta generada',
}

@ApiTags('Auditoría')
@ApiBearerAuth('bearer')
@ApiOAuth2([ApiScope.AUDIT_READ], 'oauth2')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido' })
@ApiForbiddenResponse({
  description: 'Requiere el rol AUDITOR y el scope audit:read',
})
@Scopes(ApiScope.AUDIT_READ)
@Roles(AppRole.AUDITOR)
@Controller('audit/routes')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista los intentos de generación de rutas',
    description:
      'Registros append-only con filtros por fechas, actor (sub o client_id) y estado, ordenados del más reciente al más antiguo.',
  })
  @ApiOkResponse({ type: PaginatedRouteAuditDto })
  @ApiBadRequestResponse({ description: 'Filtros inválidos' })
  list(@Query() filter: FilterRouteAuditDto): Promise<PaginatedRouteAuditDto> {
    return this.auditService.list(filter)
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de un registro de auditoría',
    description:
      'Incluye parámetros recibidos y aplicados, resultado completo, desglose del score por paso con todas las candidatas y el estado de integridad de la cadena de hashes.',
  })
  @ApiParam(AUDIT_ID_PARAM)
  @ApiOkResponse({ type: RouteAuditDetailDto })
  @ApiNotFoundResponse({ description: 'Registro no encontrado' })
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<RouteAuditDetailDto> {
    return this.auditService.findOne(id)
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recalcula una ruta y la compara con la original',
    description:
      'Usa los parámetros guardados y el dataset actual. Informa si el resultado coincide y si cambió la versión o el contenido del dataset.',
  })
  @ApiParam(AUDIT_ID_PARAM)
  @ApiOkResponse({ type: RouteVerificationDto })
  @ApiNotFoundResponse({ description: 'Registro no encontrado' })
  @ApiConflictResponse({
    description: 'El registro no corresponde a una ruta generada con éxito',
  })
  verify(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<RouteVerificationDto> {
    return this.auditService.verify(id)
  }
}
