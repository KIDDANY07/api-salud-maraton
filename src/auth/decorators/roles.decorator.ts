import { SetMetadata } from '@nestjs/common'
import { AppRole } from '../authenticated-user'

export const ROLES_KEY = 'auth:allowedRoles'

export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles)
