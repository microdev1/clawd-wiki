// Slug-graph lint for distilled wiki notes. Three invariants:
//   1. Every body [[type:slug]] (work/pitfall/concept) has its slug declared
//      in the matching frontmatter list.
//   2. Every frontmatter slug is referenced at least once in the body.
//   3. A given slug does not appear with two different type prefixes in the
//      same file.
//
// project: references are free-form and skipped — project names live outside
// the per-file slug index.

export type SlugViolation =
  | { kind: 'body-slug-not-declared'; type: 'work' | 'pitfall' | 'concept'; slug: string }
  | { kind: 'declared-slug-not-referenced'; type: 'work' | 'pitfall' | 'concept'; slug: string }
  | { kind: 'slug-type-conflict'; slug: string; types: string[] }

export type SlugReport = {
  ok: boolean
  violations: SlugViolation[]
}

const SLUG_TYPES = ['work', 'pitfall', 'concept'] as const
type SlugType = (typeof SLUG_TYPES)[number]

const FRONTMATTER_KEY: Record<SlugType, string> = {
  work: 'work_units',
  pitfall: 'pitfalls',
  concept: 'concepts'
}

import { parse as yamlParse } from 'yaml'

function extractFrontmatterList(frontmatter: string, key: string): string[] {
  let doc: unknown
  try {
    doc = yamlParse(frontmatter)
  } catch {
    return []
  }
  if (!doc || typeof doc !== 'object') return []
  const v = (doc as Record<string, unknown>)[key]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
}

export function lintSlugs(input: string): SlugReport {
  const fmMatch = input.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) {
    return { ok: false, violations: [{ kind: 'body-slug-not-declared', type: 'work', slug: '<missing-frontmatter>' }] }
  }
  const frontmatter = fmMatch[1]!
  const body = input.slice(fmMatch[0].length)

  const declared: Record<SlugType, Set<string>> = {
    work: new Set(extractFrontmatterList(frontmatter, FRONTMATTER_KEY.work)),
    pitfall: new Set(extractFrontmatterList(frontmatter, FRONTMATTER_KEY.pitfall)),
    concept: new Set(extractFrontmatterList(frontmatter, FRONTMATTER_KEY.concept))
  }

  const referenced: Record<SlugType, Set<string>> = {
    work: new Set(),
    pitfall: new Set(),
    concept: new Set()
  }
  const seenBySlug: Record<string, Set<SlugType>> = {}

  for (const m of body.matchAll(/\[\[(work|pitfall|concept):([a-z0-9][a-z0-9-]*)\]\]/g)) {
    const type = m[1] as SlugType
    const slug = m[2]!
    referenced[type].add(slug)
    if (!seenBySlug[slug]) seenBySlug[slug] = new Set()
    seenBySlug[slug].add(type)
  }

  const violations: SlugViolation[] = []

  for (const type of SLUG_TYPES) {
    for (const slug of referenced[type]) {
      if (!declared[type].has(slug)) {
        violations.push({ kind: 'body-slug-not-declared', type, slug })
      }
    }
    for (const slug of declared[type]) {
      if (!referenced[type].has(slug)) {
        violations.push({ kind: 'declared-slug-not-referenced', type, slug })
      }
    }
  }

  for (const [slug, types] of Object.entries(seenBySlug)) {
    if (types.size > 1) {
      violations.push({ kind: 'slug-type-conflict', slug, types: [...types].sort() })
    }
  }

  return { ok: violations.length === 0, violations }
}
