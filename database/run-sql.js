require('dotenv').config({ quiet: true })
const { createHash } = require('node:crypto')
const { readdirSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { Client } = require('pg')

const MIGRATIONS_DIR = resolve(__dirname, 'migrations')
const MIGRATION_LOCK_KEY = 72410531
const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/

function log(level, message, extra = {}) {
  const entry = { level, time: new Date().toISOString(), context: 'db:migrate', message, ...extra }
  const output = level === 'error' ? process.stderr : process.stdout
  output.write(`${JSON.stringify(entry)}\n`)
}

function checksumOf(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function listMigrationFiles(directory) {
  return readdirSync(directory)
    .filter((file) => MIGRATION_FILE_PATTERN.test(file))
    .sort((left, right) => left.localeCompare(right))
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename varchar(255) PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function loadAppliedMigrations(client) {
  const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations')
  return new Map(rows.map((row) => [row.filename, row.checksum]))
}

async function applyMigration(client, filename, sql, checksum) {
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [filename, checksum])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw new Error(`La migración ${filename} falló: ${error.message}`)
  }
}

async function runMigrations(connectionString, directory = MIGRATIONS_DIR) {
  const client = new Client({ connectionString })
  await client.connect()
  const applied = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await ensureMigrationsTable(client)
    const alreadyApplied = await loadAppliedMigrations(client)
    for (const filename of listMigrationFiles(directory)) {
      const sql = readFileSync(join(directory, filename), 'utf8')
      const checksum = checksumOf(sql)
      const recordedChecksum = alreadyApplied.get(filename)
      if (recordedChecksum !== undefined) {
        if (recordedChecksum.trim() !== checksum) {
          throw new Error(`La migración ${filename} cambió después de aplicarse; crea una nueva migración en lugar de editarla`)
        }
        log('info', 'Migración ya aplicada, se omite', { filename })
        continue
      }
      await applyMigration(client, filename, sql, checksum)
      applied.push(filename)
      log('info', 'Migración aplicada', { filename })
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined)
    await client.end()
  }
  return applied
}

async function main() {
  const connectionString = process.env.URL_DB
  if (!connectionString) {
    throw new Error('No está configurada la variable URL_DB')
  }
  const applied = await runMigrations(connectionString)
  log('info', 'Migraciones completadas', { appliedCount: applied.length })
}

module.exports = { runMigrations, listMigrationFiles, checksumOf }

if (require.main === module) {
  main().catch((error) => {
    log('error', 'No se aplicaron las migraciones', { error: error.message })
    process.exit(1)
  })
}
