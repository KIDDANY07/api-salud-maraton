import {
  ApiScope,
  AppRole,
  parseAppRoles,
  toAuthenticatedUser,
} from './authenticated-user'
import {
  Permission,
  ROLE_DEFINITIONS,
  permissionsFor,
  rolesWithScope,
} from './role-permissions'

describe('roles y permisos', () => {
  it('cada rol tiene una función exclusiva', () => {
    expect(rolesWithScope(ApiScope.ROUTES_WRITE)).toEqual([AppRole.COORDINADOR])
    expect(rolesWithScope(ApiScope.ROUTES_REVIEW)).toEqual([
      AppRole.EQUIPO_SALUD,
    ])
    expect(rolesWithScope(ApiScope.AUDIT_READ)).toEqual([AppRole.AUDITOR])
    expect(rolesWithScope(ApiScope.USERS_MANAGE)).toEqual([AppRole.ADMIN])
    expect(rolesWithScope(ApiScope.ROUTES_READ)).toEqual([
      AppRole.ADMIN,
      AppRole.AUDITOR,
      AppRole.COORDINADOR,
      AppRole.EQUIPO_SALUD,
    ])
  })

  it('combina permisos sin duplicados y en orden', () => {
    expect(permissionsFor([AppRole.AUDITOR, AppRole.COORDINADOR])).toEqual([
      Permission.AUDIT_VERIFY,
      Permission.AUDIT_VIEW,
      Permission.ROUTES_GENERATE,
      Permission.ROUTES_VIEW,
      Permission.VEREDAS_VIEW,
    ])
    expect(permissionsFor([])).toEqual([])
  })

  it('ningún rol genera y valida rutas a la vez', () => {
    for (const definition of Object.values(ROLE_DEFINITIONS)) {
      expect(
        definition.permissions.includes(Permission.ROUTES_GENERATE) &&
          definition.permissions.includes(Permission.ROUTES_REVIEW),
      ).toBe(false)
    }
  })

  it('solo acepta roles funcionales conocidos', () => {
    expect(
      parseAppRoles([
        'EQUIPO_SALUD',
        'offline_access',
        'ADMIN',
        'ADMIN',
        42,
        'default-roles-rural-health',
      ]),
    ).toEqual([AppRole.ADMIN, AppRole.EQUIPO_SALUD])
    expect(parseAppRoles('ADMIN')).toEqual([])
    expect(parseAppRoles(undefined)).toEqual([])
  })

  it('lee identidad, roles y scopes de los claims', () => {
    expect(
      toAuthenticatedUser({
        sub: 'abc',
        azp: 'rural-routes-web',
        preferred_username: 'equipo.demo',
        name: 'Equipo Demo',
        email: 'equipo@rural-health.test',
        scope: 'routes:review routes:read routes:read',
        realm_access: { roles: ['EQUIPO_SALUD', 'uma_authorization'] },
      }),
    ).toEqual({
      sub: 'abc',
      clientId: 'rural-routes-web',
      username: 'equipo.demo',
      name: 'Equipo Demo',
      email: 'equipo@rural-health.test',
      roles: [AppRole.EQUIPO_SALUD],
      scopes: ['routes:read', 'routes:review'],
    })
    expect(toAuthenticatedUser({ scp: ['audit:read'], sub: '' })).toEqual({
      sub: null,
      clientId: null,
      username: null,
      name: null,
      email: null,
      roles: [],
      scopes: ['audit:read'],
    })
  })
})
