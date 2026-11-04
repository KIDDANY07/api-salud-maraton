import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import type { AuthService } from '../auth/auth.service'
import {
  AppRole,
  PENDING_APPROVAL_ROLE,
  type AuthenticatedUser,
} from '../auth/authenticated-user'
import type {
  KeycloakAdminService,
  KeycloakUserRepresentation,
} from '../auth/keycloak-admin.service'
import {
  UsersService,
  groupRoleMembers,
  matchesUserFilter,
  rolesToList,
  toUserResponse,
} from './users.service'

const user = (
  id: string,
  username: string,
  overrides: Partial<KeycloakUserRepresentation> = {},
): KeycloakUserRepresentation => ({
  id,
  username,
  email: `${username}@rural-health.test`,
  firstName: 'Ana',
  lastName: 'Pérez',
  enabled: true,
  createdTimestamp: Date.UTC(2026, 10, 4),
  ...overrides,
})

const actor = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  sub: 'admin-id',
  clientId: 'rural-routes-web',
  username: 'admin.demo',
  name: null,
  email: null,
  roles: [AppRole.ADMIN],
  scopes: ['users:manage'],
  ...overrides,
})

function serviceWith(keycloak: Partial<KeycloakAdminService>, verified = true) {
  const auth = {
    verifyPassword: jest.fn().mockResolvedValue(verified),
  } as unknown as AuthService
  return new UsersService(keycloak as KeycloakAdminService, auth)
}

describe('UsersService', () => {
  it('agrupa los miembros de cada rol y ordena por usuario', () => {
    const shared = user('1', 'zeta')
    const grouped = groupRoleMembers([
      [AppRole.ADMIN, [shared]],
      [AppRole.AUDITOR, [shared, user('2', 'alfa')]],
    ])
    expect(grouped.map((entry) => entry.user.username)).toEqual([
      'alfa',
      'zeta',
    ])
    expect(grouped[1].roles).toEqual([AppRole.ADMIN, AppRole.AUDITOR])
  })

  it('excluye las cuentas de servicio del listado', () => {
    const grouped = groupRoleMembers([
      [
        AppRole.COORDINADOR,
        [
          user('1', 'service-account-planificador-app'),
          user('2', 'otra', { serviceAccountClientId: 'otra-app' }),
          user('3', 'persona'),
        ],
      ],
    ])
    expect(grouped.map((entry) => entry.user.username)).toEqual(['persona'])
  })

  it('no modifica cuentas de servicio', async () => {
    const service = serviceWith({
      getUser: jest
        .fn()
        .mockResolvedValue(user('sa', 'service-account-auditor-app')),
      realmRolesOf: jest.fn().mockResolvedValue([]),
    })
    await expect(
      service.update('sa', { enabled: false }, actor()),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.changeRole('sa', AppRole.ADMIN, actor()),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.resetPassword('sa', 'Clave.Segura2026', actor()),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('marca las cuentas registradas pendientes de aprobación', () => {
    const grouped = groupRoleMembers([
      [PENDING_APPROVAL_ROLE, [user('1', 'nueva')]],
      [AppRole.AUDITOR, [user('2', 'auditora')]],
    ])
    expect(
      grouped.map((entry) => [entry.user.username, entry.pendingApproval]),
    ).toEqual([
      ['auditora', false],
      ['nueva', true],
    ])
    expect(matchesUserFilter(grouped[1], { pendingApproval: true })).toBe(true)
    expect(matchesUserFilter(grouped[0], { pendingApproval: true })).toBe(false)
  })

  it('elige qué roles consultar según el filtro', () => {
    expect(rolesToList({ role: AppRole.ADMIN })).toEqual([AppRole.ADMIN])
    expect(rolesToList({ pendingApproval: true })).toEqual([
      PENDING_APPROVAL_ROLE,
    ])
    expect(rolesToList({})).toEqual([
      AppRole.ADMIN,
      AppRole.COORDINADOR,
      AppRole.AUDITOR,
      AppRole.EQUIPO_SALUD,
      PENDING_APPROVAL_ROLE,
    ])
  })

  it('al aprobar una cuenta quita la marca de pendiente', async () => {
    const keycloak = {
      getUser: jest.fn().mockResolvedValue(user('u9', 'nueva')),
      realmRolesOf: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'p', name: PENDING_APPROVAL_ROLE }])
        .mockResolvedValue([{ id: 'e', name: 'EQUIPO_SALUD' }]),
      removeRealmRoles: jest.fn().mockResolvedValue(undefined),
      addRealmRoles: jest.fn().mockResolvedValue(undefined),
      logoutUser: jest.fn().mockResolvedValue(undefined),
    }
    const result = await serviceWith(keycloak).changeRole(
      'u9',
      AppRole.EQUIPO_SALUD,
      actor(),
    )
    expect(keycloak.removeRealmRoles).toHaveBeenCalledWith('u9', [
      PENDING_APPROVAL_ROLE,
    ])
    expect(keycloak.addRealmRoles).toHaveBeenCalledWith('u9', ['EQUIPO_SALUD'])
    expect(result).toMatchObject({
      roles: [AppRole.EQUIPO_SALUD],
      pendingApproval: false,
    })
  })

  it('filtra por rol, estado y texto sin distinguir mayúsculas', () => {
    const entry = {
      user: user('1', 'laura.r'),
      roles: [AppRole.AUDITOR],
      pendingApproval: false,
    }
    expect(matchesUserFilter(entry, {})).toBe(true)
    expect(matchesUserFilter(entry, { search: 'PÉREZ' })).toBe(true)
    expect(matchesUserFilter(entry, { search: 'otro' })).toBe(false)
    expect(matchesUserFilter(entry, { role: AppRole.ADMIN })).toBe(false)
    expect(matchesUserFilter(entry, { enabled: false })).toBe(false)
  })

  it('convierte la representación de Keycloak', () => {
    expect(
      toUserResponse({
        user: user('1', 'ana', {
          email: undefined,
          createdTimestamp: undefined,
        }),
        roles: [AppRole.EQUIPO_SALUD, AppRole.ADMIN],
        pendingApproval: false,
      }),
    ).toMatchObject({
      email: null,
      createdAt: null,
      roles: [AppRole.ADMIN, AppRole.EQUIPO_SALUD],
    })
  })

  it('pagina el listado combinado', async () => {
    const service = serviceWith({
      listRoleMembers: jest.fn((role: string) =>
        Promise.resolve(
          role === 'ADMIN'
            ? [user('1', 'a'), user('2', 'b')]
            : role === 'AUDITOR'
              ? [user('3', 'c')]
              : [],
        ),
      ),
    })
    const page = await service.list({ page: 2, limit: 2 })
    expect(page.items.map((item) => item.username)).toEqual(['c'])
    expect(page.meta).toMatchObject({ totalItems: 3, totalPages: 2 })
  })

  it('elimina el usuario si falla la asignación del rol', async () => {
    const deleteUser = jest.fn().mockResolvedValue(undefined)
    const service = serviceWith({
      createUser: jest.fn().mockResolvedValue('nuevo-id'),
      addRealmRoles: jest.fn().mockRejectedValue(new Error('fallo')),
      deleteUser,
    })
    await expect(
      service.create(
        {
          username: 'nueva.persona',
          email: 'n@rural-health.test',
          firstName: 'N',
          lastName: 'P',
          role: AppRole.AUDITOR,
          password: 'Clave.Segura2026',
        },
        actor(),
      ),
    ).rejects.toThrow('fallo')
    expect(deleteUser).toHaveBeenCalledWith('nuevo-id')
  })

  it('protege la cuenta del propio administrador', async () => {
    const service = serviceWith({})
    await expect(
      service.update('admin-id', { enabled: false }, actor()),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.changeRole('admin-id', AppRole.AUDITOR, actor()),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('reemplaza el rol anterior y cierra sesiones', async () => {
    const keycloak = {
      getUser: jest.fn().mockResolvedValue(user('u1', 'ana')),
      realmRolesOf: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'r1', name: 'AUDITOR' }])
        .mockResolvedValue([{ id: 'r2', name: 'COORDINADOR' }]),
      removeRealmRoles: jest.fn().mockResolvedValue(undefined),
      addRealmRoles: jest.fn().mockResolvedValue(undefined),
      logoutUser: jest.fn().mockResolvedValue(undefined),
    }
    const result = await serviceWith(keycloak).changeRole(
      'u1',
      AppRole.COORDINADOR,
      actor(),
    )
    expect(keycloak.removeRealmRoles).toHaveBeenCalledWith('u1', ['AUDITOR'])
    expect(keycloak.addRealmRoles).toHaveBeenCalledWith('u1', ['COORDINADOR'])
    expect(keycloak.logoutUser).toHaveBeenCalledWith('u1')
    expect(result.roles).toEqual([AppRole.COORDINADOR])
  })

  it('valida el cambio de contraseña propia', async () => {
    const resetPassword = jest.fn().mockResolvedValue(undefined)
    const dto = {
      currentPassword: 'Actual.Clave2026',
      newPassword: 'Nueva.Clave2026',
    }
    await expect(
      serviceWith({ resetPassword }).changeOwnPassword(
        actor({ username: 'service-account-planificador-app' }),
        dto,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
    await expect(
      serviceWith({ resetPassword }).changeOwnPassword(actor(), {
        currentPassword: dto.newPassword,
        newPassword: dto.newPassword,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      serviceWith({ resetPassword }, false).changeOwnPassword(actor(), dto),
    ).rejects.toThrow('La contraseña actual no es correcta')
    await serviceWith({ resetPassword }).changeOwnPassword(actor(), dto)
    expect(resetPassword).toHaveBeenCalledWith('admin-id', 'Nueva.Clave2026')
  })
})
