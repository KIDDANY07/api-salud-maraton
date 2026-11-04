import { randomBytes, randomUUID } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import {
  closeServer,
  createTestSigner,
  listen,
  type TestSigner,
} from './jwks-test.util'

export const FAKE_REALM = 'rural-health'
export const FAKE_LOGIN_CLIENT = 'rural-routes-web'
export const FAKE_ADMIN_CLIENT = 'rural-routes-admin-api'
export const FAKE_ADMIN_SECRET = 'admin-api-test-secret'

const BUSINESS_ROLES = ['ADMIN', 'COORDINADOR', 'AUDITOR', 'EQUIPO_SALUD']

const SCOPES_BY_ROLE: Record<string, string[]> = {
  ADMIN: ['routes:read', 'users:manage'],
  COORDINADOR: ['routes:read', 'routes:write'],
  AUDITOR: ['routes:read', 'audit:read'],
  EQUIPO_SALUD: ['routes:read', 'routes:review'],
}

export interface FakeUserSeed {
  username: string
  password: string
  roles: string[]
  firstName?: string
  lastName?: string
  enabled?: boolean
}

interface FakeUser {
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  enabled: boolean
  createdTimestamp: number
  password: string
  roles: Set<string>
}

export interface FakeKeycloak extends TestSigner {
  baseUrl: string
  jwksUri: string
  userId(username: string): string
  tokenFor(username: string): string
  activeSessions(username: string): number
  close(): Promise<void>
}

type Json = Record<string, unknown> | unknown[]

function send(response: ServerResponse, status: number, body?: Json): void {
  if (body === undefined) {
    response.writeHead(status)
    response.end()
    return
  }
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function representation(user: FakeUser): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    enabled: user.enabled,
    emailVerified: true,
    createdTimestamp: user.createdTimestamp,
  }
}

export async function startFakeKeycloak(
  seeds: FakeUserSeed[],
): Promise<FakeKeycloak> {
  const users = new Map<string, FakeUser>()
  const refreshTokens = new Map<string, string>()
  const adminToken = randomBytes(24).toString('hex')
  const roles = new Map(
    [
      ...BUSINESS_ROLES,
      'PENDIENTE_APROBACION',
      'default-roles-rural-health',
    ].map((name) => [name, { id: randomUUID(), name }]),
  )
  let signer: TestSigner | null = null
  const activeSigner = (): TestSigner => {
    if (!signer) {
      throw new Error('El Keycloak de prueba aún no está escuchando')
    }
    return signer
  }

  const addUser = (seed: FakeUserSeed): FakeUser => {
    const user: FakeUser = {
      id: randomUUID(),
      username: seed.username,
      email: `${seed.username}@rural-health.test`,
      firstName: seed.firstName ?? 'Persona',
      lastName: seed.lastName ?? 'Demo',
      enabled: seed.enabled ?? true,
      createdTimestamp: Date.now(),
      password: seed.password,
      roles: new Set(seed.roles),
    }
    users.set(user.id, user)
    return user
  }
  seeds.forEach(addUser)

  const findByLogin = (login: string): FakeUser | undefined =>
    [...users.values()].find(
      (user) => user.username === login || user.email === login,
    )

  const accessTokenFor = (user: FakeUser): string => {
    const userRoles = [...user.roles].filter((role) =>
      BUSINESS_ROLES.includes(role),
    )
    const scopes = [
      ...new Set(userRoles.flatMap((role) => SCOPES_BY_ROLE[role] ?? [])),
    ]
    return activeSigner().sign({
      clientId: FAKE_LOGIN_CLIENT,
      sub: user.id,
      username: user.username,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      roles: userRoles,
      scopes,
    })
  }

  const issueTokens = (user: FakeUser): Json => {
    const refreshToken = randomBytes(32).toString('base64url')
    refreshTokens.set(refreshToken, user.id)
    return {
      access_token: accessTokenFor(user),
      token_type: 'Bearer',
      expires_in: 300,
      refresh_token: refreshToken,
      refresh_expires_in: 1800,
    }
  }

  const invalidGrant = (response: ServerResponse, description: string) =>
    send(response, 400, {
      error: 'invalid_grant',
      error_description: description,
    })

  const handleToken = (response: ServerResponse, form: URLSearchParams) => {
    const grantType = form.get('grant_type')
    if (grantType === 'client_credentials') {
      if (
        form.get('client_id') === FAKE_ADMIN_CLIENT &&
        form.get('client_secret') === FAKE_ADMIN_SECRET
      ) {
        send(response, 200, {
          access_token: adminToken,
          token_type: 'Bearer',
          expires_in: 300,
        })
        return
      }
      send(response, 401, { error: 'invalid_client' })
      return
    }
    if (form.get('client_id') !== FAKE_LOGIN_CLIENT) {
      send(response, 401, { error: 'invalid_client' })
      return
    }
    if (grantType === 'password') {
      const user = findByLogin(form.get('username') ?? '')
      if (!user || user.password !== form.get('password')) {
        send(response, 401, {
          error: 'invalid_grant',
          error_description: 'Invalid user credentials',
        })
        return
      }
      if (!user.enabled) {
        invalidGrant(response, 'Account disabled')
        return
      }
      send(response, 200, issueTokens(user))
      return
    }
    if (grantType === 'refresh_token') {
      const token = form.get('refresh_token') ?? ''
      const user = users.get(refreshTokens.get(token) ?? '')
      refreshTokens.delete(token)
      if (!user || !user.enabled) {
        invalidGrant(response, 'Invalid refresh token')
        return
      }
      send(response, 200, issueTokens(user))
      return
    }
    send(response, 400, { error: 'unsupported_grant_type' })
  }

  const handleLogout = (response: ServerResponse, form: URLSearchParams) => {
    const token = form.get('refresh_token') ?? ''
    if (
      form.get('client_id') !== FAKE_LOGIN_CLIENT ||
      !refreshTokens.has(token)
    ) {
      invalidGrant(response, 'Invalid refresh token')
      return
    }
    refreshTokens.delete(token)
    send(response, 204)
  }

  const logoutUser = (id: string) => {
    for (const [token, owner] of refreshTokens) {
      if (owner === id) {
        refreshTokens.delete(token)
      }
    }
  }

  const handleAdmin = (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    url: URL,
    body: string,
  ) => {
    if (request.headers.authorization !== `Bearer ${adminToken}`) {
      send(response, 401, { error: 'HTTP 401 Unauthorized' })
      return
    }
    const method = request.method ?? 'GET'
    const segments = path.split('/').filter(Boolean).map(decodeURIComponent)
    const payload = body.length > 0 ? (JSON.parse(body) as unknown) : null
    if (segments[0] === 'roles' && segments.length >= 2) {
      const role = roles.get(segments[1])
      if (!role) {
        send(response, 404, { error: 'Could not find role' })
        return
      }
      if (segments[2] === 'users') {
        const first = Number(url.searchParams.get('first') ?? 0)
        const max = Number(url.searchParams.get('max') ?? 100)
        const members = [...users.values()]
          .filter((user) => user.roles.has(role.name))
          .slice(first, first + max)
          .map(representation)
        send(response, 200, members)
        return
      }
      send(response, 200, role)
      return
    }
    if (segments[0] !== 'users') {
      send(response, 404, { error: 'not found' })
      return
    }
    if (segments.length === 1 && method === 'POST') {
      const input = payload as {
        username: string
        email: string
        firstName: string
        lastName: string
        credentials?: Array<{ value: string }>
      }
      const duplicated = [...users.values()].some(
        (user) =>
          user.username === input.username || user.email === input.email,
      )
      if (duplicated) {
        send(response, 409, { errorMessage: 'User exists with same username' })
        return
      }
      const user = addUser({
        username: input.username,
        password: input.credentials?.[0]?.value ?? '',
        roles: ['default-roles-rural-health'],
        firstName: input.firstName,
        lastName: input.lastName,
      })
      user.email = input.email
      response.writeHead(201, {
        location: `${url.origin}/admin/realms/${FAKE_REALM}/users/${user.id}`,
      })
      response.end()
      return
    }
    const user = users.get(segments[1] ?? '')
    if (!user) {
      send(response, 404, { error: 'User not found' })
      return
    }
    const action = segments.slice(2).join('/')
    if (action === '' && method === 'GET') {
      send(response, 200, representation(user))
      return
    }
    if (action === '' && method === 'PUT') {
      const input = payload as Partial<FakeUser>
      const emailTaken = [...users.values()].some(
        (other) => other.id !== user.id && other.email === input.email,
      )
      if (emailTaken) {
        send(response, 409, { errorMessage: 'User exists with same email' })
        return
      }
      user.email = input.email ?? user.email
      user.firstName = input.firstName ?? user.firstName
      user.lastName = input.lastName ?? user.lastName
      user.enabled = input.enabled ?? user.enabled
      send(response, 204)
      return
    }
    if (action === '' && method === 'DELETE') {
      users.delete(user.id)
      send(response, 204)
      return
    }
    if (action === 'role-mappings/realm') {
      if (method === 'GET') {
        send(
          response,
          200,
          [...user.roles].map((name) => roles.get(name)).filter(Boolean),
        )
        return
      }
      const changes = (payload as Array<{ name: string }>).map(
        (role) => role.name,
      )
      for (const name of changes) {
        if (method === 'POST') {
          user.roles.add(name)
        } else {
          user.roles.delete(name)
        }
      }
      send(response, 204)
      return
    }
    if (action === 'reset-password' && method === 'PUT') {
      const { value } = payload as { value: string }
      if (value.length < 10) {
        send(response, 400, {
          error: 'invalidPasswordMinLengthMessage',
          error_description: 'Invalid password: minimum length 10.',
        })
        return
      }
      user.password = value
      send(response, 204)
      return
    }
    if (action === 'logout' && method === 'POST') {
      logoutUser(user.id)
      send(response, 204)
      return
    }
    send(response, 404, { error: 'not found' })
  }

  const oidcPrefix = `/realms/${FAKE_REALM}/protocol/openid-connect`
  const adminPrefix = `/admin/realms/${FAKE_REALM}`
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
      const body = await readBody(request)
      if (url.pathname === `${oidcPrefix}/certs`) {
        send(response, 200, activeSigner().jwks)
        return
      }
      if (url.pathname === `${oidcPrefix}/token`) {
        handleToken(response, new URLSearchParams(body))
        return
      }
      if (url.pathname === `${oidcPrefix}/logout`) {
        handleLogout(response, new URLSearchParams(body))
        return
      }
      if (url.pathname.startsWith(adminPrefix)) {
        handleAdmin(
          request,
          response,
          url.pathname.slice(adminPrefix.length),
          url,
          body,
        )
        return
      }
      send(response, 404, { error: 'not found' })
    })().catch((error: unknown) => {
      send(response, 500, { error: String(error) })
    })
  })
  const address = await listen(server)
  const baseUrl = `http://127.0.0.1:${address.port}`
  signer = createTestSigner(`${baseUrl}/realms/${FAKE_REALM}`)
  const requireUser = (username: string): FakeUser => {
    const user = findByLogin(username)
    if (!user) {
      throw new Error(`Usuario de prueba desconocido: ${username}`)
    }
    return user
  }
  return {
    ...signer,
    baseUrl,
    jwksUri: `${baseUrl}${oidcPrefix}/certs`,
    userId: (username) => requireUser(username).id,
    tokenFor: (username) => accessTokenFor(requireUser(username)),
    activeSessions: (username) => {
      const id = requireUser(username).id
      return [...refreshTokens.values()].filter((owner) => owner === id).length
    },
    close: () => closeServer(server),
  }
}
