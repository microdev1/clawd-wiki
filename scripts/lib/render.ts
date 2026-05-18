// MDX rendering for the wiki slug graph. Pure functions over a WikiIndex
// built by scripts/lib/slugs.ts. Consumers:
//   - scripts/generate.ts wipes and rewrites the whole content tree
//   - scripts/wiki.ts sync rewrites only the affected slug/project pages
//
// Output layout (relative to OUT_DIR — caller decides where):
//   index.mdx
//   projects/<slug>.mdx
//   concepts/<slug>.mdx
//   pitfalls/<slug>.mdx
//   work-units/<slug>.mdx
//   graph.json

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  humanizeSlug,
  type Ref,
  type SessionContext,
  type SlugEntry,
  type SlugType,
  type ProjectEntry,
  type WikiIndex
} from './slugs.ts'

export const TYPE_DIR: Record<SlugType | 'project', string> = {
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

export function renderSlugPage(entry: SlugEntry, index: WikiIndex): string {
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

export function renderProjectPage(entry: ProjectEntry, index: WikiIndex): string {
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

export function renderIndexPage(index: WikiIndex): string {
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

export function countByType(index: WikiIndex, type: SlugType): number {
  let n = 0
  for (const e of index.slugs.values()) if (e.type === type) n++
  return n
}

type GraphNode = { id: string; type: SlugType | 'project'; slug: string; title: string }
type GraphEdge = { from: string; to: string; kind: 'related' | 'project' }
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] }

function nodeId(type: SlugType | 'project', slug: string): string {
  return `${type}:${slug}`
}

export function buildGraph(index: WikiIndex): Graph {
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

  for (const e of index.slugs.values()) {
    const from = nodeId(e.type, e.slug)
    for (const ref of e.related) {
      const exists =
        ref.type === 'project' ? index.projects.has(ref.slug) : index.slugs.has(`${ref.type}:${ref.slug}`)
      if (!exists) continue
      pushEdge(from, nodeId(ref.type, ref.slug), ref.type === 'project' ? 'project' : 'related')
    }
  }

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

export function ensureOutDirs(outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  for (const sub of ['projects', 'concepts', 'pitfalls', 'work-units']) {
    mkdirSync(join(outDir, sub), { recursive: true })
  }
}

export function wipeContentDir(outDir: string): void {
  if (!existsSync(outDir)) return
  for (const f of readdirSync(outDir, { withFileTypes: true })) {
    rmSync(join(outDir, f.name), { recursive: true, force: true })
  }
}

// Path of the on-disk MDX file for a given slug entry / project entry, given OUT_DIR.
export function slugPagePath(outDir: string, entry: SlugEntry): string {
  return join(outDir, TYPE_DIR[entry.type], `${entry.slug}.mdx`)
}

export function projectPagePath(outDir: string, entry: ProjectEntry): string {
  return join(outDir, TYPE_DIR['project'], `${entry.slug}.mdx`)
}

// Write index.mdx + graph.json. Always cheap; safe to call on every sync.
export function writeIndexAndGraph(outDir: string, index: WikiIndex): void {
  writeFileSync(join(outDir, 'index.mdx'), renderIndexPage(index))
  writeFileSync(join(outDir, 'graph.json'), JSON.stringify(buildGraph(index), null, 2))
}

// Compute orphan refs for reporting: referenced from another slug body but
// not defined anywhere.
export function computeOrphans(index: WikiIndex): string[] {
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
  return [...orphans].sort()
}
