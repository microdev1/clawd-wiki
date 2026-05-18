import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects')

export type Turn =
  | { role: 'user'; text: string; timestamp: string }
  | { role: 'assistant'; text: string; timestamp: string; model?: string }
  | { role: 'tool_use'; name: string; input: unknown; timestamp: string }
  | { role: 'tool_result'; preview: string; isError: boolean; timestamp: string }

export type Session = {
  sessionId: string
  title: string | null
  projectDir: string // e.g. -Users-macroni-Developer-projects-boilerplate-ssg
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

const TOOL_RESULT_PREVIEW_CHARS = 400

type MessageContent = string | Array<Record<string, unknown>> | undefined

function extractContent(content: MessageContent): {
  text: string[]
  toolUses: Array<{ name: string; input: unknown }>
  toolResults: Array<{ preview: string; isError: boolean }>
} {
  const text: string[] = []
  const toolUses: Array<{ name: string; input: unknown }> = []
  const toolResults: Array<{ preview: string; isError: boolean }> = []

  if (typeof content === 'string') {
    if (content.trim()) text.push(content)
    return { text, toolUses, toolResults }
  }
  if (!Array.isArray(content)) return { text, toolUses, toolResults }

  for (const block of content) {
    const t = block.type as string | undefined
    if (t === 'text' && typeof block.text === 'string') {
      text.push(block.text)
    } else if (t === 'tool_use') {
      toolUses.push({ name: String(block.name ?? '?'), input: block.input })
    } else if (t === 'tool_result') {
      const c = block.content
      let preview = ''
      if (typeof c === 'string') preview = c
      else if (Array.isArray(c)) {
        preview = c
          .map((b) => (typeof b === 'object' && b && 'text' in b ? String((b as { text: unknown }).text ?? '') : ''))
          .join('\n')
      }
      preview = preview.slice(0, TOOL_RESULT_PREVIEW_CHARS)
      toolResults.push({ preview, isError: Boolean(block.is_error) })
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
      const { text, toolResults } = extractContent(evt.message.content)
      for (const t of text) {
        turns.push({ role: 'user', text: t, timestamp: evt.timestamp ?? '' })
      }
      for (const r of toolResults) {
        turns.push({ role: 'tool_result', preview: r.preview, isError: r.isError, timestamp: evt.timestamp ?? '' })
      }
    } else if (evt.type === 'assistant' && evt.message?.role === 'assistant') {
      const { text, toolUses } = extractContent(evt.message.content)
      for (const t of text) {
        turns.push({ role: 'assistant', text: t, timestamp: evt.timestamp ?? '', model: evt.message.model })
      }
      for (const u of toolUses) {
        turns.push({ role: 'tool_use', name: u.name, input: u.input, timestamp: evt.timestamp ?? '' })
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

export function renderTranscript(s: Session): string {
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

  for (const t of s.turns) {
    if (t.role === 'user') {
      lines.push('## User')
      lines.push(t.text.trim())
    } else if (t.role === 'assistant') {
      lines.push('## Assistant')
      lines.push(t.text.trim())
    } else if (t.role === 'tool_use') {
      let preview: string
      try {
        preview = JSON.stringify(t.input).slice(0, 200)
      } catch {
        preview = '<unserializable>'
      }
      lines.push(`> tool_use: \`${t.name}\` ${preview}`)
    } else if (t.role === 'tool_result') {
      const head = t.preview.split('\n').slice(0, 3).join(' / ').slice(0, 200)
      lines.push(`> tool_result${t.isError ? ' (error)' : ''}: ${head}`)
    }
    lines.push('')
  }
  return lines.join('\n')
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
