import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  keycloakEndpointsFrom,
  keycloakRequest,
  postForm,
  type KeycloakEndpoints,
  type KeycloakResponse,
} from './keycloak-http'

export const ROLE_MEMBERS_PAGE_SIZE = 500

export interface KeycloakUserRepresentation {
  id: string
  username: string
  email?: string
  firstName?: string
  lastName?: string
  enabled: boolean
  emailVerified?: boolean
  createdTimestamp?: number
  serviceAccountClientId?: string
}

export const SERVICE_ACCOUNT_PREFIX = 'service-account-'

export function isServiceAccount(user: KeycloakUserRepresentation): boolean {
  return (
    typeof user.serviceAccountClientId === 'string' ||
    user.username.startsWith(SERVICE_ACCOUNT_PREFIX)
  )
}

export interface KeycloakRoleRepresentation {
  id: string
  name: string
}

export interface NewKeycloakUser {
  username: string
  email: string
  firstName: string
  lastName: string
  password: string
}

export type KeycloakUserChanges = Partial<
  Pick<
    KeycloakUserRepresentation,
    'email' | 'firstName' | 'lastName' | 'enabled'
  >
>

interface CachedToken {
  value: string
  expiresAt: number
}

interface KeycloakErrorBody {
  error?: string
  errorMessage?: string
  error_description?: string
}

function keycloakMessageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const { errorMessage, error_description, error } = body as KeycloakErrorBody
  return errorMessage ?? error_description ?? error ?? null
}

function isSuccess(response: KeycloakResponse): boolean {
  return response.status >= 200 && response.status < 300
}

@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name)
  private readonly endpoints: KeycloakEndpoints
  private readonly clientId: string
  private readonly clientSecret: string
  private cachedToken: CachedToken | null = null

  constructor(config: ConfigService) {
    this.endpoints = keycloakEndpointsFrom(config)
    this.clientId = config.getOrThrow<string>('KEYCLOAK_ADMIN_CLIENT_ID')
    this.clientSecret = config.get<string>('KEYCLOAK_ADMIN_CLIENT_SECRET') ?? ''
  }

  async listRoleMembers(role: string): Promise<KeycloakUserRepresentation[]> {
    const members: KeycloakUserRepresentation[] = []
    for (let first = 0; ; first += ROLE_MEMBERS_PAGE_SIZE) {
      const query = new URLSearchParams({
        first: String(first),
        max: String(ROLE_MEMBERS_PAGE_SIZE),
        briefRepresentation: 'false',
      })
      const page = this.expectBody<KeycloakUserRepresentation[]>(
        await this.call(
          'GET',
          `/roles/${encodeURIComponent(role)}/users?${query.toString()}`,
        ),
        `No se pudieron listar los usuarios del rol ${role}`,
      )
      members.push(...page)
      if (page.length < ROLE_MEMBERS_PAGE_SIZE) {
        return members
      }
    }
  }

  async findUser(id: string): Promise<KeycloakUserRepresentation | null> {
    const response = await this.call('GET', `/users/${encodeURIComponent(id)}`)
    if (response.status === 404) {
      return null
    }
    return this.expectBody<KeycloakUserRepresentation>(
      response,
      'No se pudo consultar el usuario',
    )
  }

  async getUser(id: string): Promise<KeycloakUserRepresentation> {
    const user = await this.findUser(id)
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}`)
    }
    return user
  }

  async realmRolesOf(id: string): Promise<KeycloakRoleRepresentation[]> {
    return this.expectBody<KeycloakRoleRepresentation[]>(
      await this.call(
        'GET',
        `/users/${encodeURIComponent(id)}/role-mappings/realm`,
      ),
      'No se pudieron consultar los roles del usuario',
    )
  }

  async createUser(user: NewKeycloakUser): Promise<string> {
    const response = await this.call('POST', '/users', {
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      credentials: [
        { type: 'password', value: user.password, temporary: false },
      ],
    })
    if (response.status === 409) {
      throw new ConflictException(
        'Ya existe un usuario con ese nombre de usuario o correo',
      )
    }
    this.rejectInvalidInput(response)
    this.assertSuccess(response, 'No se pudo crear el usuario')
    const location = response.headers.get('location') ?? ''
    const id = location.split('/').pop()
    if (!id) {
      throw new ServiceUnavailableException(
        'Keycloak no devolvió el identificador del usuario creado',
      )
    }
    return id
  }

  async deleteUser(id: string): Promise<void> {
    const response = await this.call(
      'DELETE',
      `/users/${encodeURIComponent(id)}`,
    )
    this.assertSuccess(response, 'No se pudo eliminar el usuario')
  }

  async updateUser(
    current: KeycloakUserRepresentation,
    changes: KeycloakUserChanges,
  ): Promise<void> {
    const response = await this.call(
      'PUT',
      `/users/${encodeURIComponent(current.id)}`,
      { ...current, ...changes },
    )
    if (response.status === 409) {
      throw new ConflictException('El correo ya está asociado a otro usuario')
    }
    this.rejectInvalidInput(response)
    this.assertSuccess(response, 'No se pudo actualizar el usuario')
  }

  async addRealmRoles(id: string, roleNames: string[]): Promise<void> {
    await this.changeRealmRoles('POST', id, roleNames)
  }

  async removeRealmRoles(id: string, roleNames: string[]): Promise<void> {
    await this.changeRealmRoles('DELETE', id, roleNames)
  }

  async resetPassword(id: string, password: string): Promise<void> {
    const response = await this.call(
      'PUT',
      `/users/${encodeURIComponent(id)}/reset-password`,
      { type: 'password', value: password, temporary: false },
    )
    this.rejectInvalidInput(response)
    this.assertSuccess(response, 'No se pudo cambiar la contraseña')
  }

  async logoutUser(id: string): Promise<void> {
    const response = await this.call(
      'POST',
      `/users/${encodeURIComponent(id)}/logout`,
    )
    this.assertSuccess(response, 'No se pudieron cerrar las sesiones')
  }

  private async changeRealmRoles(
    method: 'POST' | 'DELETE',
    id: string,
    roleNames: string[],
  ): Promise<void> {
    if (roleNames.length === 0) {
      return
    }
    const roles = await Promise.all(
      roleNames.map(async (name) =>
        this.expectBody<KeycloakRoleRepresentation>(
          await this.call('GET', `/roles/${encodeURIComponent(name)}`),
          `El rol ${name} no existe en Keycloak`,
        ),
      ),
    )
    const response = await this.call(
      method,
      `/users/${encodeURIComponent(id)}/role-mappings/realm`,
      roles.map((role) => ({ id: role.id, name: role.name })),
    )
    this.assertSuccess(response, 'No se pudieron actualizar los roles')
  }

  private rejectInvalidInput(response: KeycloakResponse): void {
    if (response.status === 400) {
      throw new BadRequestException(
        `Keycloak rechazó los datos: ${keycloakMessageOf(response.body) ?? 'datos inválidos'}`,
      )
    }
  }

  private assertSuccess(response: KeycloakResponse, message: string): void {
    if (response.status === 404) {
      throw new NotFoundException('El usuario no existe')
    }
    if (!isSuccess(response)) {
      this.logger.error(
        { status: response.status, detail: keycloakMessageOf(response.body) },
        message,
      )
      throw new ServiceUnavailableException(message)
    }
  }

  private expectBody<T>(response: KeycloakResponse, message: string): T {
    this.assertSuccess(response, message)
    if (response.body === null) {
      throw new ServiceUnavailableException(message)
    }
    return response.body as T
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<KeycloakResponse> {
    const send = async (token: string) =>
      keycloakRequest(
        `${this.endpoints.adminBaseUrl}${path}`,
        {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        this.endpoints.timeoutMs,
      )
    const response = await send(await this.accessToken())
    if (response.status !== 401) {
      return response
    }
    this.cachedToken = null
    return send(await this.accessToken())
  }

  private async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value
    }
    if (this.clientSecret.length === 0) {
      throw new ServiceUnavailableException(
        'La gestión de usuarios no está configurada (KEYCLOAK_ADMIN_CLIENT_SECRET)',
      )
    }
    const response = await postForm<{
      access_token?: string
      expires_in?: number
    }>(
      this.endpoints.tokenUrl,
      {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
      this.endpoints.timeoutMs,
    )
    const token = response.body?.access_token
    if (response.status !== 200 || typeof token !== 'string') {
      this.logger.error(
        { status: response.status },
        'No se obtuvo el token de administración de Keycloak',
      )
      throw new ServiceUnavailableException(
        'No se pudo autenticar el cliente de administración en Keycloak',
      )
    }
    const lifetimeSeconds = response.body?.expires_in ?? 60
    this.cachedToken = {
      value: token,
      expiresAt: Date.now() + Math.max(lifetimeSeconds - 30, 5) * 1000,
    }
    return token
  }
}
