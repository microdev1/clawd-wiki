import mdx from '@mdx-js/rollup'
import { reactRouter } from '@react-router/dev/vite'
import rehypeShiki from '@shikijs/rehype'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import rehypeSlug from 'rehype-slug'
import rehypeUnwrapImages from 'rehype-unwrap-images'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    mdx({
      remarkPlugins: [remarkFrontmatter, remarkGfm, remarkMdxFrontmatter],
      rehypePlugins: [
        rehypeSlug,
        rehypeUnwrapImages,
        [
          rehypeShiki,
          {
            themes: { light: 'vitesse-light', dark: 'vitesse-black' },
            defaultColor: false
          }
        ]
      ]
    }),
    reactRouter()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app', import.meta.url))
    }
  }
})
