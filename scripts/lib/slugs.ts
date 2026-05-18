// Parse all data/verified/*.md into a slug index keyed by (type, slug).
// For each slug we collect: the bulleted definition(s), references to other
// slugs found in the body, and the contributing source_session ids.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type SlugType = 'work' | 'pitfall' | 'concept'
export const SLUG_TYPES: readonly SlugType[] = ['work', 'pitfall', 'concept'] as const

export type Ref = { type: SlugType | 'project'; slug: string }

export type Definition = {
  source_session: string
  project: string | null
  body: string
}

export type SlugEntry = {
  type: SlugType
  slug: string
  title: string
  definitions: Definition[]
  related: Ref[]
  sources: string[]
  backlinks: Ref[]
}

export type ProjectEntry = {
  slug: string
  title: string
  work: string[]
  pitfalls: string[]
  concepts: string[]
  sources: string[]
}

export type SessionContext = {
  source_session: string
  project: string | null
  summary: string
  techniques: string[]
  decisions: string[]
}

export type WikiIndex = {
  slugs: Map<string, SlugEntry>
  projects: Map<string, ProjectEntry>
  sessions: Map<string, SessionContext>
}

function slugKey(type: SlugType, slug: string): string {
  return `${type}:${slug}`
}

export function humanizeSlug(slug: string): string {
  const upper = new Set(['dag', 'svg', 'api', 'sdk', 'ssr', 'csr', 'cli', 'mdx', 'ai', 'ui', 'orm', 'pii'])
  return slug
    .split('-')
    .map((w) => (upper.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
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

function parseList(value: string | undefined): string[] {
  if (!value) return []
  const m = value.match(/^\[(.*)\]$/)
  if (!m) return []
  return m[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function extractSection(body: string, heading: string): string {
  const re = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i')
  const m = body.match(re)
  return m ? m[1]!.trim() : ''
}

function extractRefs(text: string, excludeProjectRefs = false): Ref[] {
  const refs: Ref[] = []
  const seen = new Set<string>()
  const pattern = excludeProjectRefs
    ? /\[\[(work|pitfall|concept):([a-z0-9][a-z0-9-]*)\]\]/g
    : /\[\[(work|pitfall|concept|project):([a-z0-9A-Z][a-z0-9A-Z-]*)\]\]/g
  for (const m of text.matchAll(pattern)) {
    const type = m[1] as SlugType | 'project'
    const slug = m[2]!
    const key = `${type}:${slug}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ type, slug })
  }
  return refs
}

type Bullet = { type: SlugType; slug: string; body: string }

function parseBulletedDefs(section: string, type: SlugType): Bullet[] {
  const bullets: Bullet[] = []
  // Match either: `- **[[type:slug]]** — body` or the same with HTML-em dash.
  const pattern = new RegExp(
    `^- \\*\\*\\[\\[${type}:([a-z0-9][a-z0-9-]*)\\]\\]\\*\\*\\s*[—–-]\\s*([\\s\\S]*?)(?=\\n- \\*\\*\\[\\[${type}:|\\n*$)`,
    'gm'
  )
  for (const m of section.matchAll(pattern)) {
    bullets.push({ type, slug: m[1]!, body: m[2]!.trim() })
  }
  return bullets
}

const SECTION_BY_TYPE: Record<SlugType, string> = {
  work: 'Work units',
  pitfall: 'Pitfalls',
  concept: 'Concepts'
}

// Split a prose section into top-level items while honoring fenced code blocks
// (lines starting with ``` toggle a "don't split" guard). The itemPattern must
// match the leading token of a top-level item (e.g. `^\d+\.\s` for numbered
// Techniques or `^-\s` for Decision bullets).
function splitItems(section: string, itemPattern: RegExp): string[] {
  if (!section.trim()) return []
  const items: string[] = []
  let current: string[] = []
  let inCodeBlock = false
  for (const line of section.split('\n')) {
    if (line.startsWith('```')) inCodeBlock = !inCodeBlock
    if (!inCodeBlock && itemPattern.test(line)) {
      if (current.length > 0) {
        const text = current.join('\n').trim()
        if (text) items.push(text)
      }
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) {
    const text = current.join('\n').trim()
    if (text) items.push(text)
  }
  return items
}

export function buildIndex(verifiedDir: string): WikiIndex {
  const slugs = new Map<string, SlugEntry>()
  const projects = new Map<string, ProjectEntry>()
  const sessions = new Map<string, SessionContext>()

  const files = readdirSync(verifiedDir).filter((f) => f.endsWith('.md'))

  for (const file of files) {
    const src = readFileSync(join(verifiedDir, file), 'utf8')
    const { fm, body } = parseFrontmatter(src)
    const session_id = fm.source_session ?? file.replace(/\.md$/, '')
    const project = fm.project && fm.project !== 'null' ? fm.project : null
    const projectsReferenced = parseList(fm.projects_referenced)
    const allProjects = new Set<string>()
    if (project) allProjects.add(project)
    for (const p of projectsReferenced) allProjects.add(p)

    sessions.set(session_id, {
      source_session: session_id,
      project,
      summary: extractSection(body, 'Summary'),
      techniques: splitItems(extractSection(body, 'Techniques'), /^\d+\.\s/),
      decisions: splitItems(extractSection(body, 'Decisions and tradeoffs'), /^-\s/)
    })

    for (const type of SLUG_TYPES) {
      const section = extractSection(body, SECTION_BY_TYPE[type])
      if (!section) continue
      for (const bullet of parseBulletedDefs(section, type)) {
        const key = slugKey(type, bullet.slug)
        let entry = slugs.get(key)
        if (!entry) {
          entry = {
            type,
            slug: bullet.slug,
            title: humanizeSlug(bullet.slug),
            definitions: [],
            related: [],
            sources: [],
            backlinks: []
          }
          slugs.set(key, entry)
        }
        entry.definitions.push({ source_session: session_id, project, body: bullet.body })
        if (!entry.sources.includes(session_id)) entry.sources.push(session_id)
        for (const ref of extractRefs(bullet.body)) {
          if (ref.type === type && ref.slug === bullet.slug) continue
          if (!entry.related.find((r) => r.type === ref.type && r.slug === ref.slug)) {
            entry.related.push(ref)
          }
        }
      }
    }

    // Project rollups: from frontmatter slug lists.
    for (const pSlug of allProjects) {
      let p = projects.get(pSlug)
      if (!p) {
        p = {
          slug: pSlug,
          title: humanizeSlug(pSlug),
          work: [],
          pitfalls: [],
          concepts: [],
          sources: []
        }
        projects.set(pSlug, p)
      }
      const add = (target: string[], items: string[]) => {
        for (const s of items) if (!target.includes(s)) target.push(s)
      }
      add(p.work, parseList(fm.work_units))
      add(p.pitfalls, parseList(fm.pitfalls))
      add(p.concepts, parseList(fm.concepts))
      if (!p.sources.includes(session_id)) p.sources.push(session_id)
    }
  }

  // Backlinks: every slug A whose body references B gets recorded in B.backlinks.
  for (const entry of slugs.values()) {
    for (const ref of entry.related) {
      if (ref.type === 'project') continue
      const target = slugs.get(slugKey(ref.type, ref.slug))
      if (!target) continue
      if (!target.backlinks.find((b) => b.type === entry.type && b.slug === entry.slug)) {
        target.backlinks.push({ type: entry.type, slug: entry.slug })
      }
    }
  }

  return { slugs, projects, sessions }
}
