// SQLite ledger for HydraDB ingestion. Keyed by session_id; content_hash drives
// idempotency (skip uploads whose payload has not changed since last ingest).

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DB_PATH = join(import.meta.dir, '..', '..', 'data', 'state.sqlite')

let _db: Database | undefined

export function db(): Database {
  if (_db) return _db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      session_id    TEXT PRIMARY KEY,
      content_hash  TEXT NOT NULL,
      source_id     TEXT NOT NULL,
      file_id       TEXT,
      status        TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `)
  return _db
}

export type SourceRow = {
  session_id: string
  content_hash: string
  source_id: string
  file_id: string | null
  status: string
  updated_at: string
}

export function getSource(session_id: string): SourceRow | null {
  return (db().query('SELECT * FROM sources WHERE session_id = ?').get(session_id) as SourceRow | null) ?? null
}

export function upsertSource(row: SourceRow): void {
  db()
    .query(
      `INSERT INTO sources (session_id, content_hash, source_id, file_id, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         content_hash = excluded.content_hash,
         source_id    = excluded.source_id,
         file_id      = excluded.file_id,
         status       = excluded.status,
         updated_at   = excluded.updated_at`
    )
    .run(row.session_id, row.content_hash, row.source_id, row.file_id, row.status, row.updated_at)
}

export function updateStatus(session_id: string, status: string, file_id?: string): void {
  if (file_id) {
    db()
      .query('UPDATE sources SET status = ?, file_id = ?, updated_at = ? WHERE session_id = ?')
      .run(status, file_id, new Date().toISOString(), session_id)
  } else {
    db()
      .query('UPDATE sources SET status = ?, updated_at = ? WHERE session_id = ?')
      .run(status, new Date().toISOString(), session_id)
  }
}

export function listSources(): SourceRow[] {
  return db().query('SELECT * FROM sources ORDER BY session_id').all() as SourceRow[]
}
