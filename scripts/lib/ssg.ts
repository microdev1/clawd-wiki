// Build-time helpers for the SSG: enumerate every wiki route so React Router's
// prerender can emit a static HTML file per slug.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const WIKI_DIR = join(import.meta.dirname, '..', '..', 'app', 'content', 'wiki')

const TYPE_DIRS: Array<{ dir: string; route: string }> = [
  { dir: 'projects', route: '/projects' },
  { dir: 'concepts', route: '/concepts' },
  { dir: 'pitfalls', route: '/pitfalls' },
  { dir: 'work-units', route: '/work-units' }
]

export const staticRoutes = ['/'] as const

export function listWikiRoutes(): string[] {
  if (!existsSync(WIKI_DIR)) return []
  const routes: string[] = []
  for (const { dir, route } of TYPE_DIRS) {
    const full = join(WIKI_DIR, dir)
    if (!existsSync(full)) continue
    for (const f of readdirSync(full)) {
      if (!f.endsWith('.mdx')) continue
      const slug = f.replace(/\.mdx$/, '')
      routes.push(`${route}/${slug}`)
    }
  }
  return routes
}
