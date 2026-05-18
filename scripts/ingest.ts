// Stage 2 — ingest all data/verified/*.md into HydraDB.
//
// Idempotent: a SQLite ledger (scripts/lib/state.ts) tracks each session's
// content hash and Hydra source_id. A second run skips unchanged sources.
// For single-file incremental upload from inside an agent loop, see
// `scripts/wiki.ts add`.
//
// Flags:
//   --init-tenant  Create the configured tenant and poll until provisioned.
//   --status       Print the ledger contents.
//   --force        Re-upload every verified file, ignoring hash matches.
//   --limit N      Cap the upload count this run.
//   --poll         After uploads, poll verify_processing until terminal status.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { initTenant, pollUntilDone, uploadSession } from './lib/upload.ts'
import { listSources } from './lib/state.ts'

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
  const files = readdirSync(VERIFIED_DIR).filter((f) => f.endsWith('.md')).sort()

  let uploaded = 0
  let skipped = 0
  let errors = 0
  const pendingFileIds: string[] = []

  for (const file of files) {
    if (args.limit !== null && uploaded >= args.limit) break
    const session_id = file.replace(/\.md$/, '')
    const md = readFileSync(join(VERIFIED_DIR, file), 'utf8')
    const outcome = await uploadSession(session_id, md, {
      collectedDir: COLLECTED_DIR,
      force: args.force
    })
    if (outcome.result === 'skipped') {
      skipped++
    } else if (outcome.result === 'uploaded') {
      uploaded++
      pendingFileIds.push(session_id)
      console.log(`✓ ${session_id}  ${outcome.status}  project=${outcome.project}`)
    } else {
      errors++
      console.log(`✗ ${session_id}  ${outcome.error}`)
    }
  }

  console.log()
  console.log(`uploaded: ${uploaded}   skipped: ${skipped}   errors: ${errors}`)

  if (args.poll && pendingFileIds.length > 0) await pollUntilDone(pendingFileIds)
}

const args = parseArgs()

if (args.status) {
  printStatus()
} else if (args.initTenant) {
  await initTenant()
} else {
  await ingestAll(args)
}
