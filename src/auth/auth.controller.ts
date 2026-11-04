import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOAuth2,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { AuthService, toSessionUser } from './auth.service'
import type { AuthenticatedUser } from './authenticated-user'
import { CredentialEndpoint } from './decorators/credential-endpoint.decorator'
import { GetUser } from './decorators/get-user.decorator'
import { Public } from './decorators/public.decorator'
import { LoginResponseDto, SessionUserDto } from './dto/login-response.dto'
import { LoginUserDto } from './dto/login-user.dto'
import { RefreshTokenDto } from './dto/refresh-token.dto'
import { RegisterResponseDto } from './dto/register-response.dto'
import { RegisterUserDto } from './dto/register-user.dto'
import { RoleDefinitionDto } from './dto/role-definition.dto'
import { ROLE_DEFINITIONS } from './role-permissions'

@ApiTags('Autenticación')
@ApiServiceUnavailableResponse({
  description: 'Keycloak no está disponible o rechazó la configuración',
})
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @CredentialEndpoint()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registra una cuenta nueva',
    description:
      'Registro público. La cuenta queda en estado PENDIENTE_APROBACION y sin rol funcional: no puede elegir su rol. Podrá iniciar sesión cuando un ADMIN le asigne un rol con PUT /users/:id/role. Se puede desactivar con SELF_REGISTRATION_ENABLED=false.',
  })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  @ApiConflictResponse({ description: 'El usuario o el correo ya existen' })
  @ApiForbiddenResponse({
    description: 'El registro público está deshabilitado',
  })
  @ApiTooManyRequestsResponse({ description: 'Demasiados intentos' })
  register(@Body() dto: RegisterUserDto): Promise<RegisterResponseDto> {
    return this.authService.register(dto)
  }

  @Post('login')
  @Public()
  @CredentialEndpoint()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inicia sesión con usuario y contraseña',
    description:
      'Intercambia las credenciales en Keycloak (cliente público rural-routes-web) y devuelve el access token, el refresh token y el perfil con roles, scopes y permisos. Los scopes del token dependen del rol del usuario.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ description: 'El cuerpo no es válido' })
  @ApiUnauthorizedResponse({ description: 'Usuario o contraseña incorrectos' })
  @ApiForbiddenResponse({
    description:
      'La cuenta no tiene un rol asignado (por ejemplo, registrada y pendiente de aprobación)',
  })
  @ApiTooManyRequestsResponse({ description: 'Demasiados intentos' })
  login(@Body() dto: LoginUserDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.username, dto.password)
  }

  @Post('refresh')
  @Public()
  @CredentialEndpoint()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renueva la sesión',
    description:
      'Usa el refresh token para obtener un nuevo par de tokens. Keycloak rota el refresh token.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Refresh token inválido o vencido' })
  refresh(@Body() dto: RefreshTokenDto): Promise<LoginResponseDto> {
    return this.authService.refresh(dto.refreshToken)
  }

  @Post('logout')
  @Public()
  @CredentialEndpoint()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cierra la sesión',
    description:
      'Revoca en Keycloak la sesión asociada al refresh token. El access token deja de renovarse y vence en minutos.',
  })
  @ApiNoContentResponse({ description: 'Sesión cerrada' })
  @ApiUnauthorizedResponse({ description: 'Refresh token inválido' })
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken)
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOAuth2([], 'oauth2')
  @ApiOperation({
    summary: 'Perfil de la sesión actual',
    description:
      'Devuelve la identidad, los roles, los scopes y los permisos del token presentado.',
  })
  @ApiOkResponse({ type: SessionUserDto })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido' })
  me(@GetUser() user: AuthenticatedUser): SessionUserDto {
    return toSessionUser(user)
  }

  @Get('roles')
  @ApiBearerAuth('bearer')
  @ApiOAuth2([], 'oauth2')
  @ApiOperation({
    summary: 'Catálogo de roles y funcionalidades',
    description:
      'Describe qué puede hacer cada rol, qué scopes recibe y qué permisos habilita.',
  })
  @ApiOkResponse({ type: [RoleDefinitionDto] })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido' })
  roles(): RoleDefinitionDto[] {
    return Object.values(ROLE_DEFINITIONS).map((definition) => ({
      ...definition,
      scopes: [...definition.scopes],
      permissions: [...definition.permissions],
    }))
  }
}
