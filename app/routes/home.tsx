import { pageMeta } from '@/lib/meta'
import { siteByline, siteName } from '@/lib/site'
import { pagesByType, typeDir, type WikiType } from '@/lib/wiki'
import { Link } from 'react-router'
import type { Route } from './+types/home'

export const meta: Route.MetaFunction = ({ location }) =>
  pageMeta({ title: siteName, description: siteByline, location })

export default function Home() {
  const projects = pagesByType('project')
  const concepts = pagesByType('concept')
  const pitfalls = pagesByType('pitfall')
  const works = pagesByType('work')

  const total = projects.length + concepts.length + pitfalls.length + works.length

  return (
    <article className="article">
      <h1 className="article-title">Welcome to {siteName}</h1>
      <p className="article-subtitle">
        the distilled knowledge index, with {total} article{total === 1 ? '' : 's'} across {projects.length} project
        {projects.length === 1 ? '' : 's'}.
      </p>
      <p>{siteByline}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <Panel title="Projects" type="project" pages={projects} />
        <Panel title="Concepts" type="concept" pages={concepts} />
        <Panel title="Pitfalls" type="pitfall" pages={pitfalls} />
        <Panel title="Work units" type="work" pages={works} />
      </div>
    </article>
  )
}

function Panel({
  title,
  type,
  pages
}: {
  title: string
  type: WikiType
  pages: { slug: string; title: string }[]
}) {
  const dir = typeDir(type)
  return (
    <section className="panel">
      <h2>{title}</h2>
      {pages.length === 0 ? (
        <p className="text-[color:var(--color-muted)] italic">No entries yet.</p>
      ) : (
        <ul>
          {pages.map((p) => (
            <li key={p.slug}>
              <Link to={`/${dir}/${p.slug}`}>{p.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
