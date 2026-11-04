import { ApiScope, AppRole } from './authenticated-user'

export enum Permission {
  VEREDAS_VIEW = 'veredas:view',
  ROUTES_VIEW = 'routes:view',
  ROUTES_GENERATE = 'routes:generate',
  ROUTES_REVIEW = 'routes:review',
  AUDIT_VIEW = 'audit:view',
  AUDIT_VERIFY = 'audit:verify',
  USERS_MANAGE = 'users:manage',
}

export interface RoleDefinition {
  role: AppRole
  label: string
  description: string
  scopes: ApiScope[]
  permissions: Permission[]
}

export const ROLE_DEFINITIONS: Readonly<Record<AppRole, RoleDefinition>> = {
  [AppRole.ADMIN]: {
    role: AppRole.ADMIN,
    label: 'Administrador',
    description:
      'Gestiona las cuentas y los roles del sistema. Puede consultar rutas y veredas, pero no genera, revisa ni audita rutas.',
    scopes: [ApiScope.ROUTES_READ, ApiScope.USERS_MANAGE],
    permissions: [
      Permission.VEREDAS_VIEW,
      Permission.ROUTES_VIEW,
      Permission.USERS_MANAGE,
    ],
  },
  [AppRole.COORDINADOR]: {
    role: AppRole.COORDINADOR,
    label: 'Coordinador de jornadas',
    description:
      'Planifica las jornadas: genera rutas sugeridas y consulta rutas y veredas.',
    scopes: [ApiScope.ROUTES_READ, ApiScope.ROUTES_WRITE],
    permissions: [
      Permission.VEREDAS_VIEW,
      Permission.ROUTES_VIEW,
      Permission.ROUTES_GENERATE,
    ],
  },
  [AppRole.AUDITOR]: {
    role: AppRole.AUDITOR,
    label: 'Auditor',
    description:
      'Revisa la trazabilidad: consulta la auditoría, el índice numérico y el desglose del score, y verifica rutas.',
    scopes: [ApiScope.ROUTES_READ, ApiScope.AUDIT_READ],
    permissions: [
      Permission.VEREDAS_VIEW,
      Permission.ROUTES_VIEW,
      Permission.AUDIT_VIEW,
      Permission.AUDIT_VERIFY,
    ],
  },
  [AppRole.EQUIPO_SALUD]: {
    role: AppRole.EQUIPO_SALUD,
    label: 'Equipo de salud',
    description:
      'Realiza la validación humana: consulta las rutas y las aprueba o rechaza con observaciones. No puede revisar rutas que haya generado.',
    scopes: [ApiScope.ROUTES_READ, ApiScope.ROUTES_REVIEW],
    permissions: [
      Permission.VEREDAS_VIEW,
      Permission.ROUTES_VIEW,
      Permission.ROUTES_REVIEW,
    ],
  },
}

export function permissionsFor(roles: readonly AppRole[]): Permission[] {
  const granted = new Set<Permission>()
  for (const role of roles) {
    for (const permission of ROLE_DEFINITIONS[role].permissions) {
      granted.add(permission)
    }
  }
  return [...granted].sort()
}

export function rolesWithScope(scope: ApiScope): AppRole[] {
  return Object.values(ROLE_DEFINITIONS)
    .filter((definition) => definition.scopes.includes(scope))
    .map((definition) => definition.role)
    .sort()
}
