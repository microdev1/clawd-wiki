// Auto-fix frontmatter so the slug-graph lint only has to flag genuinely
// ambiguous cases (slug-type-conflict). Two normalizations:
//
//   1. Add to frontmatter any work/pitfall/concept slug the body references
//      but the frontmatter omits.
//   2. Drop from frontmatter any slug it declares but the body never uses.
//
// Body content (Summary, definition bullets, Techniques, Decisions) is left
// untouched. Only the frontmatter block is rewritten — back to flow style
// (`key: [a, b, c]`) for deterministic output.

import { parse as yamlParse } from 'yaml'

const SLUG_TYPES = ['work', 'pitfall', 'concept'] as const
type SlugType = (typeof SLUG_TYPES)[number]

const FRONTMATTER_KEY: Record<SlugType, string> = {
  work: 'work_units',
  pitfall: 'pitfalls',
  concept: 'concepts'
}

export type NormalizeResult = {
  text: string
  changes: string[]
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
}

function stringifyFrontmatter(fm: Record<string, unknown>, keyOrder: string[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  const emit = (k: string) => {
    if (seen.has(k)) return
    seen.add(k)
    if (!(k in fm)) return
    const v = fm[k]
    if (v === null || v === undefined) {
      lines.push(`${k}: null`)
    } else if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((s) => String(s)).join(', ')}]`)
    } else if (typeof v === 'string') {
      const needsQuote = /[:#\n]/.test(v) || /^[\s'"-]/.test(v)
      lines.push(`${k}: ${needsQuote ? JSON.stringify(v) : v}`)
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  for (const k of keyOrder) emit(k)
  for (const k of Object.keys(fm)) emit(k)
  return lines.join('\n')
}

const PREFERRED_KEY_ORDER = [
  'title',
  'source_session',
  'project',
  'projects_referenced',
  'work_units',
  'pitfalls',
  'concepts'
]

export function normalize(input: string): NormalizeResult {
  const m = input.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { text: input, changes: [] }

  let fm: Record<string, unknown>
  try {
    const parsed = yamlParse(m[1]!) as unknown
    fm = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return { text: input, changes: [] }
  }

  const body = m[2] ?? ''
  const changes: string[] = []

  // Collect body slug references by type.
  const bodySlugs: Record<SlugType, Set<string>> = { work: new Set(), pitfall: new Set(), concept: new Set() }
  for (const ref of body.matchAll(/\[\[(work|pitfall|concept):([a-z0-9][a-z0-9-]*)\]\]/g)) {
    bodySlugs[ref[1] as SlugType].add(ref[2]!)
  }

  for (const type of SLUG_TYPES) {
    const key = FRONTMATTER_KEY[type]
    const declared = new Set(asStringArray(fm[key]))
    const referenced = bodySlugs[type]

    for (const slug of referenced) {
      if (!declared.has(slug)) {
        declared.add(slug)
        changes.push(`+ ${key}: ${slug} (cited in body, added to frontmatter)`)
      }
    }
    for (const slug of [...declared]) {
      if (!referenced.has(slug)) {
        declared.delete(slug)
        changes.push(`- ${key}: ${slug} (declared but unused, removed)`)
      }
    }
    fm[key] = [...declared]
  }

  // projects_referenced — preserve if present, normalize to flow array.
  if ('projects_referenced' in fm) fm['projects_referenced'] = asStringArray(fm['projects_referenced'])

  const newFm = stringifyFrontmatter(fm, PREFERRED_KEY_ORDER)
  const sep = body.startsWith('\n') ? '' : '\n'
  return { text: `---\n${newFm}\n---${sep}${body}`, changes }
}
