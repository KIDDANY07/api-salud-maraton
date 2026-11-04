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
import { startTestJwks, type TestJwks } from './utils/jwks-test.util'

const DEFAULT_TEST_URL_DB =
  'postgres://rural:rural_demo_password@localhost:5433/rural_routes_e2e'
const PLANNER_CLIENT = 'planificador-app'
const AUDITOR_CLIENT = 'auditor-app'

interface RouteBody {
  routeId: string
  stops: Array<{ veredaId: string; legKm: number; cumulativeKm: number }>
  notSelected: Array<{ veredaId: string; excluded: boolean; reason: string }>
  comparison: { strategy: string; selectedVeredaIds: string[] }
  parameters: Record<string, unknown>
  totalDistanceKm: number
  disclaimer: string
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
  let jwks: TestJwks
  let dataSource: DataSource
  let createdRoute: RouteBody

  const plannerToken = () =>
    jwks.sign({
      clientId: PLANNER_CLIENT,
      scopes: ['routes:read', 'routes:write'],
    })
  const auditorToken = () =>
    jwks.sign({
      clientId: AUDITOR_CLIENT,
      scopes: ['routes:read', 'audit:read'],
    })
  const http = () => request(app.getHttpServer())

  beforeAll(async () => {
    const testUrl = process.env.TEST_URL_DB ?? DEFAULT_TEST_URL_DB
    await recreateDatabase(testUrl)
    jwks = await startTestJwks()
    Object.assign(process.env, {
      NODE_ENV: 'test',
      URL_DB: testUrl,
      OAUTH_ISSUER: jwks.issuer,
      OAUTH_AUDIENCE: jwks.audience,
      OAUTH_JWKS_URI: jwks.jwksUri,
      OAUTH_TOKEN_URL:
        'http://issuer.test/realms/rural-health/protocol/openid-connect/token',
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
})
