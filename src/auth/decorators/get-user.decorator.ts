import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import type { AuthenticatedUser } from '../authenticated-user'

export const GetUser = createParamDecorator(
  (
    field: keyof AuthenticatedUser | undefined,
    context: ExecutionContext,
  ): AuthenticatedUser | AuthenticatedUser[keyof AuthenticatedUser] => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>()
    const user = request.user
    if (!user) {
      throw new UnauthorizedException('Token ausente o inválido')
    }
    return field ? user[field] : user
  },
)
