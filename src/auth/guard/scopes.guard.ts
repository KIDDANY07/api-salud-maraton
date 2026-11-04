import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import type { AuthenticatedUser } from '../authenticated-user'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { SCOPES_KEY } from '../decorators/scopes.decorator'

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true
    }
    const requiredScopes =
      this.reflector.getAllAndMerge<string[]>(SCOPES_KEY, targets) ?? []
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>()
    const user = request.user
    if (!user) {
      throw new UnauthorizedException('Token ausente o inválido')
    }
    const missingScopes = requiredScopes.filter(
      (scope) => !user.scopes.includes(scope),
    )
    if (missingScopes.length > 0) {
      throw new ForbiddenException(
        `El token no tiene los scopes requeridos: ${missingScopes.join(', ')}`,
      )
    }
    return true
  }
}
