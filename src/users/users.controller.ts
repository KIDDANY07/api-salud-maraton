import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOAuth2,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  APP_ROLES,
  ApiScope,
  AppRole,
  type AuthenticatedUser,
} from '../auth/authenticated-user'
import { GetUser } from '../auth/decorators/get-user.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Scopes } from '../auth/decorators/scopes.decorator'
import { ChangePasswordDto } from './dto/change-password.dto'
import { CreateUserDto } from './dto/create-user.dto'
import { FilterUserDto } from './dto/filter-user.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { PaginatedUsersDto, UserResponseDto } from './dto/response-user.dto'
import { UpdateUserRoleDto } from './dto/update-user-role.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UsersService } from './users.service'

const USER_ID_PIPE = new ParseUUIDPipe()

@ApiTags('Usuarios')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido' })
@ApiServiceUnavailableResponse({
  description: 'Keycloak no está disponible',
})
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Put('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...APP_ROLES)
  @ApiOAuth2([], 'oauth2')
  @ApiOperation({
    summary: 'Cambia la contraseña propia',
    description:
      'Disponible para cualquier rol. Verifica la contraseña actual en Keycloak antes de cambiarla.',
  })
  @ApiNoContentResponse({ description: 'Contraseña cambiada' })
  @ApiBadRequestResponse({
    description: 'La contraseña actual no coincide o la nueva no es válida',
  })
  @ApiForbiddenResponse({
    description: 'Cuentas de servicio o tokens sin rol',
  })
  changeOwnPassword(
    @GetUser() actor: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.usersService.changeOwnPassword(actor, dto)
  }

  @Get()
  @Roles(AppRole.ADMIN)
  @Scopes(ApiScope.USERS_MANAGE)
  @ApiOAuth2([ApiScope.USERS_MANAGE], 'oauth2')
  @ApiOperation({
    summary: 'Lista los usuarios',
    description:
      'Solo ADMIN con scope users:manage. Incluye las cuentas con rol funcional y las registradas pendientes de aprobación. Filtra por texto, rol, estado y pendingApproval, con paginación.',
  })
  @ApiOkResponse({ type: PaginatedUsersDto })
  @ApiForbiddenResponse({ description: 'Requiere rol ADMIN y users:manage' })
  list(@Query() filter: FilterUserDto): Promise<PaginatedUsersDto> {
    return this.usersService.list(filter)
  }

  @Get(':id')
  @Roles(AppRole.ADMIN)
  @Scopes(ApiScope.USERS_MANAGE)
  @ApiOAuth2([ApiScope.USERS_MANAGE], 'oauth2')
  @ApiOperation({ summary: 'Consulta un usuario' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'El usuario no existe' })
  @ApiForbiddenResponse({ description: 'Requiere rol ADMIN y users:manage' })
  findOne(@Param('id', USER_ID_PIPE) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id)
  }

  @Post()
  @Roles(AppRole.ADMIN)
  @Scopes(ApiScope.USERS_MANAGE)
  @ApiOAuth2([ApiScope.USERS_MANAGE], 'oauth2')
  @ApiOperation({
    summary: 'Crea un usuario con su rol',
    description:
      'Crea la cuenta en Keycloak con contraseña definitiva y le asigna un rol funcional.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  @ApiConflictResponse({ description: 'El usuario o el correo ya existen' })
  @ApiForbiddenResponse({ description: 'Requiere rol ADMIN y users:manage' })
  create(
    @Body() dto: CreateUserDto,
    @GetUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.create(dto, actor)
  }

  @Patch(':id')
  @Roles(AppRole.ADMIN)
  @Scopes(ApiScope.USERS_MANAGE)
  @ApiOAuth2([ApiScope.USERS_MANAGE], 'oauth2')
  @ApiOperation({
    summary: 'Actualiza datos o habilita y deshabilita un usuario',
    description:
      'Deshabilitar una cuenta cierra todas sus sesiones. Un administrador no puede deshabilitarse a sí mismo.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'El usuario no existe' })
  @ApiConflictResponse({
    description: 'Intento de deshabilitar la propia cuenta o correo repetido',
  })
  @ApiForbiddenResponse({ description: 'Requiere rol ADMIN y users:manage' })
  update(
    @Param('id', USER_ID_PIPE) id: string,
    @Body() dto: UpdateUserDto,
    @GetUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, dto, actor)
  }

  @Put(':id/role')
  @Roles(AppRole.ADMIN)
  @Scopes(ApiScope.USERS_MANAGE)
  @ApiOAuth2([ApiScope.USERS_MANAGE], 'oauth2')
  @ApiOperation({
    summary: 'Asigna o cambia el rol funcional de un usuario',
    description:
      'Aprueba las cuentas registradas (quita PENDIENTE_APROBACION) o reemplaza el rol anterior, y cierra las sesiones del usuario para que su próximo token tenga los nuevos scopes.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'El usuario no existe' })
  @ApiConflictResponse({
    description: 'Un administrador no puede quitarse su propio rol ADMIN',
  })
  @ApiForbiddenResponse({ description: 'Requiere rol ADMIN y users:manage' })
  changeRole(
    @Param('id', USER_ID_PIPE) id: string,
    @Body() dto: UpdateUserRoleDto,
    @GetUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.changeRole(id, dto.role, actor)
  }

  @Put(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(AppRole.ADMIN)
  @Scopes(ApiScope.USERS_MANAGE)
  @ApiOAuth2([ApiScope.USERS_MANAGE], 'oauth2')
  @ApiOperation({
    summary: 'Restablece la contraseña de un usuario',
    description: 'Define una contraseña nueva y cierra sus sesiones.',
  })
  @ApiNoContentResponse({ description: 'Contraseña restablecida' })
  @ApiBadRequestResponse({ description: 'La contraseña no es válida' })
  @ApiNotFoundResponse({ description: 'El usuario no existe' })
  @ApiForbiddenResponse({ description: 'Requiere rol ADMIN y users:manage' })
  resetPassword(
    @Param('id', USER_ID_PIPE) id: string,
    @Body() dto: ResetPasswordDto,
    @GetUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.usersService.resetPassword(id, dto.password, actor)
  }
}
