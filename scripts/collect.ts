// Walk ~/.claude/projects and dump normalized session transcripts (with secrets
// scrubbed) into data/collected/<session-id>.{json,md}.
//
// Usage:
//   bun scripts/collect.ts                       # everything
//   bun scripts/collect.ts --limit 5             # first 5 sessions
//   bun scripts/collect.ts --project boilerplate # substring match on project dir
//   bun scripts/collect.ts --min-size 5000       # skip JSONLs under N bytes

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { listProjects, listSessions, readSession, renderTranscript, sessionSizeBytes } from './lib/sessions.ts'
import { scrub } from './lib/scrub.ts'
import { loadConfig } from './lib/config.ts'

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
  const jsonOut = join(OUT_DIR, `${sessionId}.json`)
  const mdOut = join(OUT_DIR, `${sessionId}.md`)
  if (!args.force && existsSync(jsonOut) && existsSync(mdOut)) {
    skipped++
    continue
  }
  const session = readSession(job.sessionPath, job.project)
  if (session.turns.length === 0) {
    skipped++
    continue
  }
  const markdown = renderTranscript(session)
  const { text: cleanMd, report } = scrub(markdown)
  scrubHits += report.total

  writeFileSync(
    jsonOut,
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
        scrub: report
      },
      null,
      2
    )
  )
  writeFileSync(mdOut, cleanMd)
  written++
  console.log(
    `+ ${sessionId} (${session.turns.length} turns, ${Math.round(job.size / 1024)}KB, ${report.total} scrubs) ${session.title ?? ''}`
  )
}

console.log()
console.log(`projects scanned: ${projects.length}`)
console.log(`sessions considered: ${jobs.length}`)
console.log(`written: ${written}  skipped: ${skipped}  scrub hits: ${scrubHits}`)
console.log(`output: ${OUT_DIR}`)
