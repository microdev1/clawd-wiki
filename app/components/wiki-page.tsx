import { pageOf, type WikiType } from '@/lib/wiki'
import { siteName } from '@/lib/site'
import { Link } from 'react-router'

const TYPE_LABEL: Record<WikiType, string> = {
  project: 'Project',
  concept: 'Concept',
  pitfall: 'Pitfall',
  work: 'Work unit'
}

export function WikiPageView({ type, slug }: { type: WikiType; slug: string }) {
  const page = pageOf(type, slug)
  if (!page) return null
  const Mdx = page.mod.default
  return (
    <article className="article">
      <h1 className="article-title">{page.title}</h1>
      <p className="article-subtitle">From {siteName}, the distilled knowledge index</p>
      <div className="article-body">
        <Mdx />
      </div>
      <div className="category-bar">
        <strong>Category:</strong>
        <Link to="/">{TYPE_LABEL[type]}s</Link>
      </div>
    </article>
  )
}

export function NotFoundForType({ type }: { type: WikiType }) {
  return (
    <article className="article">
      <h1 className="article-title">Page not found</h1>
      <p className="article-subtitle">From {siteName}</p>
      <p>
        No {type} found at this slug. <Link to="/">Return to the main page</Link>.
      </p>
    </article>
  )
}
