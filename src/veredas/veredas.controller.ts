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
import { APP_ROLES, ApiScope } from '../auth/authenticated-user'
import { Roles } from '../auth/decorators/roles.decorator'
import { Scopes } from '../auth/decorators/scopes.decorator'
import { VeredasCatalogResponseDto } from './dto/response-vereda.dto'
import { VeredasService } from './veredas.service'

@ApiTags('Veredas')
@ApiBearerAuth('bearer')
@ApiOAuth2([ApiScope.ROUTES_READ], 'oauth2')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido' })
@ApiForbiddenResponse({
  description: 'Requiere el scope routes:read y un rol funcional',
})
@Controller('veredas')
export class VeredasController {
  constructor(private readonly veredasService: VeredasService) {}

  @Get()
  @Scopes(ApiScope.ROUTES_READ)
  @Roles(...APP_ROLES)
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
