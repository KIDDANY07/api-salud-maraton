import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { AuthService } from './auth.service'
import { PENDING_APPROVAL_ROLE } from './authenticated-user'
import type { KeycloakAdminService } from './keycloak-admin.service'

const settings: Record<string, unknown> = {
  KEYCLOAK_BASE_URL: 'http://keycloak.test',
  KEYCLOAK_REALM: 'rural-health',
  KEYCLOAK_TIMEOUT_MS: 1000,
  LOGIN_CLIENT_ID: 'rural-routes-web',
  SELF_REGISTRATION_ENABLED: true,
}

function serviceWith(
  keycloak: Partial<KeycloakAdminService>,
  overrides: Record<string, unknown> = {},
): AuthService {
  const values = { ...settings, ...overrides }
  const config = {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService
  return new AuthService(config, keycloak as KeycloakAdminService)
}

const registration = {
  username: 'promotora.guaduas',
  email: 'promotora.guaduas@rural-health.test',
  firstName: 'Marta',
  lastName: 'Guzmán',
  password: 'Promueve.Salud2026',
}

describe('AuthService.register', () => {
  it('crea la cuenta pendiente de aprobación y sin rol funcional', async () => {
    const keycloak = {
      createUser: jest.fn().mockResolvedValue('nuevo-id'),
      addRealmRoles: jest.fn().mockResolvedValue(undefined),
    }
    const result = await serviceWith(keycloak).register(registration)
    expect(keycloak.createUser).toHaveBeenCalledWith(registration)
    expect(keycloak.addRealmRoles).toHaveBeenCalledWith('nuevo-id', [
      PENDING_APPROVAL_ROLE,
    ])
    expect(result).toMatchObject({
      id: 'nuevo-id',
      username: 'promotora.guaduas',
      pendingApproval: true,
    })
  })

  it('elimina la cuenta si no se puede marcar como pendiente', async () => {
    const deleteUser = jest.fn().mockResolvedValue(undefined)
    const service = serviceWith({
      createUser: jest.fn().mockResolvedValue('nuevo-id'),
      addRealmRoles: jest.fn().mockRejectedValue(new Error('sin rol')),
      deleteUser,
    })
    await expect(service.register(registration)).rejects.toThrow('sin rol')
    expect(deleteUser).toHaveBeenCalledWith('nuevo-id')
  })

  it('rechaza contraseñas con el usuario, duplicados y registro deshabilitado', async () => {
    const createUser = jest
      .fn()
      .mockRejectedValue(new ConflictException('ya existe'))
    await expect(
      serviceWith({ createUser }).register({
        ...registration,
        password: 'Promotora.Guaduas2026x',
        username: 'promotora.guaduas2026x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      serviceWith({ createUser }).register(registration),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      serviceWith(
        { createUser },
        { SELF_REGISTRATION_ENABLED: false },
      ).register(registration),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
