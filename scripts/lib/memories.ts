// HydraDB Memories surface for Claude Code auto-memory files.
//
// Different from the Knowledge surface used by uploadSession:
//   - separate vector index, separate endpoints (add_memory / recall_preferences)
//   - scoped per-user via sub_tenant_id (we use the OS user as the sub-tenant
//     so memories recall cross-project)
//   - no scrubbing — these are the user's own memory files, personal-by-design
//
// Walks ~/.claude/projects/<proj-slug>/memory/*.md. Skips MEMORY.md (the
// per-project index — it just lists the other files; uploading it duplicates
// content and adds noise to recall).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { basename, join } from 'node:path'
import { hydra, tenantId } from './hydra.ts'
import { getMemory, updateMemoryStatus, upsertMemory } from './state.ts'
import { sha256 } from './upload.ts'

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects')

// Sub-tenant key — user-level so memories recall is cross-project. Override via
// HYDRA_MEMORY_SUB_TENANT for separation (e.g. per-host).
export function memorySubTenant(): string {
  return process.env.HYDRA_MEMORY_SUB_TENANT ?? userInfo().username
}

export type MemoryFile = {
  path: string
  project: string
  filename: string
  body: string
}

export function discoverMemoryFiles(opts: { includeProject?: string } = {}): MemoryFile[] {
  if (!existsSync(PROJECTS_ROOT)) return []
  const out: MemoryFile[] = []
  for (const project of readdirSync(PROJECTS_ROOT)) {
    if (opts.includeProject && project !== opts.includeProject) continue
    const memDir = join(PROJECTS_ROOT, project, 'memory')
    if (!existsSync(memDir)) continue
    try {
      if (!statSync(memDir).isDirectory()) continue
    } catch {
      continue
    }
    for (const file of readdirSync(memDir)) {
      if (!file.endsWith('.md')) continue
      // The MEMORY.md index just points at sibling files — uploading it
      // would duplicate every memory's title into recall.
      if (file === 'MEMORY.md') continue
      const path = join(memDir, file)
      const body = readFileSync(path, 'utf8')
      out.push({ path, project, filename: basename(file, '.md'), body })
    }
  }
  return out
}

export type MemoryUploadOutcome =
  | { result: 'skipped'; path: string; reason: 'unchanged' }
  | { result: 'uploaded'; path: string; source_id: string; status: string; project: string }
  | { result: 'errored'; path: string; error: string }

// Stable source_id from path so re-uploads upsert (Hydra accepts arbitrary
// strings). Hashing the path gives idempotency without exposing it server-side.
export function memorySourceId(path: string): string {
  return sha256(path).slice(0, 32)
}

export async function uploadMemoryFile(
  file: MemoryFile,
  options: { force?: boolean; infer?: boolean } = {}
): Promise<MemoryUploadOutcome> {
  const hash = sha256(file.body)
  if (!options.force) {
    const existing = getMemory(file.path)
    if (existing && existing.content_hash === hash && existing.status !== 'errored') {
      return { result: 'skipped', path: file.path, reason: 'unchanged' }
    }
  }

  const id = tenantId()
  const source_id = memorySourceId(file.path)
  const item = {
    source_id,
    title: file.filename,
    text: file.body,
    is_markdown: true,
    infer: options.infer ?? false,
    // tenant_metadata is the filterable surface (declared on the tenant
    // schema). project lets a future recall_preferences scope to one project.
    tenant_metadata: JSON.stringify({ project: file.project }),
    document_metadata: JSON.stringify({
      filename: file.filename,
      project: file.project,
      path: file.path
    })
  }

  upsertMemory({
    memory_path: file.path,
    content_hash: hash,
    source_id,
    project: file.project,
    status: 'pending',
    updated_at: new Date().toISOString()
  })

  try {
    const res = await hydra().upload.addMemory({
      tenant_id: id,
      sub_tenant_id: memorySubTenant(),
      upsert: true,
      memories: [item]
    })
    const r = res.results?.[0]
    const newId = r?.source_id ?? source_id
    const status = r?.status ?? 'queued'
    updateMemoryStatus(file.path, status)
    return { result: 'uploaded', path: file.path, source_id: newId, status, project: file.project }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    updateMemoryStatus(file.path, 'errored')
    return { result: 'errored', path: file.path, error: msg.split('\n')[0]! }
  }
}

export type MemoryRecallChunk = {
  chunk_content?: string
  source_id?: string
  source_title?: string
  relevancy_score?: number
}

export type MemoryRecallSource = {
  id?: string
  title?: string
  type?: string
  // tenant_metadata surfaces here as `metadata` on the source record;
  // document_metadata surfaces as `additional_metadata`.
  metadata?: Record<string, unknown> | null
  additional_metadata?: Record<string, unknown> | null
}

export type MemoryRecallResult = {
  chunks?: MemoryRecallChunk[]
  sources?: MemoryRecallSource[]
}

export async function recallMemories(opts: {
  query: string
  project?: string
  limit?: number
  graphContext?: boolean
}): Promise<MemoryRecallResult> {
  const id = tenantId()
  return (await hydra().recall.recallPreferences({
    tenant_id: id,
    sub_tenant_id: memorySubTenant(),
    query: opts.query,
    max_results: opts.limit ?? 5,
    graph_context: opts.graphContext ?? false,
    ...(opts.project ? { metadata_filters: { project: opts.project } } : {})
  })) as MemoryRecallResult
}
