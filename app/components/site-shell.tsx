import { GraphPanel } from '@/components/graph-panel'
import { getNode, nodeIdOf } from '@/lib/graph'
import { siteByline, siteName } from '@/lib/site'
import { pagesByType, typeDir, type WikiType } from '@/lib/wiki'
import { Link, useLocation } from 'react-router'

const SIDEBAR_SECTIONS: { title: string; type: WikiType }[] = [
  { title: 'Projects', type: 'project' },
  { title: 'Concepts', type: 'concept' },
  { title: 'Pitfalls', type: 'pitfall' },
  { title: 'Work units', type: 'work' }
]

const ROUTE_TYPES: { prefix: string; type: WikiType }[] = [
  { prefix: '/projects/', type: 'project' },
  { prefix: '/concepts/', type: 'concept' },
  { prefix: '/pitfalls/', type: 'pitfall' },
  { prefix: '/work-units/', type: 'work' }
]

function activeWikiNode(pathname: string): { type: WikiType; slug: string } | null {
  for (const { prefix, type } of ROUTE_TYPES) {
    if (!pathname.startsWith(prefix)) continue
    const slug = pathname.slice(prefix.length).replace(/\/$/, '')
    if (!slug) return null
    if (!getNode(nodeIdOf(type, slug))) return null
    return { type, slug }
  }
  return null
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const active = activeWikiNode(pathname)
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          {siteName}
          <span className="tagline">{siteByline}</span>
        </Link>
        <nav>
          <Link to="/">Main page</Link>
        </nav>
      </header>
      <div className={`shell${active ? ' shell-with-graph' : ''}`}>
        <aside className="sidebar" aria-label="Site navigation">
          <h4>Navigation</h4>
          <ul>
            <li>
              <Link to="/">Main page</Link>
            </li>
          </ul>
          {SIDEBAR_SECTIONS.map((section) => {
            const items = pagesByType(section.type)
            if (items.length === 0) return null
            const dir = typeDir(section.type)
            return (
              <div key={section.type}>
                <h4>{section.title}</h4>
                <ul>
                  {items.map((p) => (
                    <li key={p.slug}>
                      <Link to={`/${dir}/${p.slug}`}>{p.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </aside>
        <main className="main-pane">{children}</main>
        {active && <GraphPanel type={active.type} slug={active.slug} />}
      </div>
    </>
  )
}
