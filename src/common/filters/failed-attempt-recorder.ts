import type { Request } from 'express'
import type { AuthenticatedUser } from '../../auth/authenticated-user'

export const FAILED_ATTEMPT_RECORDER = Symbol('FAILED_ATTEMPT_RECORDER')

export type FailedAttemptStatus = 'VALIDATION_ERROR' | 'FORBIDDEN'

export interface RouteGenerationAttempt {
  startedAt: number
}

export type RequestWithContext = Request & {
  user?: AuthenticatedUser
  routeGenerationAttempt?: RouteGenerationAttempt
}

export interface FailedAttempt {
  status: FailedAttemptStatus
  correlationId: string
  user: AuthenticatedUser | undefined
  receivedParameters: unknown
  errorDetails: { statusCode: number; message: string | string[] }
  durationMs: number
}

export interface FailedAttemptRecorder {
  recordFailedAttempt(attempt: FailedAttempt): Promise<void>
}
