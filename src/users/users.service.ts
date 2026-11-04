import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common'
import { AuthService } from '../auth/auth.service'
import { passwordContainsUsername } from '../auth/account-rules'
import {
  APP_ROLES,
  AppRole,
  isAppRole,
  parseAppRoles,
  PENDING_APPROVAL_ROLE,
  type AuthenticatedUser,
} from '../auth/authenticated-user'
import {
  buildPage,
  resolvePageWindow,
  type Page,
} from '../common/utils/pagination.util'
import type { ChangePasswordDto } from './dto/change-password.dto'
import type { CreateUserDto } from './dto/create-user.dto'
import type { FilterUserDto } from './dto/filter-user.dto'
import type { UserResponseDto } from './dto/response-user.dto'
import type { UpdateUserDto } from './dto/update-user.dto'
import {
  isServiceAccount,
  SERVICE_ACCOUNT_PREFIX,
  KeycloakAdminService,
  type KeycloakUserRepresentation,
} from '../auth/keycloak-admin.service'

interface UserWithRoles {
  user: KeycloakUserRepresentation
  roles: AppRole[]
  pendingApproval: boolean
}

export function toUserResponse({
  user,
  roles,
  pendingApproval,
}: UserWithRoles): UserResponseDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    enabled: user.enabled,
    roles: [...roles].sort(),
    pendingApproval,
    createdAt:
      typeof user.createdTimestamp === 'number'
        ? new Date(user.createdTimestamp).toISOString()
        : null,
  }
}

export function matchesUserFilter(
  entry: UserWithRoles,
  filter: Pick<
    FilterUserDto,
    'search' | 'role' | 'enabled' | 'pendingApproval'
  >,
): boolean {
  if (
    filter.pendingApproval !== undefined &&
    entry.pendingApproval !== filter.pendingApproval
  ) {
    return false
  }
  if (filter.role && !entry.roles.includes(filter.role)) {
    return false
  }
  if (filter.enabled !== undefined && entry.user.enabled !== filter.enabled) {
    return false
  }
  if (!filter.search) {
    return true
  }
  const needle = filter.search.trim().toLowerCase()
  return [
    entry.user.username,
    entry.user.email,
    entry.user.firstName,
    entry.user.lastName,
  ].some((value) => value?.toLowerCase().includes(needle) === true)
}

export function groupRoleMembers(
  membersByRole: ReadonlyArray<
    readonly [string, readonly KeycloakUserRepresentation[]]
  >,
): UserWithRoles[] {
  const grouped = new Map<string, UserWithRoles>()
  for (const [role, members] of membersByRole) {
    for (const user of members.filter((member) => !isServiceAccount(member))) {
      const entry = grouped.get(user.id) ?? {
        user,
        roles: [],
        pendingApproval: false,
      }
      if (isAppRole(role)) {
        entry.roles.push(role)
      } else if (role === PENDING_APPROVAL_ROLE) {
        entry.pendingApproval = true
      }
      grouped.set(user.id, entry)
    }
  }
  return [...grouped.values()].sort((left, right) =>
    left.user.username.localeCompare(right.user.username),
  )
}

export function rolesToList(
  filter: Pick<FilterUserDto, 'role' | 'pendingApproval'>,
): string[] {
  if (filter.role) {
    return [filter.role]
  }
  if (filter.pendingApproval === true) {
    return [PENDING_APPROVAL_ROLE]
  }
  return [...APP_ROLES, PENDING_APPROVAL_ROLE]
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(
    private readonly keycloak: KeycloakAdminService,
    private readonly authService: AuthService,
  ) {}

  async list(filter: FilterUserDto): Promise<Page<UserResponseDto>> {
    const roles = rolesToList(filter)
    const membersByRole = await Promise.all(
      roles.map(
        async (role) =>
          [role, await this.keycloak.listRoleMembers(role)] as const,
      ),
    )
    const matching = groupRoleMembers(membersByRole).filter((entry) =>
      matchesUserFilter(entry, filter),
    )
    const window = resolvePageWindow(filter.page, filter.limit)
    return buildPage(
      matching
        .slice(window.skip, window.skip + window.take)
        .map((entry) => toUserResponse(entry)),
      matching.length,
      window,
    )
  }

  async findOne(id: string): Promise<UserResponseDto> {
    return toUserResponse(await this.loadUser(id))
  }

  async create(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    if (passwordContainsUsername(dto.username, dto.password)) {
      throw new BadRequestException(
        'La contraseña no puede contener el nombre de usuario',
      )
    }
    const id = await this.keycloak.createUser(dto)
    try {
      await this.keycloak.addRealmRoles(id, [dto.role])
    } catch (error) {
      await this.keycloak.deleteUser(id).catch(() => undefined)
      throw error
    }
    this.logger.log(
      { userId: id, role: dto.role, by: actor.sub },
      'Usuario creado',
    )
    return this.findOne(id)
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    if (dto.enabled === false && id === actor.sub) {
      throw new ConflictException('No puede deshabilitar su propia cuenta')
    }
    const current = await this.keycloak.getUser(id)
    this.assertManageable(current)
    await this.keycloak.updateUser(current, {
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
    })
    if (dto.enabled === false) {
      await this.keycloak.logoutUser(id)
    }
    this.logger.log(
      { userId: id, fields: Object.keys(dto), by: actor.sub },
      'Usuario actualizado',
    )
    return this.findOne(id)
  }

  async changeRole(
    id: string,
    role: AppRole,
    actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    if (id === actor.sub && role !== AppRole.ADMIN) {
      throw new ConflictException(
        'No puede quitarse a sí mismo el rol ADMIN; pídaselo a otro administrador',
      )
    }
    const { user, roles, pendingApproval } = await this.loadUser(id)
    this.assertManageable(user)
    await this.keycloak.removeRealmRoles(id, [
      ...roles.filter((current) => current !== role),
      ...(pendingApproval ? [PENDING_APPROVAL_ROLE] : []),
    ])
    if (!roles.includes(role)) {
      await this.keycloak.addRealmRoles(id, [role])
    }
    await this.keycloak.logoutUser(id)
    this.logger.log(
      { userId: id, from: roles, to: role, by: actor.sub },
      'Rol de usuario actualizado',
    )
    return this.findOne(id)
  }

  async resetPassword(
    id: string,
    password: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const { user } = await this.loadUser(id)
    this.assertManageable(user)
    this.assertPasswordAllowed(user.username, password)
    await this.keycloak.resetPassword(id, password)
    await this.keycloak.logoutUser(id)
    this.logger.log(
      { userId: id, by: actor.sub },
      'Contraseña restablecida por un administrador',
    )
  }

  async changeOwnPassword(
    actor: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<void> {
    if (
      !actor.sub ||
      !actor.username ||
      actor.username.startsWith(SERVICE_ACCOUNT_PREFIX)
    ) {
      throw new ForbiddenException(
        'Solo las cuentas de usuario pueden cambiar su contraseña',
      )
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'La nueva contraseña debe ser distinta de la actual',
      )
    }
    this.assertPasswordAllowed(actor.username, dto.newPassword)
    const valid = await this.authService.verifyPassword(
      actor.username,
      dto.currentPassword,
    )
    if (!valid) {
      throw new BadRequestException('La contraseña actual no es correcta')
    }
    await this.keycloak.resetPassword(actor.sub, dto.newPassword)
    this.logger.log({ userId: actor.sub }, 'Contraseña cambiada por su titular')
  }

  private assertManageable(user: KeycloakUserRepresentation): void {
    if (isServiceAccount(user)) {
      throw new ConflictException(
        'Las cuentas de servicio de las integraciones se administran desde Keycloak',
      )
    }
  }

  private assertPasswordAllowed(username: string, password: string): void {
    if (passwordContainsUsername(username, password)) {
      throw new BadRequestException(
        'La contraseña no puede contener el nombre de usuario',
      )
    }
  }

  private async loadUser(id: string): Promise<UserWithRoles> {
    const [user, realmRoles] = await Promise.all([
      this.keycloak.getUser(id),
      this.keycloak.realmRolesOf(id),
    ])
    const names = realmRoles.map((role) => role.name)
    return {
      user,
      roles: parseAppRoles(names),
      pendingApproval: names.includes(PENDING_APPROVAL_ROLE),
    }
  }
}
