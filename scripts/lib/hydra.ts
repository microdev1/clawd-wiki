// Thin singleton wrapper around @hydradb/sdk.
// Keeps the rest of the pipeline ignorant of SDK construction details.

import { HydraDBClient } from '@hydradb/sdk'

let _client: HydraDBClient | undefined

export function hydra(): HydraDBClient {
  if (_client) return _client
  const token = process.env.HYDRA_API_KEY
  if (!token || token.startsWith('hyd_...')) {
    throw new Error('HYDRA_API_KEY not set in .env')
  }
  const baseUrl = process.env.HYDRA_BASE_URL
  _client = new HydraDBClient({ token, ...(baseUrl ? { baseUrl } : {}) })
  return _client
}

export function tenantId(): string {
  const id = process.env.HYDRA_TENANT_ID
  if (!id) throw new Error('HYDRA_TENANT_ID not set in .env')
  return id
}

// Metadata schema we declare at tenant-creation time. project/session_id/branch
// are filterable so future retrieval can scope by project or single session.
export const TENANT_METADATA_SCHEMA = [
  { name: 'project', data_type: 'VARCHAR' as const, max_length: 64, enable_match: true },
  { name: 'session_id', data_type: 'VARCHAR' as const, max_length: 64, enable_match: true },
  { name: 'branch', data_type: 'VARCHAR' as const, max_length: 128, enable_match: true }
]
