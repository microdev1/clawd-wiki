// Stage 3 — Wiki MDX generation.
//
// Reads data/verified/*.md, builds a slug index (scripts/lib/slugs.ts), and
// emits one MDX page per slug into data/wiki/:
//   data/wiki/index.mdx
//   data/wiki/projects/<slug>.mdx
//   data/wiki/concepts/<slug>.mdx
//   data/wiki/pitfalls/<slug>.mdx
//   data/wiki/work-units/<slug>.mdx
//
// Cross-references are resolved to relative route paths (no .mdx extension, to
// match React Router routes like /projects/:slug). Backlinks are auto-derived.
// data/wiki/ is wiped on each run (deterministic output).

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildIndex, humanizeSlug, type Ref, type SessionContext, type SlugEntry, type SlugType, type ProjectEntry, type WikiIndex } from './lib/slugs.ts'

const VERIFIED_DIR = join(import.meta.dir, '..', 'data', 'verified')
const OUT_DIR = join(import.meta.dir, '..', 'app', 'content', 'wiki')

const TYPE_DIR: Record<SlugType | 'project', string> = {
  work: 'work-units',
  pitfall: 'pitfalls',
  concept: 'concepts',
  project: 'projects'
}

function refToPath(ref: Ref, fromType: SlugType | 'project' | 'root'): string {
  const target = `${TYPE_DIR[ref.type]}/${ref.slug}`
  if (fromType === 'root') return `./${target}`
  return `../${target}`
}

function refLink(ref: Ref, fromType: SlugType | 'project' | 'root'): string {
  return `[${humanizeSlug(ref.slug)}](${refToPath(ref, fromType)})`
}

function resolveWikilinks(text: string, fromType: SlugType | 'project' | 'root', known: WikiIndex): string {
  return text.replace(/\[\[(work|pitfall|concept|project):([a-z0-9A-Z][a-z0-9A-Z-]*)\]\]/g, (_, type, slug) => {
    const ref: Ref = { type: type as Ref['type'], slug }
    const exists =
      ref.type === 'project' ? known.projects.has(ref.slug) : known.slugs.has(`${ref.type}:${ref.slug}`)
    if (!exists) return `**${humanizeSlug(slug)}**`
    return refLink(ref, fromType)
  })
}

function frontmatter(fields: Record<string, string>): string {
  const lines = ['---']
  for (const [k, v] of Object.entries(fields)) {
    const escaped = v.includes(':') || v.includes('#') ? JSON.stringify(v) : v
    lines.push(`${k}: ${escaped}`)
  }
  lines.push('---')
  return lines.join('\n')
}

function renderSlugPage(entry: SlugEntry, index: WikiIndex): string {
  const parts: string[] = []
  parts.push(
    frontmatter({
      title: entry.title,
      slug: entry.slug,
      type: entry.type
    })
  )
  parts.push('')
  parts.push(`# ${entry.title}`)
  parts.push('')
  parts.push(`*${entry.type}*`)
  parts.push('')

  // Definition(s): one block per contributing session.
  if (entry.definitions.length === 1) {
    parts.push(resolveWikilinks(entry.definitions[0]!.body, entry.type, index))
  } else {
    parts.push('## Definitions')
    for (const def of entry.definitions) {
      const projectTag = def.project ? ` *(${humanizeSlug(def.project)})*` : ''
      parts.push('')
      parts.push(`### From session \`${def.source_session.slice(0, 8)}\`${projectTag}`)
      parts.push('')
      parts.push(resolveWikilinks(def.body, entry.type, index))
    }
  }
  parts.push('')

  // Pull Techniques and Decisions from every contributing session so an agent
  // landing on this page gets the worked patterns and tradeoffs in context,
  // not just the bullet definition.
  appendSessionContext(parts, entry.sources, entry.type, index)

  const relatedOther = entry.related.filter((r) => r.type !== 'project')
  if (relatedOther.length > 0) {
    parts.push('## Related')
    parts.push('')
    for (const ref of relatedOther) {
      const exists = index.slugs.has(`${ref.type}:${ref.slug}`)
      if (exists) parts.push(`- ${refLink(ref, entry.type)} (${ref.type})`)
      else parts.push(`- **${humanizeSlug(ref.slug)}** (${ref.type})`)
    }
    parts.push('')
  }

  if (entry.backlinks.length > 0) {
    parts.push('## Appears in')
    parts.push('')
    for (const ref of entry.backlinks) {
      parts.push(`- ${refLink(ref, entry.type)} (${ref.type})`)
    }
    parts.push('')
  }

  const projectsForSlug = new Set<string>()
  for (const def of entry.definitions) if (def.project) projectsForSlug.add(def.project)
  if (projectsForSlug.size > 0) {
    parts.push('## Projects')
    parts.push('')
    for (const p of projectsForSlug) {
      const ref: Ref = { type: 'project', slug: p }
      const exists = index.projects.has(p)
      if (exists) parts.push(`- ${refLink(ref, entry.type)}`)
      else parts.push(`- ${humanizeSlug(p)}`)
    }
    parts.push('')
  }

  parts.push('## Sources')
  parts.push('')
  for (const s of entry.sources) parts.push(`- \`${s}\``)
  parts.push('')

  return parts.join('\n')
}

function appendSessionContext(
  parts: string[],
  sessionIds: string[],
  fromType: SlugType | 'project',
  index: WikiIndex,
  options: { includeSummary?: boolean } = {}
): void {
  const contexts = sessionIds
    .map((id) => index.sessions.get(id))
    .filter((c): c is SessionContext => Boolean(c))
  if (contexts.length === 0) return

  const multi = contexts.length > 1

  if (options.includeSummary) {
    const withSummary = contexts.filter((c) => c.summary.trim().length > 0)
    if (withSummary.length > 0) {
      parts.push('## Summary')
      parts.push('')
      for (const ctx of withSummary) {
        if (multi) {
          const tag = ctx.project ? ` *(${humanizeSlug(ctx.project)})*` : ''
          parts.push(`### From session \`${ctx.source_session.slice(0, 8)}\`${tag}`)
          parts.push('')
        }
        parts.push(resolveWikilinks(ctx.summary.trim(), fromType, index))
        parts.push('')
      }
    }
  }

  const withTechniques = contexts.filter((c) => c.techniques.length > 0)
  if (withTechniques.length > 0) {
    parts.push('## Techniques')
    parts.push('')
    for (const ctx of withTechniques) {
      if (multi) {
        const tag = ctx.project ? ` *(${humanizeSlug(ctx.project)})*` : ''
        parts.push(`### From session \`${ctx.source_session.slice(0, 8)}\`${tag}`)
        parts.push('')
      }
      for (const item of ctx.techniques) {
        parts.push(resolveWikilinks(item, fromType, index))
        parts.push('')
      }
    }
  }

  const withDecisions = contexts.filter((c) => c.decisions.length > 0)
  if (withDecisions.length > 0) {
    parts.push('## Decisions and tradeoffs')
    parts.push('')
    for (const ctx of withDecisions) {
      if (multi) {
        const tag = ctx.project ? ` *(${humanizeSlug(ctx.project)})*` : ''
        parts.push(`### From session \`${ctx.source_session.slice(0, 8)}\`${tag}`)
        parts.push('')
      }
      for (const item of ctx.decisions) {
        parts.push(resolveWikilinks(item, fromType, index))
        parts.push('')
      }
    }
  }
}

function renderProjectPage(entry: ProjectEntry, index: WikiIndex): string {
  const parts: string[] = []
  parts.push(
    frontmatter({
      title: entry.title,
      slug: entry.slug,
      type: 'project'
    })
  )
  parts.push('')
  parts.push(`# ${entry.title}`)
  parts.push('')
  parts.push('*project*')
  parts.push('')

  const renderList = (heading: string, type: SlugType, slugs: string[]) => {
    if (slugs.length === 0) return
    parts.push(`## ${heading}`)
    parts.push('')
    for (const slug of slugs) {
      const exists = index.slugs.has(`${type}:${slug}`)
      if (exists) parts.push(`- ${refLink({ type, slug }, 'project')}`)
      else parts.push(`- **${humanizeSlug(slug)}**`)
    }
    parts.push('')
  }
  renderList('Work units', 'work', entry.work)
  renderList('Pitfalls', 'pitfall', entry.pitfalls)
  renderList('Concepts', 'concept', entry.concepts)

  appendSessionContext(parts, entry.sources, 'project', index, { includeSummary: true })

  parts.push('## Sources')
  parts.push('')
  for (const s of entry.sources) parts.push(`- \`${s}\``)
  parts.push('')

  return parts.join('\n')
}

function renderIndexPage(index: WikiIndex): string {
  const parts: string[] = []
  parts.push(frontmatter({ title: 'clawd-wiki', slug: 'index', type: 'index' }))
  parts.push('')
  parts.push('# clawd-wiki')
  parts.push('')
  parts.push(
    `Knowledge index distilled from past Claude Code sessions. ${index.projects.size} project(s), ${countByType(index, 'concept')} concepts, ${countByType(index, 'pitfall')} pitfalls, ${countByType(index, 'work')} work units.`
  )
  parts.push('')
  parts.push('## Projects')
  parts.push('')
  for (const p of [...index.projects.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    parts.push(`- ${refLink({ type: 'project', slug: p.slug }, 'root')}`)
  }
  parts.push('')

  const byType = (type: SlugType, heading: string) => {
    const entries = [...index.slugs.values()].filter((e) => e.type === type).sort((a, b) => a.slug.localeCompare(b.slug))
    if (entries.length === 0) return
    parts.push(`## ${heading}`)
    parts.push('')
    for (const e of entries) parts.push(`- ${refLink({ type: e.type, slug: e.slug }, 'root')}`)
    parts.push('')
  }
  byType('concept', 'Concepts')
  byType('pitfall', 'Pitfalls')
  byType('work', 'Work units')

  return parts.join('\n')
}

function countByType(index: WikiIndex, type: SlugType): number {
  let n = 0
  for (const e of index.slugs.values()) if (e.type === type) n++
  return n
}

type GraphNode = { id: string; type: SlugType | 'project'; slug: string; title: string }
type GraphEdge = { from: string; to: string; kind: 'related' | 'project' }
type Graph = { nodes: GraphNode[]; edges: GraphEdge[] }

function nodeId(type: SlugType | 'project', slug: string): string {
  return `${type}:${slug}`
}

function buildGraph(index: WikiIndex): Graph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const seenEdges = new Set<string>()

  const pushEdge = (from: string, to: string, kind: GraphEdge['kind']) => {
    const key = `${kind}\x00${from}\x00${to}`
    if (seenEdges.has(key)) return
    seenEdges.add(key)
    edges.push({ from, to, kind })
  }

  for (const e of index.slugs.values()) {
    nodes.push({ id: nodeId(e.type, e.slug), type: e.type, slug: e.slug, title: e.title })
  }
  for (const p of index.projects.values()) {
    nodes.push({ id: nodeId('project', p.slug), type: 'project', slug: p.slug, title: p.title })
  }

  // Ref edges from each slug's outbound `related`. Skip refs whose target isn't defined.
  for (const e of index.slugs.values()) {
    const from = nodeId(e.type, e.slug)
    for (const ref of e.related) {
      const exists =
        ref.type === 'project' ? index.projects.has(ref.slug) : index.slugs.has(`${ref.type}:${ref.slug}`)
      if (!exists) continue
      pushEdge(from, nodeId(ref.type, ref.slug), ref.type === 'project' ? 'project' : 'related')
    }
  }

  // Project membership: project -> slug for everything the project rolls up.
  for (const p of index.projects.values()) {
    const projId = nodeId('project', p.slug)
    const addList = (type: SlugType, slugs: string[]) => {
      for (const slug of slugs) {
        if (!index.slugs.has(`${type}:${slug}`)) continue
        pushEdge(projId, nodeId(type, slug), 'project')
      }
    }
    addList('work', p.work)
    addList('pitfall', p.pitfalls)
    addList('concept', p.concepts)
  }

  return { nodes, edges }
}

function wipeDir(dir: string): void {
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    rmSync(p, { recursive: true, force: true })
  }
}

const index = buildIndex(VERIFIED_DIR)

mkdirSync(OUT_DIR, { recursive: true })
wipeDir(OUT_DIR)
for (const sub of ['projects', 'concepts', 'pitfalls', 'work-units']) {
  mkdirSync(join(OUT_DIR, sub), { recursive: true })
}

writeFileSync(join(OUT_DIR, 'index.mdx'), renderIndexPage(index))

for (const entry of index.slugs.values()) {
  const out = join(OUT_DIR, TYPE_DIR[entry.type], `${entry.slug}.mdx`)
  writeFileSync(out, renderSlugPage(entry, index))
}

for (const project of index.projects.values()) {
  const out = join(OUT_DIR, 'projects', `${project.slug}.mdx`)
  writeFileSync(out, renderProjectPage(project, index))
}

writeFileSync(join(OUT_DIR, 'graph.json'), JSON.stringify(buildGraph(index), null, 2))

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

// Surface orphans (referenced but not defined) so they can be added to a
// future distillation pass or marked as known stubs.
const orphans = new Set<string>()
for (const e of index.slugs.values()) {
  for (const ref of e.related) {
    if (ref.type === 'project') {
      if (!index.projects.has(ref.slug)) orphans.add(`project:${ref.slug}`)
    } else if (!index.slugs.has(`${ref.type}:${ref.slug}`)) {
      orphans.add(`${ref.type}:${ref.slug}`)
    }
  }
}
if (orphans.size > 0) {
  console.log()
  console.log(`orphan refs (rendered as bold text, no page): ${orphans.size}`)
  for (const o of [...orphans].sort()) console.log(`  ${o}`)
}
