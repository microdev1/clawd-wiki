// Walk ~/.claude/projects and dump normalized session transcripts (secrets
// scrubbed) into a two-layer structure under data/collected/<session-id>/:
//
//   data/collected/<id>.json           per-session metadata (sidecar)
//   data/collected/<id>/transcript.md  conversation skeleton with @tool refs
//   data/collected/<id>/tools/*.md     one file per tool call, FULL untruncated
//                                      input + result, individually scrubbed
//
// Distillation reads `<id>/transcript.md` end-to-end then surgically Reads
// only the tool files it needs. No fixed truncation anywhere in the pipeline.
//
// Usage:
//   bun scripts/collect.ts                       # everything
//   bun scripts/collect.ts --limit 5             # first 5 sessions
//   bun scripts/collect.ts --project boilerplate # substring match
//   bun scripts/collect.ts --min-size 5000       # skip JSONLs under N bytes
//   bun scripts/collect.ts --force               # re-collect even if present

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './lib/config.ts'
import { scrub } from './lib/scrub.ts'
import { listProjects, listSessions, readSession, sessionSizeBytes, splitSession } from './lib/sessions.ts'

type Args = { limit?: number; project?: string; minSize: number; force: boolean }

function parseArgs(argv: string[]): Args {
  const out: Args = { minSize: 2000, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--limit') out.limit = Number(argv[++i])
    else if (a === '--project') out.project = argv[++i]
    else if (a === '--min-size') out.minSize = Number(argv[++i])
    else if (a === '--force') out.force = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

const OUT_DIR = join(import.meta.dir, '..', 'data', 'collected')
mkdirSync(OUT_DIR, { recursive: true })

const excludeSet = new Set(loadConfig().excludeProjects)
const projects = listProjects()
  .filter((p) => !excludeSet.has(p))
  .filter((p) => !args.project || p.toLowerCase().includes(args.project.toLowerCase()))

type Job = { project: string; sessionPath: string; size: number }
const jobs: Job[] = []
for (const project of projects) {
  for (const sessionPath of listSessions(project)) {
    const size = sessionSizeBytes(sessionPath)
    if (size < args.minSize) continue
    jobs.push({ project, sessionPath, size })
  }
}

// Largest first — bigger sessions usually carry more knowledge.
jobs.sort((a, b) => b.size - a.size)

const target = args.limit ? jobs.slice(0, args.limit) : jobs

let written = 0
let skipped = 0
let scrubHits = 0

for (const job of target) {
  const sessionId = job.sessionPath.split('/').pop()!.replace(/\.jsonl$/, '')
  const sessionDir = join(OUT_DIR, sessionId)
  const transcriptPath = join(sessionDir, 'transcript.md')
  const metaPath = join(OUT_DIR, `${sessionId}.json`)

  if (!args.force && existsSync(transcriptPath) && existsSync(metaPath)) {
    skipped++
    continue
  }

  const session = readSession(job.sessionPath, job.project)
  if (session.turns.length === 0) {
    skipped++
    continue
  }

  const { skeleton, toolFiles } = splitSession(session)

  // Wipe the session dir so prior collections don't leave stale tool files.
  rmSync(sessionDir, { recursive: true, force: true })
  mkdirSync(join(sessionDir, 'tools'), { recursive: true })

  const { text: cleanSkeleton, report: skeletonReport } = scrub(skeleton)
  writeFileSync(transcriptPath, cleanSkeleton)

  // Each tool file is scrubbed independently; aggregate scrub stats.
  const aggregate: Record<string, number> = { ...skeletonReport.hits }
  let aggregateTotal = skeletonReport.total
  for (const tf of toolFiles) {
    const { text, report } = scrub(tf.content)
    writeFileSync(join(sessionDir, 'tools', tf.filename), text)
    for (const [rule, count] of Object.entries(report.hits)) {
      aggregate[rule] = (aggregate[rule] ?? 0) + count
    }
    aggregateTotal += report.total
  }
  scrubHits += aggregateTotal

  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        sessionId: session.sessionId,
        title: session.title,
        projectDir: session.projectDir,
        cwd: session.cwd,
        branch: session.branch,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        model: session.model,
        turnCount: session.turns.length,
        toolCallCount: toolFiles.length,
        scrub: { hits: aggregate, total: aggregateTotal }
      },
      null,
      2
    )
  )
  written++
  console.log(
    `+ ${sessionId} (${session.turns.length} turns, ${toolFiles.length} tools, ${Math.round(job.size / 1024)}KB, ${aggregateTotal} scrubs) ${session.title ?? ''}`
  )
}

console.log()
console.log(`projects scanned: ${projects.length}`)
console.log(`sessions considered: ${jobs.length}`)
console.log(`written: ${written}  skipped: ${skipped}  scrub hits: ${scrubHits}`)
console.log(`output: ${OUT_DIR}`)
