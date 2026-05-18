import { siteName } from '@/lib/site'
import { Link } from 'react-router'
import type { Route } from './+types/not-found'

export const meta: Route.MetaFunction = () => [
  { title: 'Not Found' },
  { name: 'robots', content: 'noindex' }
]

export default function NotFoundRoute() {
  return (
    <article className="article">
      <h1 className="article-title">Page not found</h1>
      <p className="article-subtitle">From {siteName}</p>
      <p>
        The requested page could not be found. <Link to="/">Return to the main page</Link>.
      </p>
    </article>
  )
}
