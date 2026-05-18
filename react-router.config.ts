import type { Config } from '@react-router/dev/config'
import { listWikiRoutes, staticRoutes } from './scripts/lib/ssg'

export default {
  ssr: false,
  basename: '/clawd-wiki',
  prerender() {
    return [...staticRoutes, '/404', ...listWikiRoutes()]
  }
} satisfies Config
