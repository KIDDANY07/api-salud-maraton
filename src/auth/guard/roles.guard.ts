import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import type { AppRole, AuthenticatedUser } from '../authenticated-user'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { ROLES_KEY } from '../decorators/roles.decorator'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true
    }
    const allowedRoles =
      this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, targets) ?? []
    if (allowedRoles.length === 0) {
      return true
    }
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user
    if (!user) {
      throw new UnauthorizedException('Token ausente o inválido')
    }
    if (!user.roles.some((role) => allowedRoles.includes(role))) {
      throw new ForbiddenException(
        `Su rol no permite esta operación. Roles autorizados: ${allowedRoles.join(', ')}`,
      )
    }
    return true
  }
}
