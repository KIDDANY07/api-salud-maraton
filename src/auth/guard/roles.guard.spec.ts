import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AppRole, type AuthenticatedUser } from '../authenticated-user'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { RolesGuard } from './roles.guard'

function contextFor(
  metadata: Record<string, unknown>,
  user?: Partial<AuthenticatedUser>,
): ExecutionContext {
  const handler = () => undefined
  for (const [key, value] of Object.entries(metadata)) {
    Reflect.defineMetadata(key, value, handler)
  }
  return {
    getHandler: () => handler,
    getClass: () => class Target {},
    switchToHttp: () => ({
      getRequest: () => ({
        user: user ? { roles: [], scopes: [], ...user } : undefined,
      }),
    }),
  } as unknown as ExecutionContext
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector())

  it('permite endpoints públicos y sin roles declarados', () => {
    expect(guard.canActivate(contextFor({ [IS_PUBLIC_KEY]: true }))).toBe(true)
    expect(guard.canActivate(contextFor({}, { roles: [] }))).toBe(true)
  })

  it('permite si el usuario tiene alguno de los roles', () => {
    const context = contextFor(
      { [ROLES_KEY]: [AppRole.AUDITOR, AppRole.ADMIN] },
      { roles: [AppRole.ADMIN] },
    )
    expect(guard.canActivate(context)).toBe(true)
  })

  it('responde 403 si no tiene el rol y 401 si no hay usuario', () => {
    expect(() =>
      guard.canActivate(
        contextFor(
          { [ROLES_KEY]: [AppRole.COORDINADOR] },
          { roles: [AppRole.EQUIPO_SALUD] },
        ),
      ),
    ).toThrow(ForbiddenException)
    expect(() =>
      guard.canActivate(contextFor({ [ROLES_KEY]: [AppRole.COORDINADOR] })),
    ).toThrow(UnauthorizedException)
  })
})
