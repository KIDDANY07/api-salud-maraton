import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import request from 'supertest'
import type { App } from 'supertest/types'
import { DataSource } from 'typeorm'
import { AuditChainService } from '../src/audit/audit-chain.service'
import { AuditWriterService } from '../src/audit/audit-writer.service'
import { RouteAuditLog } from '../src/audit/entities/route-audit-log.entity'
import { configureApp } from '../src/app.setup'
import {
  FAKE_ADMIN_CLIENT,
  FAKE_ADMIN_SECRET,
  FAKE_LOGIN_CLIENT,
  FAKE_REALM,
  startFakeKeycloak,
  type FakeKeycloak,
} from './utils/fake-keycloak.util'

const DEFAULT_TEST_URL_DB =
  'postgres://rural:rural_demo_password@localhost:5433/rural_routes_e2e'
const PLANNER_CLIENT = 'planificador-app'
const AUDITOR_CLIENT = 'auditor-app'

const DEMO_USERS = [
  {
    username: 'admin.demo',
    password: 'Gestion.Usuarios2026',
    roles: ['ADMIN'],
  },
  {
    username: 'admin2.demo',
    password: 'Gestion.Respaldo2026',
    roles: ['ADMIN'],
  },
  {
    username: 'coordinador.demo',
    password: 'Planifica.Rutas2026',
    roles: ['COORDINADOR'],
  },
  {
    username: 'auditor.demo',
    password: 'Revisa.Trazas2026',
    roles: ['AUDITOR'],
  },
  {
    username: 'equipo.demo',
    password: 'Valida.Campo2026',
    roles: ['EQUIPO_SALUD'],
  },
  { username: 'sinrol.demo', password: 'Sin.Funciones2026', roles: [] },
]

interface RouteBody {
  routeId: string
  stops: Array<{ veredaId: string; legKm: number; cumulativeKm: number }>
  notSelected: Array<{ veredaId: string; excluded: boolean; reason: string }>
  comparison: { strategy: string; selectedVeredaIds: string[] }
  parameters: Record<string, unknown>
  totalDistanceKm: number
  disclaimer: string
}

interface SessionBody {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  user: {
    sub: string
    username: string
    roles: string[]
    scopes: string[]
    permissions: string[]
  }
}

interface FullRouteBody extends RouteBody {
  createdBy: { sub: string | null; username: string | null; roles: string[] }
  review: {
    status: string
    decision: string | null
    observations: string | null
    reviewedBy: { username: string | null } | null
  }
}

interface UserBody {
  id: string
  username: string
  email: string
  enabled: boolean
  roles: string[]
}

interface AuditListBody {
  items: Array<{
    id: string
    status: string
    correlationId: string
    routeId: string | null
    actor: { clientId: string | null; sub: string | null }
  }>
  meta: { page: number; limit: number; totalItems: number }
}

async function recreateDatabase(testUrl: string): Promise<void> {
  const url = new URL(testUrl)
  const databaseName = url.pathname.slice(1)
  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(
      `Nombre de base de datos de prueba inválido: ${databaseName}`,
    )
  }
  url.pathname = '/postgres'
  const admin = new DataSource({ type: 'postgres', url: url.toString() })
  await admin.initialize()
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${databaseName}`)
  } finally {
    await admin.destroy()
  }
  execFileSync(
    process.execPath,
    [join(__dirname, '..', 'database', 'run-sql.js')],
    {
      env: { ...process.env, URL_DB: testUrl },
      stdio: 'pipe',
    },
  )
}

describe('API de rutas rurales (e2e)', () => {
  let app: INestApplication<App>
  let jwks: FakeKeycloak
  let dataSource: DataSource
  let createdRoute: RouteBody

  const plannerToken = () =>
    jwks.sign({
      clientId: PLANNER_CLIENT,
      scopes: ['routes:read', 'routes:write'],
      roles: ['COORDINADOR'],
    })
  const auditorToken = () =>
    jwks.sign({
      clientId: AUDITOR_CLIENT,
      scopes: ['routes:read', 'audit:read'],
      roles: ['AUDITOR'],
    })
  const bearer = (username: string) => `Bearer ${jwks.tokenFor(username)}`
  const login = (username: string, password: string) =>
    http().post('/api/v1/auth/login').send({ username, password })
  const http = () => request(app.getHttpServer())

  beforeAll(async () => {
    const testUrl = process.env.TEST_URL_DB ?? DEFAULT_TEST_URL_DB
    await recreateDatabase(testUrl)
    jwks = await startFakeKeycloak(DEMO_USERS)
    Object.assign(process.env, {
      NODE_ENV: 'test',
      URL_DB: testUrl,
      OAUTH_ISSUER: jwks.issuer,
      OAUTH_AUDIENCE: jwks.audience,
      OAUTH_JWKS_URI: jwks.jwksUri,
      OAUTH_TOKEN_URL: `${jwks.issuer}/protocol/openid-connect/token`,
      KEYCLOAK_BASE_URL: jwks.baseUrl,
      KEYCLOAK_REALM: FAKE_REALM,
      LOGIN_CLIENT_ID: FAKE_LOGIN_CLIENT,
      KEYCLOAK_ADMIN_CLIENT_ID: FAKE_ADMIN_CLIENT,
      KEYCLOAK_ADMIN_CLIENT_SECRET: FAKE_ADMIN_SECRET,
      LOGIN_RATE_LIMIT_MAX: '10000',
      VEREDAS_DATA_PATH: 'data/veredas.json',
      RATE_LIMIT_MAX: '10000',
      LOG_LEVEL: 'silent',
      CORS_ORIGINS: 'http://localhost:3000',
    })
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      )
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
    })
    configureApp(nestApp)
    await nestApp.init()
    app = nestApp
    dataSource = app.get(DataSource)
  })

  afterAll(async () => {
    await app?.close()
    await jwks?.close()
  })

  describe('GET /api/v1/health', () => {
    it('es público y reporta base de datos y dataset', async () => {
      const response = await http().get('/api/v1/health').expect(200)
      expect(response.body).toMatchObject({
        status: 'ok',
        checks: { database: 'up', dataset: { status: 'loaded' } },
      })
      expect(response.headers['x-correlation-id']).toBeDefined()
    })

    it('expone la documentación OpenAPI con OAuth 2.0', async () => {
      const response = await http().get('/docs-json').expect(200)
      const document = response.body as {
        components: { securitySchemes: Record<string, { type: string }> }
      }
      expect(document.components.securitySchemes.oauth2.type).toBe('oauth2')
    })
  })

  describe('autenticación (401)', () => {
    it('rechaza solicitudes sin token', async () => {
      const response = await http()
        .post('/api/v1/routes')
        .set('x-correlation-id', 'e2e-missing-token-01')
        .send({})
        .expect(401)
      expect(response.body).toMatchObject({
        statusCode: 401,
        correlationId: 'e2e-missing-token-01',
      })
    })

    it.each([
      ['firma desconocida', { signWithUnknownKey: true }],
      ['token expirado', { expired: true }],
      ['audiencia incorrecta', { audience: 'otra-api' }],
      ['emisor incorrecto', { issuer: 'http://malicioso.test/realms/x' }],
    ])('rechaza un token con %s', async (_label, overrides) => {
      const token = jwks.sign({
        clientId: PLANNER_CLIENT,
        scopes: ['routes:read', 'routes:write'],
        roles: ['COORDINADOR'],
        ...overrides,
      })
      await http()
        .get('/api/v1/veredas')
        .set('Authorization', `Bearer ${token}`)
        .expect(401)
    })

    it('rechaza un token mal formado', async () => {
      await http()
        .get('/api/v1/veredas')
        .set('Authorization', 'Bearer no-es-un-jwt')
        .expect(401)
    })
  })

  describe('POST /api/v1/routes', () => {
    it('genera una ruta (201) con valores por defecto y comparación', async () => {
      const response = await http()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${plannerToken()}`)
        .set('x-correlation-id', 'e2e-create-route-01')
        .send({})
        .expect(201)
      createdRoute = response.body as RouteBody
      expect(createdRoute.routeId).toMatch(/^[0-9a-f-]{36}$/)
      expect(createdRoute.stops).toHaveLength(5)
      expect(createdRoute.notSelected).toHaveLength(7)
      expect(createdRoute.parameters).toEqual({
        strategy: 'VULNERABILITY_WEIGHTED',
        visitCount: 5,
        alpha: 0.6,
        returnToBase: true,
        excludedVeredaIds: [],
        roadFactor: 1.3,
      })
      expect(createdRoute.comparison.strategy).toBe('NEAREST_NEIGHBOR')
      expect(createdRoute.comparison.selectedVeredaIds).toHaveLength(5)
      expect(createdRoute.disclaimer).toContain('validación humana')
      const full = response.body as FullRouteBody
      expect(full.review).toMatchObject({
        status: 'PENDIENTE_REVISION',
        decision: null,
      })
      expect(full.createdBy).toMatchObject({
        sub: `service-account-${PLANNER_CLIENT}`,
        roles: ['COORDINADOR'],
      })
      expect(JSON.stringify(createdRoute)).not.toContain('vulnerabilityIndex')
      expect(JSON.stringify(createdRoute)).not.toContain('score')
    })

    it('respeta excludedVeredaIds', async () => {
      const excluded = createdRoute.stops[0].veredaId
      const response = await http()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${plannerToken()}`)
        .send({ excludedVeredaIds: [excluded], visitCount: 3, alpha: 0.2 })
        .expect(201)
      const body = response.body as RouteBody
      expect(body.stops.map((stop) => stop.veredaId)).not.toContain(excluded)
      expect(body.notSelected[0]).toMatchObject({
        veredaId: excluded,
        excluded: true,
      })
    })

    it.each([
      ['alpha fuera de rango', { alpha: 2 }, 'alpha debe estar entre 0 y 1'],
      [
        'propiedad no permitida',
        { foo: 'bar' },
        'property foo should not exist',
      ],
      [
        'visitCount mayor que las veredas',
        { visitCount: 13 },
        'visitCount debe estar entre 1 y 12',
      ],
      [
        'visitCount no entero',
        { visitCount: 1.5 },
        'visitCount debe ser un número entero',
      ],
      [
        'vereda inexistente',
        { excludedVeredaIds: ['VS-99'] },
        'veredas inexistentes: VS-99',
      ],
      [
        'estrategia desconocida',
        { strategy: 'RANDOM' },
        'strategy debe ser uno de',
      ],
    ])('responde 400 por %s', async (_label, body, message) => {
      const response = await http()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${plannerToken()}`)
        .send(body)
        .expect(400)
      const errorBody = response.body as { message: string[] }
      expect(errorBody.message.join(' | ')).toContain(message)
    })

    it('responde 403 si falta el scope routes:write y lo audita', async () => {
      const correlationId = `e2e-forbidden-${randomUUID()}`
      await http()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${auditorToken()}`)
        .set('x-correlation-id', correlationId)
        .send({ visitCount: 3 })
        .expect(403)
      const audit = await http()
        .get('/api/v1/audit/routes')
        .query({ status: 'FORBIDDEN', actor: AUDITOR_CLIENT })
        .set('Authorization', `Bearer ${auditorToken()}`)
        .expect(200)
      const body = audit.body as AuditListBody
      const record = body.items.find(
        (item) => item.correlationId === correlationId,
      )
      expect(record).toMatchObject({
        status: 'FORBIDDEN',
        routeId: null,
        actor: { clientId: AUDITOR_CLIENT },
      })
    })

    it('audita los intentos con errores de validación', async () => {
      const response = await http()
        .get('/api/v1/audit/routes')
        .query({ status: 'VALIDATION_ERROR', limit: 100 })
        .set('Authorization', `Bearer ${auditorToken()}`)
        .expect(200)
      const body = response.body as AuditListBody
      expect(body.meta.totalItems).toBe(6)
      expect(
        body.items.every((item) => item.actor.clientId === PLANNER_CLIENT),
      ).toBe(true)
    })
  })

  describe('GET /api/v1/routes/:id y /api/v1/veredas', () => {
    it('devuelve la ruta guardada', async () => {
      const response = await http()
        .get(`/api/v1/routes/${createdRoute.routeId}`)
        .set('Authorization', `Bearer ${auditorToken()}`)
        .expect(200)
      const body = response.body as RouteBody
      expect(body.stops).toEqual(createdRoute.stops)
      expect(body.totalDistanceKm).toBe(createdRoute.totalDistanceKm)
    })

    it('responde 404 para una ruta inexistente y 400 para un id inválido', async () => {
      await http()
        .get(`/api/v1/routes/${randomUUID()}`)
        .set('Authorization', `Bearer ${plannerToken()}`)
        .expect(404)
      await http()
        .get('/api/v1/routes/no-es-uuid')
        .set('Authorization', `Bearer ${plannerToken()}`)
        .expect(400)
    })

    it('lista las veredas con banda de prioridad y sin índice numérico', async () => {
      const response = await http()
        .get('/api/v1/veredas')
        .set('Authorization', `Bearer ${plannerToken()}`)
        .expect(200)
      const body = response.body as {
        simulated: boolean
        veredas: Array<{ priorityBand: string }>
      }
      expect(body.simulated).toBe(true)
      expect(body.veredas).toHaveLength(12)
      expect(
        body.veredas.every((v) =>
          ['ALTA', 'MEDIA', 'BAJA'].includes(v.priorityBand),
        ),
      ).toBe(true)
      expect(JSON.stringify(body)).not.toContain('vulnerabilityIndex')
    })

    it('responde 403 si el token no tiene routes:read', async () => {
      const token = jwks.sign({ clientId: 'sin-scopes', scopes: [] })
      await http()
        .get('/api/v1/veredas')
        .set('Authorization', `Bearer ${token}`)
        .expect(403)
    })
  })

  describe('auditoría', () => {
    it('un cliente sin audit:read no puede consultarla', async () => {
      const token = `Bearer ${plannerToken()}`
      await http()
        .get('/api/v1/audit/routes')
        .set('Authorization', token)
        .expect(403)
      await http()
        .get(`/api/v1/audit/routes/${createdRoute.routeId}`)
        .set('Authorization', token)
        .expect(403)
      await http()
        .post(`/api/v1/audit/routes/${createdRoute.routeId}/verify`)
        .set('Authorization', token)
        .expect(403)
    })

    it('pagina y filtra por fechas, actor y estado', async () => {
      const auth = `Bearer ${auditorToken()}`
      const page = await http()
        .get('/api/v1/audit/routes')
        .query({ limit: 2, page: 1 })
        .set('Authorization', auth)
        .expect(200)
      const pageBody = page.body as AuditListBody
      expect(pageBody.items).toHaveLength(2)
      expect(pageBody.meta).toMatchObject({ page: 1, limit: 2, totalItems: 9 })
      const success = await http()
        .get('/api/v1/audit/routes')
        .query({ status: 'SUCCESS', actor: PLANNER_CLIENT })
        .set('Authorization', auth)
        .expect(200)
      expect((success.body as AuditListBody).meta.totalItems).toBe(2)
      const future = await http()
        .get('/api/v1/audit/routes')
        .query({ from: '2999-01-01T00:00:00Z' })
        .set('Authorization', auth)
        .expect(200)
      expect((future.body as AuditListBody).items).toHaveLength(0)
      await http()
        .get('/api/v1/audit/routes')
        .query({ from: '2026-12-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })
        .set('Authorization', auth)
        .expect(400)
    })

    it('muestra el detalle con el desglose completo e integridad', async () => {
      const response = await http()
        .get(`/api/v1/audit/routes/${createdRoute.routeId}`)
        .set('Authorization', `Bearer ${auditorToken()}`)
        .expect(200)
      const body = response.body as {
        status: string
        correlationId: string
        scopes: string[]
        datasetHash: string
        receivedParameters: unknown
        appliedParameters: { visitCount: number }
        scoreBreakdown: {
          steps: Array<{
            candidates: Array<{ vulnerabilityIndex: number; score: number }>
          }>
        }
        integrity: { recordHashValid: boolean; previousHashValid: boolean }
      }
      expect(body.status).toBe('SUCCESS')
      expect(body.correlationId).toBe('e2e-create-route-01')
      expect(body.scopes).toEqual(['routes:read', 'routes:write'])
      expect(body.datasetHash).toMatch(/^[0-9a-f]{64}$/)
      expect(body.receivedParameters).toEqual({})
      expect(body.appliedParameters.visitCount).toBe(5)
      expect(body.scoreBreakdown.steps).toHaveLength(5)
      expect(body.scoreBreakdown.steps[0].candidates).toHaveLength(12)
      expect(
        typeof body.scoreBreakdown.steps[0].candidates[0].vulnerabilityIndex,
      ).toBe('number')
      expect(typeof body.scoreBreakdown.steps[0].candidates[0].score).toBe(
        'number',
      )
      expect(body.integrity).toEqual({
        recordHashValid: true,
        previousHashValid: true,
      })
    })

    it('/verify confirma que la ruta recalculada coincide', async () => {
      const response = await http()
        .post(`/api/v1/audit/routes/${createdRoute.routeId}/verify`)
        .set('Authorization', `Bearer ${auditorToken()}`)
        .expect(200)
      expect(response.body).toMatchObject({
        routeId: createdRoute.routeId,
        matches: true,
        differences: [],
        datasetVersionChanged: false,
        datasetHashChanged: false,
        algorithmVersionChanged: false,
        integrity: { recordHashValid: true, previousHashValid: true },
      })
      const body = response.body as {
        storedResultHash: string
        recomputedResultHash: string
      }
      expect(body.recomputedResultHash).toBe(body.storedResultHash)
    })

    it('/verify responde 409 para intentos fallidos y 404 para ids desconocidos', async () => {
      const auth = `Bearer ${auditorToken()}`
      const forbidden = await http()
        .get('/api/v1/audit/routes')
        .query({ status: 'FORBIDDEN' })
        .set('Authorization', auth)
        .expect(200)
      const [record] = (forbidden.body as AuditListBody).items
      await http()
        .post(`/api/v1/audit/routes/${record.id}/verify`)
        .set('Authorization', auth)
        .expect(409)
      await http()
        .post(`/api/v1/audit/routes/${randomUUID()}/verify`)
        .set('Authorization', auth)
        .expect(404)
    })

    it('mantiene íntegra la cadena de hashes de todos los registros', async () => {
      const records = await dataSource
        .getRepository(RouteAuditLog)
        .find({ order: { sequence: 'ASC' } })
      expect(records.length).toBe(9)
      expect(app.get(AuditChainService).verifyChain(records)).toMatchObject({
        valid: true,
        checkedRecords: 9,
      })
    })
  })

  describe('integridad en PostgreSQL', () => {
    it.each([
      ['UPDATE', "UPDATE route_audit_logs SET status = 'SUCCESS'"],
      ['DELETE', 'DELETE FROM route_audit_logs'],
      ['TRUNCATE', 'TRUNCATE route_audit_logs CASCADE'],
    ])('el trigger impide %s en la auditoría', async (_operation, sql) => {
      await expect(dataSource.query(sql)).rejects.toThrow('append-only')
    })

    it('si falla la auditoría la ruta no se guarda', async () => {
      const writer = app.get(AuditWriterService)
      const countRoutes = async () =>
        Number(
          (
            await dataSource.query<Array<{ total: number }>>(
              'SELECT count(*)::int AS total FROM routes',
            )
          )[0].total,
        )
      const before = await countRoutes()
      const spy = jest
        .spyOn(writer, 'appendInTransaction')
        .mockRejectedValueOnce(new Error('fallo simulado de auditoría'))
      const response = await http()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${plannerToken()}`)
        .send({ visitCount: 2 })
        .expect(500)
      spy.mockRestore()
      expect((response.body as { message: string }).message).toBe(
        'Error interno del servidor',
      )
      expect(await countRoutes()).toBe(before)
    })
  })

  describe('inicio de sesión (auth)', () => {
    it('inicia sesión y devuelve tokens con el rol y sus permisos', async () => {
      const response = await login(
        'coordinador.demo',
        'Planifica.Rutas2026',
      ).expect(200)
      const body = response.body as SessionBody
      expect(body.tokenType).toBe('Bearer')
      expect(body.expiresIn).toBe(300)
      expect(body.refreshToken.length).toBeGreaterThan(10)
      expect(body.user).toMatchObject({
        username: 'coordinador.demo',
        roles: ['COORDINADOR'],
        scopes: ['routes:read', 'routes:write'],
      })
      expect(body.user.permissions).toEqual(
        expect.arrayContaining(['routes:generate', 'routes:view']),
      )
      expect(body.user.permissions).not.toContain('audit:view')
      const route = await http()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ visitCount: 3 })
        .expect(201)
      expect((route.body as FullRouteBody).createdBy).toMatchObject({
        username: 'coordinador.demo',
        roles: ['COORDINADOR'],
      })
    })

    it('acepta el correo como nombre de usuario', async () => {
      await login('auditor.demo@rural-health.test', 'Revisa.Trazas2026').expect(
        200,
      )
    })

    it('responde 401 con credenciales incorrectas y 400 si falta un campo', async () => {
      const wrong = await login('coordinador.demo', 'otra-clave').expect(401)
      expect((wrong.body as { message: string }).message).toBe(
        'Usuario o contraseña incorrectos',
      )
      await login('desconocido.demo', 'Planifica.Rutas2026').expect(401)
      await http()
        .post('/api/v1/auth/login')
        .send({ username: 'coordinador.demo' })
        .expect(400)
    })

    it('responde 403 si la cuenta no tiene un rol funcional', async () => {
      await login('sinrol.demo', 'Sin.Funciones2026').expect(403)
    })

    it('renueva la sesión, rota el refresh token y la cierra', async () => {
      const first = (await login('equipo.demo', 'Valida.Campo2026').expect(200))
        .body as SessionBody
      const renewed = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200)
      const second = renewed.body as SessionBody
      expect(second.refreshToken).not.toBe(first.refreshToken)
      expect(second.user.roles).toEqual(['EQUIPO_SALUD'])
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401)
      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: second.refreshToken })
        .expect(204)
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401)
    })

    it('GET /auth/me describe la sesión y /auth/roles el catálogo', async () => {
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', bearer('equipo.demo'))
        .expect(200)
      expect(me.body).toMatchObject({
        username: 'equipo.demo',
        roles: ['EQUIPO_SALUD'],
        permissions: ['routes:review', 'routes:view', 'veredas:view'],
      })
      const catalog = await http()
        .get('/api/v1/auth/roles')
        .set('Authorization', bearer('equipo.demo'))
        .expect(200)
      expect(
        (catalog.body as Array<{ role: string }>).map((entry) => entry.role),
      ).toEqual(['ADMIN', 'COORDINADOR', 'AUDITOR', 'EQUIPO_SALUD'])
      await http().get('/api/v1/auth/me').expect(401)
    })
  })

  describe('segregación de funciones por rol', () => {
    it.each([
      ['equipo.demo', 'post', '/api/v1/routes'],
      ['admin.demo', 'post', '/api/v1/routes'],
      ['auditor.demo', 'post', '/api/v1/routes'],
      ['coordinador.demo', 'get', '/api/v1/audit/routes'],
      ['equipo.demo', 'get', '/api/v1/audit/routes'],
      ['admin.demo', 'get', '/api/v1/audit/routes'],
      ['coordinador.demo', 'get', '/api/v1/users'],
      ['auditor.demo', 'get', '/api/v1/users'],
      ['equipo.demo', 'get', '/api/v1/users'],
    ] as const)(
      '%s no puede usar %s %s (403)',
      async (username, method, path) => {
        await http()
          [method](path)
          .set('Authorization', bearer(username))
          .send({})
          .expect(403)
      },
    )

    it.each(['admin.demo', 'coordinador.demo', 'auditor.demo', 'equipo.demo'])(
      '%s puede consultar veredas y rutas',
      async (username) => {
        await http()
          .get('/api/v1/veredas')
          .set('Authorization', bearer(username))
          .expect(200)
        await http()
          .get('/api/v1/routes')
          .set('Authorization', bearer(username))
          .expect(200)
      },
    )

    it('exige el rol aunque el token tenga el scope y audita el rechazo', async () => {
      const correlationId = `e2e-role-forbidden-${randomUUID()}`
      const forged = jwks.sign({
        clientId: 'cliente-mal-configurado',
        scopes: ['routes:read', 'routes:write', 'audit:read', 'users:manage'],
        roles: ['EQUIPO_SALUD'],
      })
      const response = await http()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${forged}`)
        .set('x-correlation-id', correlationId)
        .send({})
        .expect(403)
      expect((response.body as { message: string }).message).toContain(
        'COORDINADOR',
      )
      await http()
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${forged}`)
        .expect(403)
      const audit = await http()
        .get('/api/v1/audit/routes')
        .query({ status: 'FORBIDDEN', actor: 'cliente-mal-configurado' })
        .set('Authorization', `Bearer ${auditorToken()}`)
        .expect(200)
      const record = (audit.body as AuditListBody).items.find(
        (item) => item.correlationId === correlationId,
      ) as unknown as { actor: { roles: string[] } } | undefined
      expect(record?.actor.roles).toEqual(['EQUIPO_SALUD'])
    })

    it('exige el scope aunque el usuario tenga el rol', async () => {
      const token = jwks.sign({
        clientId: FAKE_LOGIN_CLIENT,
        scopes: ['routes:read'],
        roles: ['COORDINADOR'],
      })
      await http()
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403)
    })
  })

  describe('validación humana de rutas', () => {
    let route: FullRouteBody

    beforeAll(async () => {
      const response = await http()
        .post('/api/v1/routes')
        .set('Authorization', bearer('coordinador.demo'))
        .send({ visitCount: 4 })
        .expect(201)
      route = response.body as FullRouteBody
    })

    it('la ruta nueva aparece como pendiente de revisión', async () => {
      const response = await http()
        .get('/api/v1/routes')
        .query({
          reviewStatus: 'PENDIENTE_REVISION',
          createdBy: 'coordinador.demo',
        })
        .set('Authorization', bearer('equipo.demo'))
        .expect(200)
      const body = response.body as {
        items: Array<{
          routeId: string
          reviewStatus: string
          veredaIds: string[]
        }>
        meta: { totalItems: number }
      }
      const item = body.items.find((entry) => entry.routeId === route.routeId)
      expect(item).toMatchObject({ reviewStatus: 'PENDIENTE_REVISION' })
      expect(item?.veredaIds).toHaveLength(4)
    })

    it('solo EQUIPO_SALUD puede validar', async () => {
      for (const username of [
        'coordinador.demo',
        'auditor.demo',
        'admin.demo',
      ]) {
        await http()
          .post(`/api/v1/routes/${route.routeId}/review`)
          .set('Authorization', bearer(username))
          .send({ decision: 'APROBADA' })
          .expect(403)
      }
    })

    it('quien generó la ruta no puede validarla', async () => {
      const sameperson = jwks.sign({
        clientId: FAKE_LOGIN_CLIENT,
        sub: jwks.userId('coordinador.demo'),
        username: 'coordinador.demo',
        scopes: ['routes:read', 'routes:review'],
        roles: ['EQUIPO_SALUD'],
      })
      const response = await http()
        .post(`/api/v1/routes/${route.routeId}/review`)
        .set('Authorization', `Bearer ${sameperson}`)
        .send({ decision: 'APROBADA' })
        .expect(403)
      expect((response.body as { message: string }).message).toContain(
        'Segregación de funciones',
      )
    })

    it('exige observaciones para rechazar y valida la decisión', async () => {
      await http()
        .post(`/api/v1/routes/${route.routeId}/review`)
        .set('Authorization', bearer('equipo.demo'))
        .send({ decision: 'RECHAZADA' })
        .expect(400)
      await http()
        .post(`/api/v1/routes/${route.routeId}/review`)
        .set('Authorization', bearer('equipo.demo'))
        .send({ decision: 'TAL_VEZ' })
        .expect(400)
    })

    it('registra la aprobación (201) y no admite una segunda (409)', async () => {
      const response = await http()
        .post(`/api/v1/routes/${route.routeId}/review`)
        .set('Authorization', bearer('equipo.demo'))
        .send({ decision: 'APROBADA', observations: 'Vías transitables.' })
        .expect(201)
      expect((response.body as FullRouteBody).review).toMatchObject({
        status: 'APROBADA',
        decision: 'APROBADA',
        observations: 'Vías transitables.',
        reviewedBy: { username: 'equipo.demo' },
      })
      await http()
        .post(`/api/v1/routes/${route.routeId}/review`)
        .set('Authorization', bearer('equipo.demo'))
        .send({ decision: 'RECHAZADA', observations: 'Cambio de opinión' })
        .expect(409)
      const stored = await http()
        .get(`/api/v1/routes/${route.routeId}`)
        .set('Authorization', bearer('auditor.demo'))
        .expect(200)
      expect((stored.body as FullRouteBody).review.status).toBe('APROBADA')
      const approved = await http()
        .get('/api/v1/routes')
        .query({ reviewStatus: 'APROBADA' })
        .set('Authorization', bearer('coordinador.demo'))
        .expect(200)
      expect(
        (approved.body as { items: Array<{ routeId: string }> }).items.map(
          (item) => item.routeId,
        ),
      ).toEqual([route.routeId])
    })

    it('responde 404 para rutas inexistentes y protege la tabla', async () => {
      await http()
        .post(`/api/v1/routes/${randomUUID()}/review`)
        .set('Authorization', bearer('equipo.demo'))
        .send({ decision: 'APROBADA' })
        .expect(404)
      await expect(
        dataSource.query("UPDATE route_reviews SET decision = 'RECHAZADA'"),
      ).rejects.toThrow('append-only')
    })
  })

  describe('registro de usuarios (POST /auth/register)', () => {
    const registration = {
      username: 'Promotora.Guaduas',
      email: 'promotora.guaduas@rural-health.test',
      firstName: 'Marta',
      lastName: 'Guzmán',
      password: 'Promueve.Salud2026',
    }

    it('registra la cuenta (201) pendiente de aprobación y sin rol', async () => {
      const response = await http()
        .post('/api/v1/auth/register')
        .send(registration)
        .expect(201)
      expect(response.body).toMatchObject({
        username: 'promotora.guaduas',
        email: 'promotora.guaduas@rural-health.test',
        pendingApproval: true,
      })
      expect(JSON.stringify(response.body)).not.toContain('Promueve.Salud2026')
      const blocked = await login(
        'promotora.guaduas',
        'Promueve.Salud2026',
      ).expect(403)
      expect((blocked.body as { message: string }).message).toContain(
        'administrador',
      )
    })

    it.each([
      ['usuario repetido', { email: 'otro@rural-health.test' }, 409],
      ['correo repetido', { username: 'otra.persona' }, 409],
      [
        'intento de elegir rol',
        {
          username: 'otra.persona',
          email: 'o@rural-health.test',
          role: 'ADMIN',
        },
        400,
      ],
      [
        'contraseña débil',
        {
          username: 'otra.persona',
          email: 'o@rural-health.test',
          password: 'debil',
        },
        400,
      ],
      [
        'usuario inválido',
        { username: 'X', email: 'o@rural-health.test' },
        400,
      ],
      [
        'correo inválido',
        { username: 'otra.persona', email: 'no-es-correo' },
        400,
      ],
    ])('rechaza el registro por %s', async (_label, overrides, status) => {
      await http()
        .post('/api/v1/auth/register')
        .send({ ...registration, ...overrides })
        .expect(status)
    })

    it('el ADMIN ve la cuenta pendiente, la aprueba y la persona entra con ese rol', async () => {
      const pending = await http()
        .get('/api/v1/users')
        .query({ pendingApproval: 'true' })
        .set('Authorization', bearer('admin.demo'))
        .expect(200)
      const items = (
        pending.body as {
          items: Array<UserBody & { pendingApproval: boolean }>
        }
      ).items
      expect(items).toEqual([
        expect.objectContaining({
          username: 'promotora.guaduas',
          roles: [],
          pendingApproval: true,
        }),
      ])
      const approved = await http()
        .put(`/api/v1/users/${items[0].id}/role`)
        .set('Authorization', bearer('admin.demo'))
        .send({ role: 'EQUIPO_SALUD' })
        .expect(200)
      expect(approved.body).toMatchObject({
        roles: ['EQUIPO_SALUD'],
        pendingApproval: false,
      })
      const session = await login(
        'promotora.guaduas',
        'Promueve.Salud2026',
      ).expect(200)
      expect((session.body as SessionBody).user.roles).toEqual(['EQUIPO_SALUD'])
      const stillPending = await http()
        .get('/api/v1/users')
        .query({ pendingApproval: 'true' })
        .set('Authorization', bearer('admin.demo'))
        .expect(200)
      expect((stillPending.body as { items: unknown[] }).items).toHaveLength(0)
    })
  })

  describe('gestión de usuarios (ADMIN)', () => {
    const admin = () => bearer('admin.demo')
    let createdUser: UserBody

    it('lista usuarios con filtros por rol y texto', async () => {
      const all = await http()
        .get('/api/v1/users')
        .set('Authorization', admin())
        .expect(200)
      const allBody = all.body as {
        items: UserBody[]
        meta: { totalItems: number }
      }
      expect(allBody.items.map((user) => user.username)).toEqual([
        'admin.demo',
        'admin2.demo',
        'auditor.demo',
        'coordinador.demo',
        'equipo.demo',
        'promotora.guaduas',
      ])
      const byRole = await http()
        .get('/api/v1/users')
        .query({ role: 'EQUIPO_SALUD', search: 'EQUIPO', enabled: 'true' })
        .set('Authorization', admin())
        .expect(200)
      expect((byRole.body as { items: UserBody[] }).items).toEqual([
        expect.objectContaining({
          username: 'equipo.demo',
          roles: ['EQUIPO_SALUD'],
        }),
      ])
      await http()
        .get('/api/v1/users')
        .query({ role: 'SUPERUSUARIO' })
        .set('Authorization', admin())
        .expect(400)
    })

    it('crea un usuario con rol que puede iniciar sesión', async () => {
      const response = await http()
        .post('/api/v1/users')
        .set('Authorization', admin())
        .send({
          username: 'Enfermera.Zipaquira',
          email: 'enfermera.zipaquira@rural-health.test',
          firstName: 'Laura',
          lastName: 'Rincón',
          role: 'EQUIPO_SALUD',
          password: 'Visita.Rural2026',
        })
        .expect(201)
      createdUser = response.body as UserBody
      expect(createdUser).toMatchObject({
        username: 'enfermera.zipaquira',
        enabled: true,
        roles: ['EQUIPO_SALUD'],
      })
      const session = await login(
        'enfermera.zipaquira',
        'Visita.Rural2026',
      ).expect(200)
      expect((session.body as SessionBody).user.roles).toEqual(['EQUIPO_SALUD'])
      await http()
        .get(`/api/v1/users/${createdUser.id}`)
        .set('Authorization', admin())
        .expect(200)
    })

    it.each([
      [
        'usuario repetido',
        { username: 'equipo.demo', email: 'nuevo@rural-health.test' },
        409,
      ],
      ['contraseña débil', { password: 'corta' }, 400],
      [
        'contraseña con el usuario',
        { username: 'campo.rural', password: 'Campo.Rural2026x' },
        400,
      ],
      ['rol inexistente', { role: 'ROOT' }, 400],
      ['campo no permitido', { isAdmin: true }, 400],
    ])('rechaza la creación por %s', async (_label, overrides, status) => {
      await http()
        .post('/api/v1/users')
        .set('Authorization', admin())
        .send({
          username: 'nuevo.usuario',
          email: 'nuevo.usuario@rural-health.test',
          firstName: 'Nuevo',
          lastName: 'Usuario',
          role: 'AUDITOR',
          password: 'Clave.Segura2026',
          ...overrides,
        })
        .expect(status)
    })

    it('cambia el rol y cierra las sesiones del usuario', async () => {
      await login('enfermera.zipaquira', 'Visita.Rural2026').expect(200)
      expect(jwks.activeSessions('enfermera.zipaquira')).toBeGreaterThan(0)
      const response = await http()
        .put(`/api/v1/users/${createdUser.id}/role`)
        .set('Authorization', admin())
        .send({ role: 'AUDITOR' })
        .expect(200)
      expect((response.body as UserBody).roles).toEqual(['AUDITOR'])
      expect(jwks.activeSessions('enfermera.zipaquira')).toBe(0)
      const session = await login(
        'enfermera.zipaquira',
        'Visita.Rural2026',
      ).expect(200)
      expect((session.body as SessionBody).user.scopes).toEqual([
        'audit:read',
        'routes:read',
      ])
    })

    it('restablece la contraseña y deshabilita la cuenta', async () => {
      await http()
        .put(`/api/v1/users/${createdUser.id}/password`)
        .set('Authorization', admin())
        .send({ password: 'Nueva.Clave2026' })
        .expect(204)
      await login('enfermera.zipaquira', 'Visita.Rural2026').expect(401)
      await login('enfermera.zipaquira', 'Nueva.Clave2026').expect(200)
      const response = await http()
        .patch(`/api/v1/users/${createdUser.id}`)
        .set('Authorization', admin())
        .send({ enabled: false, firstName: 'Laura Marcela' })
        .expect(200)
      expect(response.body).toMatchObject({
        enabled: false,
        firstName: 'Laura Marcela',
      })
      await login('enfermera.zipaquira', 'Nueva.Clave2026').expect(401)
      const disabled = await http()
        .get('/api/v1/users')
        .query({ enabled: 'false' })
        .set('Authorization', admin())
        .expect(200)
      expect(
        (disabled.body as { items: UserBody[] }).items.map((u) => u.username),
      ).toEqual(['enfermera.zipaquira'])
    })

    it('un administrador no puede deshabilitarse ni quitarse el rol', async () => {
      const adminId = jwks.userId('admin.demo')
      await http()
        .patch(`/api/v1/users/${adminId}`)
        .set('Authorization', admin())
        .send({ enabled: false })
        .expect(409)
      await http()
        .put(`/api/v1/users/${adminId}/role`)
        .set('Authorization', admin())
        .send({ role: 'AUDITOR' })
        .expect(409)
      const otherAdmin = await http()
        .put(`/api/v1/users/${jwks.userId('admin2.demo')}/role`)
        .set('Authorization', admin())
        .send({ role: 'COORDINADOR' })
        .expect(200)
      expect((otherAdmin.body as UserBody).roles).toEqual(['COORDINADOR'])
    })

    it('responde 404 y 400 para identificadores desconocidos o inválidos', async () => {
      await http()
        .get(`/api/v1/users/${randomUUID()}`)
        .set('Authorization', admin())
        .expect(404)
      await http()
        .get('/api/v1/users/no-es-uuid')
        .set('Authorization', admin())
        .expect(400)
    })

    it('cada usuario puede cambiar su propia contraseña', async () => {
      await http()
        .put('/api/v1/users/me/password')
        .set('Authorization', bearer('equipo.demo'))
        .send({
          currentPassword: 'incorrecta',
          newPassword: 'Campo.Seguro2026',
        })
        .expect(400)
      await http()
        .put('/api/v1/users/me/password')
        .set('Authorization', bearer('equipo.demo'))
        .send({
          currentPassword: 'Valida.Campo2026',
          newPassword: 'Campo.Seguro2026',
        })
        .expect(204)
      await login('equipo.demo', 'Valida.Campo2026').expect(401)
      await login('equipo.demo', 'Campo.Seguro2026').expect(200)
      await http()
        .put('/api/v1/users/me/password')
        .set('Authorization', `Bearer ${plannerToken()}`)
        .send({ currentPassword: 'x', newPassword: 'Campo.Seguro2026' })
        .expect(403)
    })
  })
})
