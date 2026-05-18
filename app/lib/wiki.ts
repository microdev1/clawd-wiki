// Wiki content loader. Reads every generated MDX under app/content/wiki/ via
// import.meta.glob and indexes by type + slug.
//
// Glob matches the directory layout emitted by scripts/generate.ts:
//   content/wiki/index.mdx
//   content/wiki/projects/<slug>.mdx
//   content/wiki/concepts/<slug>.mdx
//   content/wiki/pitfalls/<slug>.mdx
//   content/wiki/work-units/<slug>.mdx

import type { ComponentType } from 'react'

export type WikiType = 'project' | 'work' | 'pitfall' | 'concept'

export type WikiFrontmatter = {
  title: string
  slug: string
  type: WikiType | 'index'
}

export type WikiModule = {
  default: ComponentType
  frontmatter?: WikiFrontmatter
}

export type WikiPage = {
  slug: string
  type: WikiType
  title: string
  mod: WikiModule
}

const DIR_TO_TYPE: Record<string, WikiType> = {
  projects: 'project',
  concepts: 'concept',
  pitfalls: 'pitfall',
  'work-units': 'work'
}

const TYPE_TO_DIR: Record<WikiType, string> = {
  project: 'projects',
  concept: 'concepts',
  pitfall: 'pitfalls',
  work: 'work-units'
}

const typed = import.meta.glob<WikiModule>('../content/wiki/{projects,concepts,pitfalls,work-units}/*.mdx', {
  eager: true
})

const indexModules = import.meta.glob<WikiModule>('../content/wiki/index.mdx', { eager: true })

function parsePath(path: string): { dir: string; slug: string } | null {
  const m = path.match(/\/content\/wiki\/([^/]+)\/([^/]+)\.mdx$/)
  if (!m) return null
  return { dir: m[1]!, slug: m[2]! }
}

export const pages: WikiPage[] = Object.entries(typed)
  .map(([path, mod]): WikiPage | null => {
    const parsed = parsePath(path)
    if (!parsed) return null
    const type = DIR_TO_TYPE[parsed.dir]
    if (!type) return null
    const title = mod.frontmatter?.title ?? parsed.slug
    return { slug: parsed.slug, type, title, mod }
  })
  .filter((p): p is WikiPage => p !== null)
  .sort((a, b) => a.title.localeCompare(b.title))

const byKey = new Map<string, WikiPage>(pages.map((p) => [`${p.type}:${p.slug}`, p]))

export function pageOf(type: WikiType, slug: string): WikiPage | undefined {
  return byKey.get(`${type}:${slug}`)
}

export function pagesByType(type: WikiType): WikiPage[] {
  return pages.filter((p) => p.type === type)
}

export function typeDir(type: WikiType): string {
  return TYPE_TO_DIR[type]
}

export const indexPage: WikiModule | undefined = Object.values(indexModules)[0]
