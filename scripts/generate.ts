// Stage 3 — Wiki MDX generation (full rebuild).
//
// Reads data/verified/*.md, builds the slug index, wipes app/content/wiki/,
// and writes every page. For incremental rebuilds (only affected pages after
// a new session is added), see `scripts/wiki.ts sync`.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildIndex } from './lib/slugs.ts'
import {
  computeOrphans,
  countByType,
  ensureOutDirs,
  projectPagePath,
  renderProjectPage,
  renderSlugPage,
  slugPagePath,
  wipeContentDir,
  writeIndexAndGraph
} from './lib/render.ts'

const VERIFIED_DIR = join(import.meta.dir, '..', 'data', 'verified')
const OUT_DIR = join(import.meta.dir, '..', 'app', 'content', 'wiki')

const index = buildIndex(VERIFIED_DIR)

ensureOutDirs(OUT_DIR)
wipeContentDir(OUT_DIR)
ensureOutDirs(OUT_DIR)

for (const entry of index.slugs.values()) {
  writeFileSync(slugPagePath(OUT_DIR, entry), renderSlugPage(entry, index))
}
for (const project of index.projects.values()) {
  writeFileSync(projectPagePath(OUT_DIR, project), renderProjectPage(project, index))
}
writeIndexAndGraph(OUT_DIR, index)

const stats = {
  projects: index.projects.size,
  concepts: countByType(index, 'concept'),
  pitfalls: countByType(index, 'pitfall'),
  work_units: countByType(index, 'work')
}
console.log(`wrote ${1 + index.slugs.size + index.projects.size} pages to ${OUT_DIR}`)
console.log(`  projects: ${stats.projects}`)
console.log(`  concepts: ${stats.concepts}`)
console.log(`  pitfalls: ${stats.pitfalls}`)
console.log(`  work units: ${stats.work_units}`)

const orphans = computeOrphans(index)
if (orphans.length > 0) {
  console.log()
  console.log(`orphan refs (rendered as bold text, no page): ${orphans.length}`)
  for (const o of orphans) console.log(`  ${o}`)
}
