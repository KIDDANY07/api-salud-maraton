import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { sign } from 'jsonwebtoken'

export interface TestTokenOptions {
  clientId: string
  scopes: string[]
  roles?: string[]
  sub?: string
  username?: string
  name?: string
  email?: string
  issuer?: string
  audience?: string
  expired?: boolean
  signWithUnknownKey?: boolean
}

export interface TestSigner {
  issuer: string
  audience: string
  jwks: { keys: Array<Record<string, unknown>> }
  sign(options: TestTokenOptions): string
}

export interface TestJwks extends TestSigner {
  jwksUri: string
  close(): Promise<void>
}

interface SigningKey {
  kid: string
  privateKey: KeyObject
  publicKey: KeyObject
}

function createSigningKey(): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  return { kid: randomUUID(), privateKey, publicKey }
}

export function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address() as AddressInfo)
    })
  })
}

export function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

export function createTestSigner(
  issuer: string,
  audience = 'rural-routes-api',
): TestSigner {
  const trustedKey = createSigningKey()
  const unknownKey = createSigningKey()
  const jwk = {
    ...trustedKey.publicKey.export({ format: 'jwk' }),
    kid: trustedKey.kid,
    use: 'sig',
    alg: 'RS256',
  }
  return {
    issuer,
    audience,
    jwks: { keys: [jwk] },
    sign(options: TestTokenOptions): string {
      const key = options.signWithUnknownKey ? unknownKey : trustedKey
      const now = Math.floor(Date.now() / 1000)
      const lifetime = options.expired
        ? { iat: now - 600, exp: now - 300 }
        : { iat: now, exp: now + 300 }
      return sign(
        {
          ...lifetime,
          iss: options.issuer ?? issuer,
          aud: options.audience ?? audience,
          sub: options.sub ?? `service-account-${options.clientId}`,
          azp: options.clientId,
          client_id: options.clientId,
          scope: options.scopes.join(' '),
          preferred_username:
            options.username ?? `service-account-${options.clientId}`,
          ...(options.name ? { name: options.name } : {}),
          ...(options.email ? { email: options.email } : {}),
          realm_access: { roles: options.roles ?? [] },
          typ: 'Bearer',
        },
        key.privateKey,
        { algorithm: 'RS256', keyid: key.kid },
      )
    },
  }
}

export async function startTestJwks(
  issuer = 'http://issuer.test/realms/rural-health',
  audience = 'rural-routes-api',
): Promise<TestJwks> {
  const signer = createTestSigner(issuer, audience)
  const server = createServer((request, response) => {
    if (request.url === '/certs') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(signer.jwks))
      return
    }
    response.writeHead(404)
    response.end()
  })
  const address = await listen(server)
  return {
    ...signer,
    jwksUri: `http://127.0.0.1:${address.port}/certs`,
    close: () => closeServer(server),
  }
}
