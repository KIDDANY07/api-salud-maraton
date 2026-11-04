import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { sign } from 'jsonwebtoken'

export interface TestTokenOptions {
  clientId: string
  scopes: string[]
  sub?: string
  issuer?: string
  audience?: string
  expired?: boolean
  signWithUnknownKey?: boolean
}

export interface TestJwks {
  jwksUri: string
  issuer: string
  audience: string
  sign(options: TestTokenOptions): string
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

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address() as AddressInfo)
    })
  })
}

export async function startTestJwks(
  issuer = 'http://issuer.test/realms/rural-health',
  audience = 'rural-routes-api',
): Promise<TestJwks> {
  const trustedKey = createSigningKey()
  const unknownKey = createSigningKey()
  const jwk = {
    ...trustedKey.publicKey.export({ format: 'jwk' }),
    kid: trustedKey.kid,
    use: 'sig',
    alg: 'RS256',
  }
  const server = createServer((request, response) => {
    if (request.url === '/certs') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ keys: [jwk] }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  const address = await listen(server)
  return {
    jwksUri: `http://127.0.0.1:${address.port}/certs`,
    issuer,
    audience,
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
          typ: 'Bearer',
        },
        key.privateKey,
        { algorithm: 'RS256', keyid: key.kid },
      )
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
