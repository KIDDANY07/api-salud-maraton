import { Controller, Get } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOAuth2,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ApiScope } from '../auth/authenticated-user'
import { Scopes } from '../auth/decorators/scopes.decorator'
import { VeredasCatalogResponseDto } from './dto/response-vereda.dto'
import { VeredasService } from './veredas.service'

@ApiTags('Veredas')
@ApiBearerAuth('bearer')
@ApiOAuth2([ApiScope.ROUTES_READ], 'oauth2')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido' })
@ApiForbiddenResponse({ description: 'El token no tiene el scope routes:read' })
@Controller('veredas')
export class VeredasController {
  constructor(private readonly veredasService: VeredasService) {}

  @Get()
  @Scopes(ApiScope.ROUTES_READ)
  @ApiOperation({
    summary: 'Catálogo de veredas simuladas',
    description:
      'Devuelve la base de salida y las veredas con su banda de prioridad. No expone el índice numérico de vulnerabilidad.',
  })
  @ApiOkResponse({ type: VeredasCatalogResponseDto })
  list(): VeredasCatalogResponseDto {
    return this.veredasService.listPublicCatalog()
  }
}
