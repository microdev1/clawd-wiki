import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type RedactConfig = {
  denylist: string[]
  projectPathRoots: string[]
  excludeProjects: string[]
}

let _cached: RedactConfig | null = null

export function loadConfig(): RedactConfig {
  if (_cached) return _cached
  const configPath = join(import.meta.dir, '..', '..', 'config', 'redact.json')
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<RedactConfig>
    _cached = {
      denylist: raw.denylist ?? [],
      projectPathRoots: raw.projectPathRoots ?? [],
      excludeProjects: raw.excludeProjects ?? []
    }
  } catch {
    _cached = { denylist: [], projectPathRoots: [], excludeProjects: [] }
  }
  return _cached
}
