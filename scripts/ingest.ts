// Stage 2 — ingest verified distillations into HydraDB.
//
// Idempotent: a SQLite ledger (scripts/lib/state.ts) tracks each session's
// content hash and Hydra source_id. A second run skips unchanged sources.
//
// Flags:
//   --init-tenant  Create the configured tenant and poll until provisioned.
//   --status       Print the ledger contents.
//   --force        Re-upload every verified file, ignoring hash matches.
//   --limit N      Cap the upload count this run.
//   --poll         After uploads, poll verify_processing until terminal status.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { hydra, tenantId, TENANT_METADATA_SCHEMA } from './lib/hydra.ts'
import { getSource, upsertSource, updateStatus, listSources } from './lib/state.ts'

const VERIFIED_DIR = join(import.meta.dir, '..', 'data', 'verified')
const COLLECTED_DIR = join(import.meta.dir, '..', 'data', 'collected')

type Args = {
  initTenant: boolean
  status: boolean
  force: boolean
  poll: boolean
  limit: number | null
}

function parseArgs(): Args {
  const a: Args = { initTenant: false, status: false, force: false, poll: false, limit: null }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!
    if (v === '--init-tenant') a.initTenant = true
    else if (v === '--status') a.status = true
    else if (v === '--force') a.force = true
    else if (v === '--poll') a.poll = true
    else if (v === '--limit') a.limit = Number(argv[++i])
  }
  return a
}

function parseFrontmatter(md: string): { fm: Record<string, string>; body: string } {
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

function sha256(s: string): string {
  return new Bun.CryptoHasher('sha256').update(s).digest('hex')
}

type CollectedMeta = {
  sessionId: string
  title?: string
  branch?: string
  startedAt?: string
  model?: string
  turnCount?: number
}

function loadCollectedMeta(session_id: string): CollectedMeta | null {
  const p = join(COLLECTED_DIR, `${session_id}.json`)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as CollectedMeta
}

async function initTenant(): Promise<void> {
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

function printStatus(): void {
  const rows = listSources()
  if (rows.length === 0) {
    console.log('ledger empty.')
    return
  }
  console.log(`${rows.length} sources in ledger:`)
  for (const r of rows) {
    console.log(`  ${r.session_id}  ${r.status.padEnd(14)}  hash=${r.content_hash.slice(0, 10)}  file_id=${r.file_id ?? '-'}`)
  }
}

async function ingestAll(args: Args): Promise<void> {
  const id = tenantId()
  const client = hydra()
  const files = readdirSync(VERIFIED_DIR).filter((f) => f.endsWith('.md')).sort()

  let uploaded = 0
  let skipped = 0
  let errors = 0
  const pendingFileIds: string[] = []

  for (const file of files) {
    if (args.limit !== null && uploaded >= args.limit) break
    const session_id = file.replace(/\.md$/, '')
    const md = readFileSync(join(VERIFIED_DIR, file), 'utf8')
    const { fm, body } = parseFrontmatter(md)
    const hash = sha256(md)

    const existing = getSource(session_id)
    if (!args.force && existing && existing.content_hash === hash && existing.status !== 'errored') {
      skipped++
      continue
    }

    const collected = loadCollectedMeta(session_id)
    const project = fm.project && fm.project !== 'null' ? fm.project : 'unknown'
    const branch = collected?.branch ?? 'unknown'
    const startedAt = collected?.startedAt ?? ''
    const title = fm.title ?? collected?.title ?? session_id

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
      const res = await client.upload.knowledge({
        tenant_id: id,
        upsert: true,
        app_knowledge: JSON.stringify(appKnowledge)
      })
      const item = res.results?.[0]
      const newSourceId = item?.source_id ?? session_id
      const initialStatus = item?.status ?? 'queued'
      updateStatus(session_id, initialStatus, newSourceId)
      pendingFileIds.push(session_id)
      uploaded++
      console.log(`✓ ${session_id}  ${initialStatus}  project=${project}`)
    } catch (e: unknown) {
      errors++
      const msg = e instanceof Error ? e.message : String(e)
      updateStatus(session_id, 'errored')
      console.log(`✗ ${session_id}  ${msg.split('\n')[0]}`)
    }
  }

  console.log()
  console.log(`uploaded: ${uploaded}   skipped: ${skipped}   errors: ${errors}`)

  if (args.poll && pendingFileIds.length > 0) await pollUntilDone(pendingFileIds)
}

async function pollUntilDone(file_ids: string[]): Promise<void> {
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

const args = parseArgs()

if (args.status) {
  printStatus()
} else if (args.initTenant) {
  await initTenant()
} else {
  await ingestAll(args)
}
