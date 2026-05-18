// Distillation in this pipeline is performed by a *separate Claude Code session*
// (run by the human), not by an API call from here. This script is the
// orchestration helper: it prints the prompt to paste, plus current pipeline
// status so the operator knows what's pending.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const PROMPT_PATH = join(ROOT, 'prompts', 'distill.md')
const COLLECTED = join(ROOT, 'data', 'collected')
const DISTILLED = join(ROOT, 'data', 'distilled')
const VERIFIED = join(ROOT, 'data', 'verified')
const QUARANTINE = join(ROOT, 'data', 'quarantine')

function countMd(dir: string): number {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((f) => f.endsWith('.md')).length
}

function pendingDistill(): string[] {
  if (!existsSync(COLLECTED)) return []
  return readdirSync(COLLECTED)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !existsSync(join(DISTILLED, f)))
}

const args = new Set(process.argv.slice(2))

if (args.has('--status') || args.has('-s')) {
  console.log(`collected:   ${countMd(COLLECTED)}`)
  console.log(`distilled:   ${countMd(DISTILLED)}`)
  console.log(`verified:    ${countMd(VERIFIED)}`)
  console.log(`quarantine:  ${countMd(QUARANTINE)}`)
  const pending = pendingDistill()
  console.log(`pending:     ${pending.length}`)
  if (pending.length && pending.length <= 10) {
    console.log()
    for (const f of pending) console.log(`  - ${f}`)
  }
  process.exit(0)
}

if (!existsSync(PROMPT_PATH)) {
  console.error(`Missing ${PROMPT_PATH}`)
  process.exit(1)
}

console.log(readFileSync(PROMPT_PATH, 'utf8'))
console.log('---')
console.log()
console.log('# Status')
console.log(`# collected: ${countMd(COLLECTED)}   distilled: ${countMd(DISTILLED)}   pending: ${pendingDistill().length}`)
console.log('# Tip: `bun run distill --status` shows just the counts.')
