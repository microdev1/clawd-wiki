import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('projects/:slug', 'routes/projects.$slug.tsx'),
  route('concepts/:slug', 'routes/concepts.$slug.tsx'),
  route('pitfalls/:slug', 'routes/pitfalls.$slug.tsx'),
  route('work-units/:slug', 'routes/work-units.$slug.tsx'),
  route('404', 'routes/not-found.tsx')
] satisfies RouteConfig
