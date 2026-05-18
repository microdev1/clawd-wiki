// Reusable HydraDB upload helpers for a single verified .md (one Claude
// session = one Hydra source). Consumers:
//   - scripts/ingest.ts bulk-uploads everything in data/verified/
//   - scripts/wiki.ts add/sync upload one or a few at a time
//
// Idempotency is enforced via the SQLite ledger in scripts/lib/state.ts —
// the same content_hash twice means a no-op.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hydra, tenantId, TENANT_METADATA_SCHEMA } from './hydra.ts'
import { getSource, updateStatus, upsertSource } from './state.ts'

export type CollectedMeta = {
  sessionId: string
  title?: string
  branch?: string
  startedAt?: string
  model?: string
  turnCount?: number
}

export function parseFrontmatter(md: string): { fm: Record<string, string>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { fm: {}, body: md }
  const fm: Record<string, string> = {}
  for (const line of m[1]!.split('\n')) {
    const lm = line.match(/^([a-z_]+)\s*:\s*(.*)$/)
    if (!lm) continue
    fm[lm[1]!] = lm[2]!.trim()
  }
  return { fm, body: md.slice(m[0].length) }
}

export function sha256(s: string): string {
  return new Bun.CryptoHasher('sha256').update(s).digest('hex')
}

export function loadCollectedMeta(collectedDir: string, session_id: string): CollectedMeta | null {
  const p = join(collectedDir, `${session_id}.json`)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as CollectedMeta
}

export type UploadOutcome =
  | { result: 'skipped'; session_id: string; reason: 'unchanged' }
  | { result: 'uploaded'; session_id: string; source_id: string; status: string; project: string }
  | { result: 'errored'; session_id: string; error: string }

export type UploadOptions = {
  collectedDir: string
  force?: boolean
  // Overrides — useful when calling from `wiki add` with a free-floating note
  // that has no sibling collected meta.
  projectOverride?: string
  branchOverride?: string
  sessionOverride?: string
  startedAtOverride?: string
  titleOverride?: string
}

// Upload one verified-markdown payload (already scrubbed, normalized, linted)
// to HydraDB. Returns a tagged outcome rather than throwing on Hydra error so
// the caller can render a multi-file report.
export async function uploadSession(
  session_id: string,
  md: string,
  options: UploadOptions
): Promise<UploadOutcome> {
  const { fm, body } = parseFrontmatter(md)
  const hash = sha256(md)

  if (!options.force) {
    const existing = getSource(session_id)
    if (existing && existing.content_hash === hash && existing.status !== 'errored') {
      return { result: 'skipped', session_id, reason: 'unchanged' }
    }
  }

  const collected = loadCollectedMeta(options.collectedDir, session_id)
  const project =
    options.projectOverride ?? (fm.project && fm.project !== 'null' ? fm.project : 'unknown')
  const branch = options.branchOverride ?? collected?.branch ?? 'unknown'
  const startedAt = options.startedAtOverride ?? collected?.startedAt ?? ''
  const title = options.titleOverride ?? fm.title ?? collected?.title ?? session_id

  const id = tenantId()
  const appKnowledge = {
    id: session_id,
    tenant_id: id,
    sub_tenant_id: '',
    title,
    type: 'claude-session-distillation',
    timestamp: startedAt,
    content: { markdown: body.trim() },
    tenant_metadata: { project, session_id, branch },
    document_metadata: {
      file_id: session_id,
      started_at: startedAt,
      source_session: session_id,
      title
    }
  }

  upsertSource({
    session_id,
    content_hash: hash,
    source_id: session_id,
    file_id: session_id,
    status: 'pending',
    updated_at: new Date().toISOString()
  })

  try {
    const res = await hydra().upload.knowledge({
      tenant_id: id,
      upsert: true,
      app_knowledge: JSON.stringify(appKnowledge)
    })
    const item = res.results?.[0]
    const newSourceId = item?.source_id ?? session_id
    const initialStatus = item?.status ?? 'queued'
    updateStatus(session_id, initialStatus, newSourceId)
    return { result: 'uploaded', session_id, source_id: newSourceId, status: initialStatus, project }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    updateStatus(session_id, 'errored')
    return { result: 'errored', session_id, error: msg.split('\n')[0]! }
  }
}

// Poll verify_processing for a batch of file_ids until each reaches a terminal
// status. Updates the ledger as statuses come in.
export async function pollUntilDone(file_ids: string[]): Promise<void> {
  if (file_ids.length === 0) return
  const id = tenantId()
  const client = hydra()
  console.log(`polling processing status for ${file_ids.length} sources...`)
  const terminal = new Set(['completed', 'success', 'errored'])
  let remaining = [...file_ids]
  while (remaining.length > 0) {
    const res = await client.upload.verifyProcessing({ tenant_id: id, file_ids: remaining })
    const stillPending: string[] = []
    for (const s of res.statuses) {
      if (terminal.has(s.indexing_status)) {
        updateStatus(s.file_id, s.indexing_status)
        const tag = s.indexing_status === 'errored' ? '✗' : '✓'
        console.log(`  ${tag} ${s.file_id}  ${s.indexing_status}`)
      } else {
        stillPending.push(s.file_id)
      }
    }
    if (stillPending.length === 0) return
    remaining = stillPending
    await Bun.sleep(4000)
  }
}

// Tenant provisioning. Idempotent — safe to call repeatedly. Re-uses the
// hidden array/boolean readiness rules learned from the SDK in practice
// (see project memory: getInfraStatus returns booleans or arrays of booleans,
// flickers `[true, false]` during provisioning).
export async function initTenant(): Promise<void> {
  const id = tenantId()
  const client = hydra()
  console.log(`creating tenant: ${id}`)
  try {
    const res = await client.tenant.create({
      tenant_id: id,
      tenant_metadata_schema: TENANT_METADATA_SCHEMA
    })
    console.log(`  ${res.status}: ${res.message}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('409') || /already.*exists/i.test(msg)) {
      console.log('  tenant already exists; proceeding to poll status')
    } else {
      throw e
    }
  }

  console.log('polling /tenants/infra/status...')
  while (true) {
    const status = await client.tenant.getInfraStatus({ tenant_id: id })
    const infra = (status as unknown as { infra?: Record<string, unknown> }).infra ?? {}
    const summary = Object.entries(infra)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
    console.log(`  ${summary || JSON.stringify(status)}`)
    const values = Object.values(infra)
    if (values.length > 0 && values.every(isReady)) {
      console.log('tenant ready.')
      return
    }
    if (values.some(isErrored)) throw new Error(`tenant provisioning failed: ${JSON.stringify(status)}`)
    await Bun.sleep(3000)
  }
}

function isReady(v: unknown): boolean {
  if (v === true) return true
  if (typeof v === 'string') return ['true', 'ready', 'completed', 'success'].includes(v.toLowerCase())
  if (Array.isArray(v)) return v.length > 0 && v.every(isReady)
  return false
}

function isErrored(v: unknown): boolean {
  if (typeof v === 'string') return ['errored', 'failed', 'error'].includes(v.toLowerCase())
  if (Array.isArray(v)) return v.some(isErrored)
  return false
}
