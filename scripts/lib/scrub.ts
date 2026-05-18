// Three concerns, one module:
//   1. Credentials  — high-entropy secrets (API keys, tokens, private keys).
//   2. PII / locators — emails, absolute paths, phone numbers, IPv4.
//   3. Denylist     — user-supplied terms (usernames, company names, codenames).
//
// Paths under a known project root (config.projectPathRoots) are rewritten to
// `<PATH:project=NAME>` so the project name (top of the wiki navigation chain)
// survives. Other paths collapse to `<PATH>`.
//
// scrub() is used both pre-distill (so the LLM never sees originals) and as a
// post-distill verifier via scan().

import { loadConfig } from './config.ts'

type Rule = {
  name: string
  pattern: RegExp
  // Either a static placeholder, or a function that derives one from the match.
  replace: string | ((match: string, ...groups: string[]) => string)
}

const CRED_RULES: Rule[] = [
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g, replace: '<REDACTED:anthropic-key>' },
  { name: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b/g, replace: '<REDACTED:openai-key>' },
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: '<REDACTED:aws-access-key>' },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, replace: '<REDACTED:github-token>' },
  { name: 'gcp-key', pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/g, replace: '<REDACTED:gcp-key>' },
  { name: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9\-]{10,}\b/g, replace: '<REDACTED:slack-token>' },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g, replace: '<REDACTED:jwt>' },
  { name: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: '<REDACTED:private-key>' }
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let _piiRules: Rule[] | null = null
function piiRules(): Rule[] {
  if (_piiRules) return _piiRules

  const cfg = loadConfig()
  const rules: Rule[] = []

  // 1. Project-aware path rule (must run BEFORE the generic path rule).
  //
  // Captures the segment after a known project root and emits
  // `<PATH:project=NAME>`. Partial captures (truncated tool-result previews
  // produce strings like `cilaye`) and trailing punctuation are cleaned in
  // the replace callback. Captures under 4 chars fall through to <PATH>.
  if (cfg.projectPathRoots.length > 0) {
    const rootsAlt = cfg.projectPathRoots.map(escapeRegex).join('|')
    const cleanCapture = (s: string): string | null => {
      const trimmed = s.replace(/[.\-_]+$/, '')
      if (trimmed.length < 3) return null
      if (!/^[A-Za-z][A-Za-z0-9._\-]*[A-Za-z0-9]$/.test(trimmed)) return null
      return trimmed
    }

    const pattern = new RegExp(
      `\\/Users\\/[A-Za-z0-9._\\-]+\\/(?:${rootsAlt})\\/([A-Za-z][A-Za-z0-9._\\-]{2,})(?:\\/[^\\s"'\`<>()\\[\\],]*)?`,
      'g'
    )
    rules.push({
      name: 'project-path',
      pattern,
      replace: (_m, project: string) => {
        const clean = cleanCapture(project)
        return clean ? `<PATH:project=${clean}>` : '<PATH>'
      }
    })

    const rootsDashed = cfg.projectPathRoots.map((r) => escapeRegex(r.replace(/\//g, '-'))).join('|')
    const encodedPattern = new RegExp(
      `-Users-[A-Za-z0-9._]+-(?:${rootsDashed})-([A-Za-z][A-Za-z0-9\\-]{2,})`,
      'g'
    )
    rules.push({
      name: 'project-encoded-path',
      pattern: encodedPattern,
      replace: (_m, project: string) => {
        const clean = cleanCapture(project)
        return clean ? `<PATH:project=${clean}>` : '<ENCODED_PATH>'
      }
    })
  }

  // 2. Generic catch-all path rules.
  rules.push(
    { name: 'unix-path', pattern: /\/(?:Users|home|root|var|opt|etc|tmp|private)\/[^\s"'`<>()[\],]+/g, replace: '<PATH>' },
    { name: 'tilde-path', pattern: /~\/[A-Za-z0-9._\-/]+/g, replace: '<PATH>' },
    { name: 'windows-path', pattern: /\b[A-Za-z]:[\\/](?:Users|Documents|Desktop|home)[\\/][^\s"'`<>()]+/g, replace: '<PATH>' },
    { name: 'encoded-path', pattern: /-Users-[A-Za-z0-9]+-[A-Za-z0-9\-]+/g, replace: '<ENCODED_PATH>' },
    { name: 'email', pattern: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, replace: '<EMAIL>' },
    { name: 'ipv4', pattern: /\b(?!0\.0\.0\.0|127\.0\.0\.1|255\.255\.255\.255)(?:\d{1,3}\.){3}\d{1,3}\b/g, replace: '<IP>' },
    { name: 'phone', pattern: /\+?\d{1,3}[\s.\-]?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g, replace: '<PHONE>' },
    {
      name: 'env-assignment',
      pattern: /(^|[\s"'`])([A-Z][A-Z0-9_]{2,})\s*=\s*["']?([A-Za-z0-9_\-+/=]{20,})["']?/gm,
      replace: (_m, prefix: string, key: string) => `${prefix}${key}=<REDACTED>`
    }
  )

  _piiRules = rules
  return _piiRules
}

let _denylistRules: Rule[] | null = null
function denylistRules(): Rule[] {
  if (_denylistRules) return _denylistRules
  const { denylist } = loadConfig()
  _denylistRules = denylist
    .filter((t) => t && t.length >= 3)
    .map((term) => ({
      name: `denylist:${term.toLowerCase()}`,
      pattern: new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi'),
      replace: '<REDACTED>'
    }))
  return _denylistRules
}

export type ScrubReport = {
  hits: Record<string, number>
  total: number
  samples: Record<string, string[]>
}

// Truncated tool-result previews produce partial path captures like `cila`,
// `cilaye` alongside the full `cilayer`. Collapse shorter prefix-captures into
// their longest sibling within the same document.
function reconcileProjectCaptures(text: string): string {
  const captures = new Set<string>()
  for (const m of text.matchAll(/<PATH:project=([^>]+)>/g)) captures.add(m[1]!)
  if (captures.size <= 1) return text
  const sorted = [...captures].sort((a, b) => b.length - a.length)
  const canonical: Record<string, string> = {}
  for (const name of sorted) canonical[name] = name
  for (const shorter of sorted) {
    for (const longer of sorted) {
      if (longer.length <= shorter.length) continue
      if (longer.startsWith(shorter)) {
        canonical[shorter] = longer
        break
      }
    }
  }
  return text.replace(/<PATH:project=([^>]+)>/g, (_m, name: string) => `<PATH:project=${canonical[name] ?? name}>`)
}

export function scrub(input: string): { text: string; report: ScrubReport } {
  let text = input
  const hits: Record<string, number> = {}
  const samples: Record<string, string[]> = {}
  let total = 0

  // Denylist runs LAST so project-path placeholders (`<PATH:project=cilayer>`)
  // aren't disturbed by denylist terms that might appear inside the placeholder.
  const all: Rule[] = [...CRED_RULES, ...piiRules(), ...denylistRules()]

  for (const rule of all) {
    text = text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      hits[rule.name] = (hits[rule.name] ?? 0) + 1
      total++
      if (!samples[rule.name]) samples[rule.name] = []
      if (samples[rule.name]!.length < 3) samples[rule.name]!.push(match.slice(0, 80))
      if (typeof rule.replace === 'string') return rule.replace
      const groups = rest.filter((r) => typeof r === 'string') as string[]
      return rule.replace(match, ...groups)
    })
  }
  text = reconcileProjectCaptures(text)
  return { text, report: { hits, total, samples } }
}

export function scan(input: string): ScrubReport {
  return scrub(input).report
}
