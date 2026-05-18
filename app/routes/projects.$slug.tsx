import { NotFoundForType, WikiPageView } from '@/components/wiki-page'
import { pageMeta } from '@/lib/meta'
import { siteName } from '@/lib/site'
import { pageOf } from '@/lib/wiki'
import { isRouteErrorResponse } from 'react-router'
import type { Route } from './+types/projects.$slug'

export function loader({ params }: Route.LoaderArgs) {
  const slug = params.slug
  if (!pageOf('project', slug)) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw new Response('Not Found', { status: 404 })
  }
  return { slug }
}

export const meta: Route.MetaFunction = ({ loaderData, location }) => {
  if (!loaderData) return []
  const page = pageOf('project', loaderData.slug)
  return pageMeta({
    title: `${page?.title ?? loaderData.slug} — ${siteName}`,
    description: `Project: ${page?.title ?? loaderData.slug}`,
    location
  })
}

export default function ProjectRoute({ loaderData }: Route.ComponentProps) {
  return <WikiPageView type="project" slug={loaderData.slug} />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundForType type="project" />
  throw error
}
