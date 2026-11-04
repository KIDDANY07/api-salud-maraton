import { SetMetadata, type ExecutionContext } from '@nestjs/common'

export const CREDENTIAL_ENDPOINT_KEY = 'auth:credentialEndpoint'

export const CREDENTIAL_THROTTLER = 'credentials'

export const CredentialEndpoint = () =>
  SetMetadata(CREDENTIAL_ENDPOINT_KEY, true)

export function isCredentialEndpoint(context: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(CREDENTIAL_ENDPOINT_KEY, context.getHandler()) === true
  )
}
