import { siteName, siteUrl } from '@/lib/site'
import type { Location } from 'react-router'

type Input = {
  title: string
  description: string
  location: Location
}

export function pageMeta({ title, description, location }: Input) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const url = `${siteUrl}${base}${location.pathname}`
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'article' },
    { property: 'og:url', content: url },
    { property: 'og:site_name', content: siteName },
    { tagName: 'link' as const, rel: 'canonical', href: url }
  ]
}
