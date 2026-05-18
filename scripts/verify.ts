// Post-distill, pre-ingest gate.
//
//   1. Frontmatter normalize (scripts/lib/normalize.ts): add body-cited slugs
//      to frontmatter, drop frontmatter slugs the body never uses. Only
//      genuinely ambiguous things (e.g. slug-type-conflict) should reach lint.
//   2. PII / credentials / denylist scan (scripts/lib/scrub.ts).
//   3. Slug-graph lint (scripts/lib/lint.ts).
//
// Files that pass scrub + lint land in data/verified/ as the NORMALIZED text.
// Files that fail either are quarantined with a sibling .report.json showing
// scrub hits, lint violations, and the normalization changes that were made.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { lintSlugs } from './lib/lint.ts'
import { normalize } from './lib/normalize.ts'
import { scan } from './lib/scrub.ts'

const IN_DIR = join(import.meta.dir, '..', 'data', 'distilled')
const OK_DIR = join(import.meta.dir, '..', 'data', 'verified')
const BAD_DIR = join(import.meta.dir, '..', 'data', 'quarantine')

mkdirSync(OK_DIR, { recursive: true })
mkdirSync(BAD_DIR, { recursive: true })

// Wipe both partition dirs so verify is idempotent on each run.
for (const dir of [OK_DIR, BAD_DIR]) {
  for (const f of readdirSync(dir)) rmSync(join(dir, f))
}

const files = readdirSync(IN_DIR).filter((f) => f.endsWith('.md'))

let passed = 0
let quarantined = 0
let empty = 0
let normalizedFiles = 0
let totalNormalizeChanges = 0
const scrubSummary: Record<string, number> = {}
const lintSummary: Record<string, number> = {}

for (const file of files) {
  const src = readFileSync(join(IN_DIR, file), 'utf8')

  if (src.trim().startsWith('<!--') && src.includes('SKIP:')) {
    empty++
    continue
  }

  const { text: normalized, changes } = normalize(src)
  if (changes.length > 0) {
    normalizedFiles++
    totalNormalizeChanges += changes.length
  }

  const scrubReport = scan(normalized)
  const lintReport = lintSlugs(normalized)
  const fail = scrubReport.total > 0 || !lintReport.ok

  if (!fail) {
    writeFileSync(join(OK_DIR, file), normalized)
    passed++
    if (changes.length > 0) {
      console.log(`✓ ${file}  (${changes.length} frontmatter fix${changes.length === 1 ? '' : 'es'})`)
    }
    continue
  }

  writeFileSync(join(BAD_DIR, file), normalized)
  writeFileSync(
    join(BAD_DIR, file.replace(/\.md$/, '.report.json')),
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
  quarantined++

  const labels: string[] = []
  if (scrubReport.total > 0) {
    labels.push(`pii(${Object.keys(scrubReport.hits).join(',')})`)
    for (const [rule, count] of Object.entries(scrubReport.hits)) {
      scrubSummary[rule] = (scrubSummary[rule] ?? 0) + count
    }
  }
  if (!lintReport.ok) {
    const kinds = new Set(lintReport.violations.map((v) => v.kind))
    labels.push(`lint(${[...kinds].join(',')})`)
    for (const v of lintReport.violations) {
      lintSummary[v.kind] = (lintSummary[v.kind] ?? 0) + 1
    }
  }
  console.log(`! ${file}  ${labels.join('  ')}`)
}

console.log()
console.log(`verified:    ${passed}   →  ${OK_DIR}`)
console.log(`quarantined: ${quarantined}   →  ${BAD_DIR}`)
console.log(`empty/skip:  ${empty}`)
if (normalizedFiles > 0) {
  console.log(`normalized:  ${normalizedFiles} file${normalizedFiles === 1 ? '' : 's'} with ${totalNormalizeChanges} frontmatter fix${totalNormalizeChanges === 1 ? '' : 'es'}`)
}

if (quarantined > 0) {
  if (Object.keys(scrubSummary).length > 0) {
    console.log()
    console.log('PII / scrub hits by rule:')
    for (const [rule, count] of Object.entries(scrubSummary).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${rule.padEnd(28)} ${count}`)
    }
  }
  if (Object.keys(lintSummary).length > 0) {
    console.log()
    console.log('Slug-graph lint violations:')
    for (const [kind, count] of Object.entries(lintSummary).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${kind.padEnd(34)} ${count}`)
    }
  }
  console.log()
  console.log('Inspect each .report.json in data/quarantine/ for details.')
  console.log('  - scrub hits: add offending term to config/redact.json:denylist or re-distill')
  console.log('  - slug-type-conflict: pick one type; re-distill or hand-edit')
  process.exitCode = 1
}
