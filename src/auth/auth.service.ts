import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { passwordContainsUsername } from './account-rules'
import {
  PENDING_APPROVAL_ROLE,
  toAuthenticatedUser,
  type AccessTokenClaims,
  type AuthenticatedUser,
} from './authenticated-user'
import type { LoginResponseDto, SessionUserDto } from './dto/login-response.dto'
import type { RegisterResponseDto } from './dto/register-response.dto'
import type { RegisterUserDto } from './dto/register-user.dto'
import { KeycloakAdminService } from './keycloak-admin.service'
import {
  decodeJwtPayload,
  keycloakEndpointsFrom,
  oauthErrorOf,
  postForm,
  type KeycloakEndpoints,
} from './keycloak-http'
import { permissionsFor } from './role-permissions'

interface TokenEndpointResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  refresh_expires_in?: number
}

const REJECTED_CREDENTIAL_ERRORS = new Set([
  'invalid_grant',
  'invalid_request',
  'unauthorized_client',
])

export function toSessionUser(user: AuthenticatedUser): SessionUserDto {
  return {
    sub: user.sub,
    username: user.username,
    name: user.name,
    email: user.email,
    clientId: user.clientId,
    roles: user.roles,
    scopes: user.scopes,
    permissions: permissionsFor(user.roles),
  }
}

function isTokenResponse(body: unknown): body is TokenEndpointResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as TokenEndpointResponse).access_token === 'string'
  )
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  private readonly endpoints: KeycloakEndpoints
  private readonly clientId: string
  private readonly selfRegistrationEnabled: boolean

  constructor(
    config: ConfigService,
    private readonly keycloakAdmin: KeycloakAdminService,
  ) {
    this.endpoints = keycloakEndpointsFrom(config)
    this.clientId = config.getOrThrow<string>('LOGIN_CLIENT_ID')
    this.selfRegistrationEnabled = config.getOrThrow<boolean>(
      'SELF_REGISTRATION_ENABLED',
    )
  }

  async register(dto: RegisterUserDto): Promise<RegisterResponseDto> {
    if (!this.selfRegistrationEnabled) {
      throw new ForbiddenException(
        'El registro público está deshabilitado; solicite la cuenta a un administrador',
      )
    }
    if (passwordContainsUsername(dto.username, dto.password)) {
      throw new BadRequestException(
        'La contraseña no puede contener el nombre de usuario',
      )
    }
    const id = await this.keycloakAdmin.createUser(dto)
    try {
      await this.keycloakAdmin.addRealmRoles(id, [PENDING_APPROVAL_ROLE])
    } catch (error) {
      await this.keycloakAdmin.deleteUser(id).catch(() => undefined)
      throw error
    }
    this.logger.log(
      { userId: id },
      'Cuenta registrada; pendiente de aprobación por un administrador',
    )
    return {
      id,
      username: dto.username,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      pendingApproval: true,
      message:
        'Cuenta creada. Podrá iniciar sesión cuando un administrador le asigne un rol.',
    }
  }

  async login(username: string, password: string): Promise<LoginResponseDto> {
    const tokens = await this.requestTokens(
      { grant_type: 'password', username, password },
      'Usuario o contraseña incorrectos',
    )
    const session = this.toLoginResponse(tokens)
    if (session.user.roles.length === 0) {
      await this.logout(session.refreshToken).catch(() => undefined)
      throw new ForbiddenException(
        'La cuenta aún no tiene un rol asignado. Si se registró, espere a que un administrador apruebe su acceso.',
      )
    }
    this.logger.log(
      { sub: session.user.sub, roles: session.user.roles },
      'Inicio de sesión exitoso',
    )
    return session
  }

  async refresh(refreshToken: string): Promise<LoginResponseDto> {
    const tokens = await this.requestTokens(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      'El refresh token es inválido o expiró; inicie sesión de nuevo',
    )
    return this.toLoginResponse(tokens)
  }

  async logout(refreshToken: string): Promise<void> {
    const response = await postForm(
      this.endpoints.logoutUrl,
      { client_id: this.clientId, refresh_token: refreshToken },
      this.endpoints.timeoutMs,
    )
    if (response.status >= 200 && response.status < 300) {
      return
    }
    if (response.status === 400 || response.status === 401) {
      throw new UnauthorizedException(
        'El refresh token es inválido o la sesión ya fue cerrada',
      )
    }
    throw new ServiceUnavailableException(
      'El servidor de autorización no pudo cerrar la sesión',
    )
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    try {
      const tokens = await this.requestTokens(
        { grant_type: 'password', username, password },
        'La contraseña actual no es correcta',
      )
      if (tokens.refresh_token) {
        await this.logout(tokens.refresh_token).catch(() => undefined)
      }
      return true
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        return false
      }
      throw error
    }
  }

  private async requestTokens(
    form: Record<string, string>,
    rejectionMessage: string,
  ): Promise<TokenEndpointResponse> {
    const response = await postForm(
      this.endpoints.tokenUrl,
      { ...form, client_id: this.clientId },
      this.endpoints.timeoutMs,
    )
    if (response.status === 200 && isTokenResponse(response.body)) {
      return response.body
    }
    const oauthError = oauthErrorOf(response.body)
    if (
      (response.status === 400 || response.status === 401) &&
      oauthError !== null &&
      REJECTED_CREDENTIAL_ERRORS.has(oauthError)
    ) {
      throw new UnauthorizedException(rejectionMessage)
    }
    this.logger.error(
      { status: response.status, oauthError },
      'Respuesta inesperada del endpoint de tokens',
    )
    throw new ServiceUnavailableException(
      'El servidor de autorización rechazó la solicitud',
    )
  }

  private toLoginResponse(tokens: TokenEndpointResponse): LoginResponseDto {
    const claims = decodeJwtPayload<AccessTokenClaims>(tokens.access_token)
    return {
      accessToken: tokens.access_token,
      tokenType: 'Bearer',
      expiresIn: tokens.expires_in,
      refreshToken: tokens.refresh_token ?? '',
      refreshExpiresIn: tokens.refresh_expires_in ?? 0,
      user: toSessionUser(toAuthenticatedUser(claims)),
    }
  }
}
