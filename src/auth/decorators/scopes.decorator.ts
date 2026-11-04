import { SetMetadata } from '@nestjs/common'
import { ApiScope } from '../authenticated-user'

export const SCOPES_KEY = 'auth:requiredScopes'

export const Scopes = (...scopes: ApiScope[]) => SetMetadata(SCOPES_KEY, scopes)
