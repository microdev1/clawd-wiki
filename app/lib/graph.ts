// Graph adjacency derived from app/content/wiki/graph.json (emitted by
// scripts/generate.ts). Used by the GraphPanel to render 1-hop neighborhoods
// with click-to-expand. All adjacency is undirected for traversal — the edge
// `kind` is preserved on the edge record so consumers can style differently.

import graphData from '../content/wiki/graph.json'
import type { WikiType } from './wiki'

export type GraphNodeType = WikiType | 'project'

export type GraphNode = {
  id: string
  type: GraphNodeType
  slug: string
  title: string
}

export type GraphEdge = {
  from: string
  to: string
  kind: 'related' | 'project'
}

type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] }

const data = graphData as GraphData

const nodeMap = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]))

const outAdj = new Map<string, Set<string>>()
const inAdj = new Map<string, Set<string>>()
for (const e of data.edges) {
  if (!outAdj.has(e.from)) outAdj.set(e.from, new Set())
  outAdj.get(e.from)!.add(e.to)
  if (!inAdj.has(e.to)) inAdj.set(e.to, new Set())
  inAdj.get(e.to)!.add(e.from)
}

export function nodeIdOf(type: GraphNodeType, slug: string): string {
  return `${type}:${slug}`
}

export function getNode(id: string): GraphNode | undefined {
  return nodeMap.get(id)
}

export function getNeighbors(id: string): string[] {
  const set = new Set<string>()
  for (const n of outAdj.get(id) ?? []) set.add(n)
  for (const n of inAdj.get(id) ?? []) set.add(n)
  set.delete(id)
  return [...set]
}

export function edgesAmong(ids: Set<string>): GraphEdge[] {
  return data.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
}

const edgeKindMap = new Map<string, GraphEdge['kind']>()
for (const e of data.edges) {
  edgeKindMap.set(`${e.from}|${e.to}`, e.kind)
  if (!edgeKindMap.has(`${e.to}|${e.from}`)) edgeKindMap.set(`${e.to}|${e.from}`, e.kind)
}

export function edgeKindBetween(a: string, b: string): GraphEdge['kind'] | null {
  return edgeKindMap.get(`${a}|${b}`) ?? edgeKindMap.get(`${b}|${a}`) ?? null
}

const TYPE_DIR: Record<GraphNodeType, string> = {
  project: 'projects',
  concept: 'concepts',
  pitfall: 'pitfalls',
  work: 'work-units'
}

export function routeFor(node: GraphNode): string {
  return `/${TYPE_DIR[node.type]}/${node.slug}`
}
