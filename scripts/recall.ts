// Smoke-test retrieval: run a full_recall query and print the result summary.
// Usage: bun scripts/recall.ts "query terms" [--project=<name>] [--limit N]

import { hydra, tenantId } from './lib/hydra.ts'

const argv = process.argv.slice(2)
let limit = 5
let project: string | undefined
const positional: string[] = []
for (let i = 0; i < argv.length; i++) {
  const v = argv[i]!
  if (v.startsWith('--project=')) project = v.slice('--project='.length)
  else if (v === '--limit') limit = Number(argv[++i])
  else positional.push(v)
}
const query = positional.join(' ').trim()
if (!query) {
  console.error('usage: bun scripts/recall.ts "<query>" [--project=name] [--limit N]')
  process.exit(2)
}

const res = (await hydra().recall.fullRecall({
  tenant_id: tenantId(),
  query,
  max_results: limit,
  graph_context: true,
  ...(project ? { metadata_filters: { project } } : {})
})) as Record<string, unknown>

console.log(JSON.stringify(res, null, 2))
