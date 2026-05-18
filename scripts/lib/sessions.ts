// Session reader + splitter. Emits a two-layer representation:
//   - A "skeleton" transcript that captures conversational flow plus one
//     pointer line per tool call (`@tools/<seq>-<Name>.md`).
//   - One file per tool call (`tools/<seq>-<Name>.md`) holding the FULL
//     untruncated input + result.
//
// Distillation sub-agents read the skeleton end-to-end and then surgically
// Read only the tool files they need (a key edit, a tricky read, the failing
// command) so code can be quoted verbatim without ballooning the agent's
// initial context.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects')

export type Turn =
  | { role: 'user'; text: string; timestamp: string }
  | { role: 'assistant'; text: string; timestamp: string; model?: string }
  | {
      role: 'tool_use'
      seq: number
      name: string
      input: unknown
      toolUseId: string
      timestamp: string
    }
  | {
      role: 'tool_result'
      toolUseId: string
      content: string
      isError: boolean
      timestamp: string
    }

export type Session = {
  sessionId: string
  title: string | null
  projectDir: string
  cwd: string | null
  branch: string | null
  startedAt: string | null
  endedAt: string | null
  model: string | null
  turns: Turn[]
  rawLineCount: number
}

type Line = {
  type: string
  message?: {
    role?: 'user' | 'assistant'
    content?: string | Array<Record<string, unknown>>
    model?: string
  }
  cwd?: string
  gitBranch?: string
  timestamp?: string
  aiTitle?: string
  sessionId?: string
}

type MessageContent = string | Array<Record<string, unknown>> | undefined

function blockText(block: Record<string, unknown>): string {
  const c = block['content']
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((b) => (typeof b === 'object' && b && 'text' in b ? String((b as { text: unknown }).text ?? '') : ''))
      .join('\n')
  }
  return ''
}

function extractContent(
  content: MessageContent,
  seqRef: { value: number }
): {
  text: string[]
  toolUses: Array<{ seq: number; name: string; input: unknown; toolUseId: string }>
  toolResults: Array<{ toolUseId: string; content: string; isError: boolean }>
} {
  const text: string[] = []
  const toolUses: Array<{ seq: number; name: string; input: unknown; toolUseId: string }> = []
  const toolResults: Array<{ toolUseId: string; content: string; isError: boolean }> = []

  if (typeof content === 'string') {
    if (content.trim()) text.push(content)
    return { text, toolUses, toolResults }
  }
  if (!Array.isArray(content)) return { text, toolUses, toolResults }

  for (const block of content) {
    const t = block['type'] as string | undefined
    if (t === 'text' && typeof block['text'] === 'string') {
      text.push(block['text'] as string)
    } else if (t === 'tool_use') {
      const seq = ++seqRef.value
      toolUses.push({
        seq,
        name: String(block['name'] ?? '?'),
        input: block['input'],
        toolUseId: String(block['id'] ?? `unknown-${seq}`)
      })
    } else if (t === 'tool_result') {
      toolResults.push({
        toolUseId: String(block['tool_use_id'] ?? ''),
        content: blockText(block),
        isError: Boolean(block['is_error'])
      })
    }
    // intentionally skip "thinking" blocks
  }
  return { text, toolUses, toolResults }
}

export function readSession(jsonlPath: string, projectDir: string): Session {
  const raw = readFileSync(jsonlPath, 'utf8')
  const lines = raw.split('\n').filter(Boolean)
  const sessionId = jsonlPath.split('/').pop()!.replace(/\.jsonl$/, '')

  let title: string | null = null
  let cwd: string | null = null
  let branch: string | null = null
  let startedAt: string | null = null
  let endedAt: string | null = null
  let model: string | null = null
  const turns: Turn[] = []
  const seqRef = { value: 0 }

  for (const line of lines) {
    let evt: Line
    try {
      evt = JSON.parse(line) as Line
    } catch {
      continue
    }
    if (evt.type === 'ai-title' && evt.aiTitle) {
      title = evt.aiTitle
      continue
    }
    if (evt.cwd && !cwd) cwd = evt.cwd
    if (evt.gitBranch && !branch) branch = evt.gitBranch
    if (evt.timestamp) {
      if (!startedAt) startedAt = evt.timestamp
      endedAt = evt.timestamp
    }
    if (evt.message?.model && !model) model = evt.message.model

    if (evt.type === 'user' && evt.message?.role === 'user') {
      const { text, toolResults } = extractContent(evt.message.content, seqRef)
      for (const t of text) {
        turns.push({ role: 'user', text: t, timestamp: evt.timestamp ?? '' })
      }
      for (const r of toolResults) {
        turns.push({
          role: 'tool_result',
          toolUseId: r.toolUseId,
          content: r.content,
          isError: r.isError,
          timestamp: evt.timestamp ?? ''
        })
      }
    } else if (evt.type === 'assistant' && evt.message?.role === 'assistant') {
      const { text, toolUses } = extractContent(evt.message.content, seqRef)
      for (const t of text) {
        turns.push({
          role: 'assistant',
          text: t,
          timestamp: evt.timestamp ?? '',
          ...(evt.message.model ? { model: evt.message.model } : {})
        })
      }
      for (const u of toolUses) {
        turns.push({
          role: 'tool_use',
          seq: u.seq,
          name: u.name,
          input: u.input,
          toolUseId: u.toolUseId,
          timestamp: evt.timestamp ?? ''
        })
      }
    }
  }

  return {
    sessionId,
    title,
    projectDir,
    cwd,
    branch,
    startedAt,
    endedAt,
    model,
    turns,
    rawLineCount: lines.length
  }
}

function toolFilename(seq: number, name: string): string {
  return `${String(seq).padStart(3, '0')}-${name}.md`
}

function firstLine(s: string, max = 120): string {
  const line = s.split('\n').find((l) => l.trim()) ?? ''
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

export type ToolFile = { seq: number; name: string; filename: string; content: string }

// Split a Session into a skeleton transcript and one file per tool call.
// Tool calls in the skeleton appear as a single pointer line per tool_use
// (the result is appended into the same file).
export function splitSession(s: Session): { skeleton: string; toolFiles: ToolFile[] } {
  const resultsByUseId = new Map<string, { content: string; isError: boolean }>()
  for (const t of s.turns) {
    if (t.role === 'tool_result' && t.toolUseId) {
      resultsByUseId.set(t.toolUseId, { content: t.content, isError: t.isError })
    }
  }

  const toolFiles: ToolFile[] = []
  const lines: string[] = []

  lines.push(`# ${s.title ?? s.sessionId}`)
  lines.push('')
  lines.push(`- session: ${s.sessionId}`)
  if (s.cwd) lines.push(`- cwd: ${s.cwd}`)
  if (s.branch) lines.push(`- branch: ${s.branch}`)
  if (s.startedAt) lines.push(`- started: ${s.startedAt}`)
  if (s.endedAt) lines.push(`- ended: ${s.endedAt}`)
  if (s.model) lines.push(`- model: ${s.model}`)
  lines.push('')
  lines.push(
    '> Full tool inputs + results live in `tools/<seq>-<Name>.md`. Read those surgically when you need the verbatim code, file content, or command output behind a turn.'
  )
  lines.push('')

  for (const t of s.turns) {
    if (t.role === 'user') {
      lines.push('## User')
      lines.push(t.text.trim())
      lines.push('')
    } else if (t.role === 'assistant') {
      lines.push('## Assistant')
      lines.push(t.text.trim())
      lines.push('')
    } else if (t.role === 'tool_use') {
      let inputJson: string
      try {
        inputJson = JSON.stringify(t.input)
      } catch {
        inputJson = '"<unserializable>"'
      }
      const inputPreview = inputJson.length > 120 ? inputJson.slice(0, 117) + '…' : inputJson
      const filename = toolFilename(t.seq, t.name)
      const result = resultsByUseId.get(t.toolUseId)
      const status = result ? (result.isError ? 'error' : 'ok') : 'no-result'
      const outline = result ? ` — ${firstLine(result.content, 80)}` : ''
      lines.push(`> tool [${String(t.seq).padStart(3, '0')}] \`${t.name}\` ${inputPreview} → ${status} @tools/${filename}${outline}`)
      lines.push('')

      const fileParts: string[] = []
      fileParts.push(`# Tool ${String(t.seq).padStart(3, '0')} — ${t.name}`)
      fileParts.push('')
      fileParts.push(`- tool_use_id: ${t.toolUseId}`)
      fileParts.push(`- status: ${status}`)
      fileParts.push('')
      fileParts.push('## Input')
      fileParts.push('')
      fileParts.push('```json')
      try {
        fileParts.push(JSON.stringify(t.input, null, 2))
      } catch {
        fileParts.push('"<unserializable>"')
      }
      fileParts.push('```')
      fileParts.push('')
      fileParts.push('## Result')
      fileParts.push('')
      if (result) {
        fileParts.push(result.content || '<empty>')
      } else {
        fileParts.push('<no result captured in transcript>')
      }
      fileParts.push('')
      toolFiles.push({ seq: t.seq, name: t.name, filename, content: fileParts.join('\n') })
    }
    // tool_result already folded into the matching tool_use line above
  }

  return { skeleton: lines.join('\n'), toolFiles }
}

export function listProjects(): string[] {
  return readdirSync(PROJECTS_ROOT).filter((d) => {
    try {
      return statSync(join(PROJECTS_ROOT, d)).isDirectory()
    } catch {
      return false
    }
  })
}

export function listSessions(projectDir: string): string[] {
  const dir = join(PROJECTS_ROOT, projectDir)
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

export function sessionSizeBytes(jsonlPath: string): number {
  try {
    return statSync(jsonlPath).size
  } catch {
    return 0
  }
}
