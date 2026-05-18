// MCP-shaped, agent-callable CLI. The wiki pipeline (collect → distill →
// verify → MDX) is fully local and never blocks on HydraDB. Hydra is the
// search/recall layer over both Knowledge (verified session distillations)
// and Memories (Claude Code auto-memory across projects).
//
// Verb taxonomy:
//
//   local-only — wiki MDX pipeline (no network):
//     add <path.md> [--session=ID]
//       Run verify gate, write to data/verified/, incrementally rebuild
//       affected MDX pages.
//     sync [--regenerate-all]
//       Rebuild MDX from data/verified/. Default: full rebuild via generate.ts.
//     status                Pipeline + ledger summaries.
//     list [--type=...] [--project=...]
//     show <type>:<slug>
//
//   hydra knowledge (session distillations):
//     upload [--limit=N] [--poll] [--force]
//       Upload changed verified files to Hydra Knowledge. Best-effort.
//     recall <query> [--project=X] [--limit=N] [--json]
//       full_recall over Knowledge chunks + graph.
//
//   hydra memories (Claude auto-memory, cross-project):
//     memory-sync [--limit=N] [--include-project=X] [--infer] [--force]
//       Upload changed ~/.claude/projects/*/memory/*.md as Memories.
//     memory-recall <query> [--project=X] [--limit=N] [--json]
//       recall_preferences over Memories.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { hydra, tenantId } from './lib/hydra.ts'
import { lintSlugs } from './lib/lint.ts'
import {
  discoverMemoryFiles,
  memorySubTenant,
  recallMemories,
  uploadMemoryFile,
  type MemoryRecallChunk
} from './lib/memories.ts'
import { normalize } from './lib/normalize.ts'
import { scan } from './lib/scrub.ts'
import { buildIndex, SLUG_TYPES, type SlugType, type WikiIndex } from './lib/slugs.ts'
import {
  ensureOutDirs,
  projectPagePath,
  renderProjectPage,
  renderSlugPage,
  slugPagePath,
  writeIndexAndGraph
} from './lib/render.ts'
import { listMemories, listSources } from './lib/state.ts'
import { pollUntilDone, sha256, uploadSession } from './lib/upload.ts'

const ROOT = join(import.meta.dir, '..')
const COLLECTED_DIR = join(ROOT, 'data', 'collected')
const DISTILLED_DIR = join(ROOT, 'data', 'distilled')
const VERIFIED_DIR = join(ROOT, 'data', 'verified')
const QUARANTINE_DIR = join(ROOT, 'data', 'quarantine')
const OUT_DIR = join(ROOT, 'app', 'content', 'wiki')

type Flags = Record<string, string | boolean>

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = []
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!
    if (v.startsWith('--')) {
      const eq = v.indexOf('=')
      if (eq >= 0) flags[v.slice(2, eq)] = v.slice(eq + 1)
      else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          flags[v.slice(2)] = next
          i++
        } else {
          flags[v.slice(2)] = true
        }
      }
    } else {
      positional.push(v)
    }
  }
  return { positional, flags }
}

function usage(): never {
  console.error(
    [
      'usage: bun scripts/wiki.ts <verb> [...args]',
      '',
      'local (no network):',
      '  add    <path.md>         [--session=ID]',
      '  sync                     [--regenerate-all]',
      '  status',
      '  list                     [--type=concept|pitfall|work|project] [--project=X]',
      '  show   <type>:<slug>',
      '',
      'hydra knowledge:',
      '  upload                   [--limit=N] [--poll] [--force]',
      '  recall <query>           [--project=X] [--limit=N] [--json]',
      '',
      'hydra memories (claude auto-memory):',
      '  memory-sync              [--limit=N] [--include-project=X] [--infer] [--force]',
      '  memory-recall <query>    [--project=X] [--limit=N] [--json]',
      ''
    ].join('\n')
  )
  process.exit(2)
}

// ----- add (local-only) ------------------------------------------------------

function cmdAdd(positional: string[], flags: Flags): void {
  const src = positional[0]
  if (!src) {
    console.error('add: missing path')
    process.exit(2)
  }
  const path = resolve(src)
  if (!existsSync(path)) {
    console.error(`add: file not found: ${path}`)
    process.exit(2)
  }
  const raw = readFileSync(path, 'utf8')

  // Verify gate, identical to scripts/verify.ts on a single file.
  const { text: normalized, changes } = normalize(raw)
  const scrubReport = scan(normalized)
  const lintReport = lintSlugs(normalized)
  const fail = scrubReport.total > 0 || !lintReport.ok

  if (fail) {
    console.error(`✗ ${basename(path)} failed verify gate:`)
    if (scrubReport.total > 0) console.error(`  scrub hits: ${JSON.stringify(scrubReport.hits)}`)
    if (!lintReport.ok) {
      for (const v of lintReport.violations) console.error(`  lint: ${JSON.stringify(v)}`)
    }
    const bad = join(QUARANTINE_DIR, basename(path))
    writeFileSync(bad, normalized)
    writeFileSync(
      bad.replace(/\.md$/, '.report.json'),
      JSON.stringify(
        {
          scrub: scrubReport.total > 0 ? scrubReport : null,
          lint: lintReport.ok ? null : lintReport,
          normalize: changes.length > 0 ? changes : null
        },
        null,
        2
      )
    )
    console.error(`  quarantined to ${bad}`)
    process.exit(1)
  }

  const session_id =
    typeof flags.session === 'string' ? flags.session : basename(path).replace(/\.md$/, '')
  const verifiedPath = join(VERIFIED_DIR, `${session_id}.md`)
  writeFileSync(verifiedPath, normalized)
  if (changes.length > 0) {
    console.log(
      `✓ ${basename(path)} normalized (${changes.length} frontmatter fix${changes.length === 1 ? '' : 'es'}) → ${verifiedPath}`
    )
  } else {
    console.log(`✓ ${basename(path)} → ${verifiedPath}`)
  }

  incrementalSync([session_id])
  console.log(`(Hydra upload is separate — run \`bun scripts/wiki.ts upload\` when ready)`)
}

// ----- sync (local-only) -----------------------------------------------------

async function cmdSync(_positional: string[], flags: Flags): Promise<void> {
  if (flags['regenerate-all'] === true) {
    await fullRegenerate()
    return
  }
  // Default sync is also a full rebuild — incremental requires knowing "what
  // changed since last MDX write," which we don't track standalone. `wiki add`
  // is the incremental hook. `sync` is the catch-up button for everything else.
  await fullRegenerate()
}

function incrementalSync(changedSessionIds: string[]): void {
  const changed = new Set(changedSessionIds)
  const index = buildIndex(VERIFIED_DIR)
  ensureOutDirs(OUT_DIR)

  let pages = 0
  for (const entry of index.slugs.values()) {
    if (!entry.sources.some((s) => changed.has(s))) continue
    writeFileSync(slugPagePath(OUT_DIR, entry), renderSlugPage(entry, index))
    pages++
  }
  for (const project of index.projects.values()) {
    if (!project.sources.some((s) => changed.has(s))) continue
    writeFileSync(projectPagePath(OUT_DIR, project), renderProjectPage(project, index))
    pages++
  }
  writeIndexAndGraph(OUT_DIR, index)
  console.log(`incremental sync: rewrote ${pages} page${pages === 1 ? '' : 's'} + index.mdx + graph.json`)
}

async function fullRegenerate(): Promise<void> {
  const { spawnSync } = await import('node:child_process')
  const res = spawnSync('bun', [join(ROOT, 'scripts', 'generate.ts')], { stdio: 'inherit' })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

// ----- upload (hydra knowledge) ----------------------------------------------

async function cmdUpload(_positional: string[], flags: Flags): Promise<void> {
  const files = readdirSync(VERIFIED_DIR).filter((f) => f.endsWith('.md')).sort()
  const ledger = new Map(listSources().map((r) => [r.session_id, r]))
  const force = flags.force === true

  type Pending = { session_id: string; md: string }
  const pending: Pending[] = []
  for (const file of files) {
    const session_id = file.replace(/\.md$/, '')
    const md = readFileSync(join(VERIFIED_DIR, file), 'utf8')
    const hash = sha256(md)
    const prev = ledger.get(session_id)
    if (force || !prev || prev.content_hash !== hash || prev.status === 'errored') {
      pending.push({ session_id, md })
    }
  }

  const limit = flags.limit ? Number(flags.limit) : null
  const queue = limit ? pending.slice(0, limit) : pending

  console.log(`pending verified files: ${pending.length}${limit ? ` (uploading first ${queue.length})` : ''}`)

  const uploadedIds: string[] = []
  let errors = 0
  for (const { session_id, md } of queue) {
    const outcome = await uploadSession(session_id, md, { collectedDir: COLLECTED_DIR, force })
    if (outcome.result === 'uploaded') {
      uploadedIds.push(session_id)
      console.log(`✓ ${session_id}  ${outcome.status}  project=${outcome.project}`)
    } else if (outcome.result === 'skipped') {
      console.log(`= ${session_id}  unchanged`)
    } else {
      errors++
      console.log(`✗ ${session_id}  ${outcome.error}`)
    }
  }

  console.log()
  console.log(`uploaded: ${uploadedIds.length}   errors: ${errors}`)

  if (flags.poll === true && uploadedIds.length > 0) await pollUntilDone(uploadedIds)
  // Best-effort: Hydra errors never fail the command. Wiki stays decoupled.
}

// ----- recall (hydra knowledge) ----------------------------------------------

async function cmdRecall(positional: string[], flags: Flags): Promise<void> {
  const query = positional.join(' ').trim()
  if (!query) {
    console.error('recall: missing query')
    process.exit(2)
  }
  const limit = flags.limit ? Number(flags.limit) : 5
  const project = typeof flags.project === 'string' ? flags.project : undefined
  const asJson = flags.json === true

  const res = (await hydra().recall.fullRecall({
    tenant_id: tenantId(),
    query,
    max_results: limit,
    graph_context: true,
    ...(project ? { metadata_filters: { project } } : {})
  })) as Record<string, unknown>

  if (asJson) {
    console.log(JSON.stringify(res, null, 2))
    return
  }

  type Chunk = {
    chunk_content?: string
    source_id?: string
    relevancy_score?: number
    source_title?: string
    tenant_metadata?: Record<string, unknown>
  }
  const chunks = (res.chunks as Chunk[] | undefined) ?? []
  console.log(`knowledge: ${query}${project ? `  (project=${project})` : ''}`)
  console.log(`${chunks.length} chunk${chunks.length === 1 ? '' : 's'}`)
  console.log()
  for (const c of chunks) {
    const meta = (c.tenant_metadata ?? {}) as Record<string, unknown>
    const sess = typeof meta.session_id === 'string' ? meta.session_id : c.source_id ?? '?'
    const proj = typeof meta.project === 'string' ? meta.project : '-'
    const score = typeof c.relevancy_score === 'number' ? c.relevancy_score.toFixed(3) : '?'
    console.log(`── [${score}]  session=${sess.slice(0, 8)}  project=${proj}`)
    if (c.source_title) console.log(`   title: ${c.source_title}`)
    const body = (c.chunk_content ?? '').trim()
    for (const line of body.split('\n').slice(0, 12)) console.log(`   ${line}`)
    if (body.split('\n').length > 12) console.log('   ...')
    console.log()
  }

  type Triplet = {
    source?: { name?: string; type?: string }
    relation?: { canonical_predicate?: string; raw_predicate?: string }
    target?: { name?: string; type?: string }
  }
  type QueryPath = { triplets?: Triplet[]; relevancy_score?: number }
  const ctx = res.graph_context as { query_paths?: QueryPath[] } | undefined
  const paths = ctx?.query_paths ?? []
  if (paths.length > 0) {
    console.log(`graph (${paths.length} path${paths.length === 1 ? '' : 's'}):`)
    for (const p of paths.slice(0, 10)) {
      const score = typeof p.relevancy_score === 'number' ? p.relevancy_score.toFixed(2) : '?'
      for (const t of p.triplets ?? []) {
        const s = `${t.source?.name ?? '?'} [${t.source?.type ?? '?'}]`
        const o = `${t.target?.name ?? '?'} [${t.target?.type ?? '?'}]`
        const r = t.relation?.canonical_predicate ?? t.relation?.raw_predicate ?? '?'
        console.log(`  [${score}] ${s}  —${r}→  ${o}`)
      }
    }
  }
}

// ----- memory-sync (hydra memories) ------------------------------------------

async function cmdMemorySync(_positional: string[], flags: Flags): Promise<void> {
  const limit = flags.limit ? Number(flags.limit) : null
  const includeProject =
    typeof flags['include-project'] === 'string' ? flags['include-project'] : undefined
  const force = flags.force === true
  const infer = flags.infer === true

  const files = discoverMemoryFiles({ includeProject })
  console.log(`discovered ${files.length} memory file${files.length === 1 ? '' : 's'} under ~/.claude/projects`)
  console.log(`sub-tenant: ${memorySubTenant()}`)

  const queue = limit ? files.slice(0, limit) : files
  let uploaded = 0
  let skipped = 0
  let errors = 0
  for (const file of queue) {
    const outcome = await uploadMemoryFile(file, { force, infer })
    const rel = file.path.replace(`${process.env.HOME ?? ''}/`, '~/')
    if (outcome.result === 'uploaded') {
      uploaded++
      console.log(`✓ ${rel}  ${outcome.status}  project=${outcome.project}`)
    } else if (outcome.result === 'skipped') {
      skipped++
    } else {
      errors++
      console.log(`✗ ${rel}  ${outcome.error}`)
    }
  }
  console.log()
  console.log(`uploaded: ${uploaded}   skipped: ${skipped}   errors: ${errors}`)
}

// ----- memory-recall (hydra memories) ----------------------------------------

async function cmdMemoryRecall(positional: string[], flags: Flags): Promise<void> {
  const query = positional.join(' ').trim()
  if (!query) {
    console.error('memory-recall: missing query')
    process.exit(2)
  }
  const limit = flags.limit ? Number(flags.limit) : 5
  const project = typeof flags.project === 'string' ? flags.project : undefined
  const asJson = flags.json === true

  const res = await recallMemories({ query, project, limit, graphContext: false })
  if (asJson) {
    console.log(JSON.stringify(res, null, 2))
    return
  }
  const chunks = res.chunks ?? []
  const sourcesById = new Map((res.sources ?? []).map((s) => [s.id ?? '', s]))
  console.log(`memories: ${query}${project ? `  (project=${project})` : ''}`)
  console.log(`sub-tenant: ${memorySubTenant()}`)
  console.log(`${chunks.length} chunk${chunks.length === 1 ? '' : 's'}`)
  console.log()
  for (const c of chunks as MemoryRecallChunk[]) {
    const source = sourcesById.get(c.source_id ?? '')
    const meta = (source?.metadata ?? {}) as Record<string, unknown>
    const doc = (source?.additional_metadata ?? {}) as Record<string, unknown>
    const proj = typeof meta.project === 'string' ? meta.project : '-'
    const file = source?.title ?? (typeof doc.filename === 'string' ? doc.filename : c.source_title ?? '?')
    const score = typeof c.relevancy_score === 'number' ? c.relevancy_score.toFixed(3) : '?'
    console.log(`── [${score}]  ${file}  project=${proj}`)
    const body = (c.chunk_content ?? '').trim()
    for (const line of body.split('\n').slice(0, 12)) console.log(`   ${line}`)
    if (body.split('\n').length > 12) console.log('   ...')
    console.log()
  }
}

// ----- status ----------------------------------------------------------------

function cmdStatus(): void {
  const countMd = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).length : 0)
  const countCollected = () => {
    if (!existsSync(COLLECTED_DIR)) return 0
    return readdirSync(COLLECTED_DIR).filter((f) => {
      try {
        return statSync(join(COLLECTED_DIR, f)).isDirectory() && existsSync(join(COLLECTED_DIR, f, 'transcript.md'))
      } catch {
        return false
      }
    }).length
  }

  console.log('pipeline:')
  console.log(`  collected:   ${countCollected()}`)
  console.log(`  distilled:   ${countMd(DISTILLED_DIR)}`)
  console.log(`  verified:    ${countMd(VERIFIED_DIR)}`)
  console.log(`  quarantine:  ${countMd(QUARANTINE_DIR)}`)

  const rows = listSources()
  const byStatus: Record<string, number> = {}
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  console.log()
  console.log(`hydra knowledge ledger: ${rows.length} sources`)
  for (const [s, n] of Object.entries(byStatus).sort()) {
    console.log(`  ${s.padEnd(14)} ${n}`)
  }

  if (existsSync(VERIFIED_DIR)) {
    const ledger = new Set(rows.map((r) => r.session_id))
    const pending: string[] = []
    for (const f of readdirSync(VERIFIED_DIR)) {
      if (!f.endsWith('.md')) continue
      const id = f.replace(/\.md$/, '')
      if (!ledger.has(id)) pending.push(id)
    }
    if (pending.length > 0) {
      console.log(`  unsynced verified files: ${pending.length}`)
      for (const p of pending.slice(0, 10)) console.log(`    ${p}`)
      if (pending.length > 10) console.log(`    ... (${pending.length - 10} more)`)
    }
  }

  const memRows = listMemories()
  const memByStatus: Record<string, number> = {}
  const memByProject: Record<string, number> = {}
  for (const m of memRows) {
    memByStatus[m.status] = (memByStatus[m.status] ?? 0) + 1
    memByProject[m.project] = (memByProject[m.project] ?? 0) + 1
  }
  console.log()
  console.log(`hydra memories ledger: ${memRows.length} memories (sub-tenant=${memorySubTenant()})`)
  for (const [s, n] of Object.entries(memByStatus).sort()) {
    console.log(`  ${s.padEnd(14)} ${n}`)
  }
  if (Object.keys(memByProject).length > 0) {
    console.log(`  by project:`)
    for (const [p, n] of Object.entries(memByProject).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${p}: ${n}`)
    }
  }
}

// ----- list ------------------------------------------------------------------

function cmdList(_positional: string[], flags: Flags): void {
  const index = buildIndex(VERIFIED_DIR)
  const type = typeof flags.type === 'string' ? flags.type : null
  const project = typeof flags.project === 'string' ? flags.project : null

  if (!type || type === 'project') {
    console.log(`projects (${index.projects.size}):`)
    for (const p of [...index.projects.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
      if (project && p.slug !== project) continue
      console.log(`  ${p.slug.padEnd(40)} work=${p.work.length} pitfalls=${p.pitfalls.length} concepts=${p.concepts.length}`)
    }
    if (type === 'project') return
    console.log()
  }

  const wanted: SlugType[] = type && SLUG_TYPES.includes(type as SlugType) ? [type as SlugType] : [...SLUG_TYPES]
  for (const t of wanted) {
    const entries = [...index.slugs.values()]
      .filter((e) => e.type === t)
      .filter((e) => {
        if (!project) return true
        for (const def of e.definitions) if (def.project === project) return true
        return false
      })
      .sort((a, b) => a.slug.localeCompare(b.slug))
    console.log(`${t}s (${entries.length}):`)
    for (const e of entries) {
      console.log(`  ${e.type.padEnd(7)} ${e.slug.padEnd(40)} ${e.sources.length} session${e.sources.length === 1 ? '' : 's'}`)
    }
    console.log()
  }
}

// ----- show ------------------------------------------------------------------

function cmdShow(positional: string[]): void {
  const target = positional[0]
  if (!target || !target.includes(':')) {
    console.error('show: expected <type>:<slug>  e.g. concept:redaction-flow')
    process.exit(2)
  }
  const [type, slug] = target.split(':', 2) as [string, string]
  const index = buildIndex(VERIFIED_DIR)
  if (type === 'project') {
    const p = index.projects.get(slug)
    if (!p) {
      console.error(`show: project not found: ${slug}`)
      process.exit(1)
    }
    console.log(renderProjectPage(p, index))
    return
  }
  if (!SLUG_TYPES.includes(type as SlugType)) {
    console.error(`show: unknown type: ${type}`)
    process.exit(2)
  }
  const entry = index.slugs.get(`${type}:${slug}`)
  if (!entry) {
    console.error(`show: slug not found: ${type}:${slug}`)
    suggestNear(index, slug)
    process.exit(1)
  }
  console.log(renderSlugPage(entry, index))
}

function suggestNear(index: WikiIndex, slug: string): void {
  const all = [...index.slugs.values()].map((e) => `${e.type}:${e.slug}`)
  const near = all.filter((k) => k.includes(slug.slice(0, Math.max(3, Math.floor(slug.length / 2)))))
  if (near.length > 0) {
    console.error('did you mean:')
    for (const k of near.slice(0, 5)) console.error(`  ${k}`)
  }
}

// ----- dispatch --------------------------------------------------------------

const argv = process.argv.slice(2)
const verb = argv[0]
const rest = argv.slice(1)
const { positional, flags } = parseFlags(rest)

if (!verb || verb === '--help' || verb === '-h' || verb === 'help') usage()

try {
  switch (verb) {
    case 'add':
      cmdAdd(positional, flags)
      break
    case 'sync':
      await cmdSync(positional, flags)
      break
    case 'status':
      cmdStatus()
      break
    case 'list':
      cmdList(positional, flags)
      break
    case 'show':
      cmdShow(positional)
      break
    case 'upload':
      await cmdUpload(positional, flags)
      break
    case 'recall':
      await cmdRecall(positional, flags)
      break
    case 'memory-sync':
      await cmdMemorySync(positional, flags)
      break
    case 'memory-recall':
      await cmdMemoryRecall(positional, flags)
      break
    default:
      console.error(`unknown verb: ${verb}`)
      usage()
  }
} catch (e: unknown) {
  const err = e as { statusCode?: number; body?: unknown; message?: string }
  if (err.statusCode || err.body) {
    const detail = err.body as { detail?: { message?: string; error_code?: string } } | undefined
    const msg = detail?.detail?.message ?? err.message ?? String(e)
    console.error(`hydra error (${err.statusCode ?? '?'}): ${msg}`)
    if (detail?.detail?.error_code === 'NOT_FOUND' && msg.includes('Tenant')) {
      console.error('hint: run `bun run ingest --init-tenant` to (re-)provision the tenant')
    }
  } else if (e instanceof Error) {
    console.error(`error: ${e.message}`)
  } else {
    console.error(`error: ${String(e)}`)
  }
  process.exit(1)
}
