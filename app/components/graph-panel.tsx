// React Flow side panel showing the 1-hop neighborhood of the current wiki
// page. Click a non-center node to expand its neighbors; click again to
// collapse. Click the title to navigate. Drag nodes to reposition (positions
// persist across expansions). Renders client-only — the site is prerendered
// with ssr: false and React Flow needs DOM measurement.
//
// Layout is a force-directed simulation (d3-force) run synchronously on each
// recompute. The center node is pinned at the origin; everything else relaxes
// under link + repulsion + collide + weak centering forces. User-dragged nodes
// are seeded into the next simulation so they don't snap back.

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation
} from 'd3-force'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'

import {
  edgeKindBetween,
  getNeighbors,
  getNode,
  nodeIdOf,
  routeFor,
  type GraphEdge,
  type GraphNode,
  type GraphNodeType
} from '@/lib/graph'
import type { WikiType } from '@/lib/wiki'

const TYPE_COLOR: Record<GraphNodeType, string> = {
  project: '#0b5394',
  concept: '#3d5a80',
  pitfall: '#ba0000',
  work: '#117711'
}

// Compass layout: each node type clusters on a fixed side relative to its
// parent in the spanning tree. The target handle is the side of the node
// facing its parent so edges meet the box cleanly. Source handle is the side
// of the parent facing the child (the opposite of the child's target side).
type Side = 'l' | 'r' | 't' | 'b'

// Angle (atan2 convention; y+ is down in screen coords) from the parent toward
// where this node prefers to sit.
const DIRECTION_BY_TYPE: Record<GraphNodeType, number> = {
  project: -Math.PI / 2, // up
  concept: Math.PI, //     left
  work: 0, //              right
  pitfall: Math.PI / 2 //  down
}

// The handle facing the parent — opposite of the direction the node sits in.
const TARGET_SIDE_BY_TYPE: Record<GraphNodeType, Side> = {
  project: 'b',
  concept: 'r',
  work: 'l',
  pitfall: 't'
}

const OPPOSITE: Record<Side, Side> = { l: 'r', r: 'l', t: 'b', b: 't' }

const SIDE_TO_POSITION: Record<Side, Position> = {
  l: Position.Left,
  r: Position.Right,
  t: Position.Top,
  b: Position.Bottom
}

type NodeData = {
  node: GraphNode
  current: boolean
  expanded: boolean
  hasUnexploredNeighbors: boolean
  onToggle: () => void
}

type SimNode = {
  id: string
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  index?: number
}

type SimLink = { source: string; target: string }

// Custom force: pull each child toward an angle (relative to its parent in the
// spanning tree) determined by the child's type. This is what gives the
// finished layout its compass-style sectors — all concepts to the left of
// their parent, all pitfalls below, etc. Strength scales with `alpha` so the
// pull is strong early and relaxes as the simulation cools.
function sectorForce(
  parentOf: Map<string, string>,
  angleByType: Map<string, number>,
  strength: number
): (alpha: number) => void {
  let nodes: SimNode[] = []
  const nodeById = new Map<string, SimNode>()
  const force = (alpha: number) => {
    for (const n of nodes) {
      const parentId = parentOf.get(n.id)
      if (!parentId) continue
      const parent = nodeById.get(parentId)
      if (!parent) continue
      const dx = n.x - parent.x
      const dy = n.y - parent.y
      const r = Math.hypot(dx, dy)
      if (r < 1) continue
      const desired = angleByType.get(n.id)
      if (desired == null) continue
      // Anchor at the desired angle at the same distance the node currently sits
      // from its parent — biases angle without dictating distance.
      const targetX = parent.x + Math.cos(desired) * r
      const targetY = parent.y + Math.sin(desired) * r
      n.vx = (n.vx ?? 0) + (targetX - n.x) * strength * alpha
      n.vy = (n.vy ?? 0) + (targetY - n.y) * strength * alpha
    }
  }
  ;(force as unknown as { initialize: (n: SimNode[]) => void }).initialize = (n: SimNode[]) => {
    nodes = n
    nodeById.clear()
    for (const sn of n) nodeById.set(sn.id, sn)
  }
  return force
}

// Force-directed layout. Seeded positions (from a previous layout or a user
// drag) are reused so re-layouts feel stable. Center node is pinned at (0,0).
function computeForceLayout(
  ids: string[],
  edges: GraphEdge[],
  centerId: string,
  parentOf: Map<string, string>,
  angleByType: Map<string, number>,
  seedPositions: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  const simNodes: SimNode[] = ids.map((id) => {
    if (id === centerId) return { id, x: 0, y: 0, fx: 0, fy: 0 }
    const seed = seedPositions.get(id)
    if (seed) return { id, x: seed.x, y: seed.y }
    // Seed new nodes along their preferred angle so the simulation converges
    // toward the compass layout instead of detouring through a random shape.
    const angle = angleByType.get(id) ?? 0
    const r = 130
    return { id, x: Math.cos(angle) * r, y: Math.sin(angle) * r }
  })

  const simLinks: SimLink[] = edges.map((e) => ({ source: e.from, target: e.to }))

  const sim = forceSimulation<SimNode>(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(140)
        .strength(0.4)
    )
    .force('charge', forceManyBody<SimNode>().strength(-380).distanceMax(600))
    .force('collide', forceCollide<SimNode>(56))
    .force('sector', sectorForce(parentOf, angleByType, 0.5))
    .stop()

  for (let i = 0; i < 300; i++) sim.tick()

  const out = new Map<string, { x: number; y: number }>()
  for (const n of simNodes) out.set(n.id, { x: n.x, y: n.y })
  return out
}

// BFS from the center building a spanning tree. Each non-center visible node
// gets exactly one edge — back to the parent that introduced it. Cross-edges
// between siblings (which produced the "everything connected to everything"
// look) are intentionally omitted.
function buildVisibleSet(
  centerId: string,
  expanded: Set<string>
): { ids: string[]; edges: GraphEdge[]; parentOf: Map<string, string> } {
  const visible = new Set<string>([centerId])
  const parentOf = new Map<string, string>()
  const queue: string[] = [centerId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (id !== centerId && !expanded.has(id)) continue
    for (const n of getNeighbors(id)) {
      if (visible.has(n)) continue
      visible.add(n)
      parentOf.set(n, id)
      queue.push(n)
    }
  }
  const edges: GraphEdge[] = []
  for (const [child, parent] of parentOf) {
    edges.push({ from: parent, to: child, kind: edgeKindBetween(parent, child) ?? 'related' })
  }
  return { ids: [...visible], edges, parentOf }
}

function WikiNodeView({ data }: NodeProps<Node<NodeData>>) {
  const { node, current, expanded, hasUnexploredNeighbors, onToggle } = data
  const color = TYPE_COLOR[node.type]
  return (
    <div
      onClick={(e) => {
        if (current) return
        if ((e.target as HTMLElement).closest('a')) return
        onToggle()
      }}
      style={{
        padding: '6px 8px',
        borderRadius: 4,
        background: current ? color : '#fff',
        color: current ? '#fff' : '#202122',
        border: `1.5px solid ${color}`,
        fontSize: 12,
        fontFamily: 'sans-serif',
        maxWidth: 140,
        cursor: current ? 'grab' : 'pointer',
        lineHeight: 1.2,
        boxShadow: expanded ? `0 0 0 2px ${color}33` : undefined
      }}
    >
      {(['l', 'r', 't', 'b'] as Side[]).map((s) => (
        <Handle
          key={`t-${s}`}
          id={`t-${s}`}
          type="target"
          position={SIDE_TO_POSITION[s]}
          style={{ opacity: 0, width: 1, height: 1, border: 0 }}
        />
      ))}
      {(['l', 'r', 't', 'b'] as Side[]).map((s) => (
        <Handle
          key={`s-${s}`}
          id={`s-${s}`}
          type="source"
          position={SIDE_TO_POSITION[s]}
          style={{ opacity: 0, width: 1, height: 1, border: 0 }}
        />
      ))}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <Link
          to={routeFor(node)}
          style={{
            color: current ? '#fff' : color,
            textDecoration: 'none',
            fontWeight: current ? 600 : 500,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={node.title}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {node.title}
        </Link>
        {hasUnexploredNeighbors && (
          <span aria-hidden style={{ color: current ? '#fff' : color, fontSize: 10, fontWeight: 700 }}>
            +
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 10,
          opacity: 0.7,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginTop: 1
        }}
      >
        {node.type}
      </div>
    </div>
  )
}

const nodeTypes = { wiki: WikiNodeView }

function GraphCanvas({ centerId }: { centerId: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([centerId]))
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<NodeData>>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const { fitView } = useReactFlow()

  // Live positions ref — written on every onNodesChange tick (incl. drag), so
  // re-layouts can seed from the *current* visual state rather than the last
  // simulation snapshot.
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  useEffect(() => {
    const m = new Map<string, { x: number; y: number }>()
    for (const n of rfNodes) m.set(n.id, n.position)
    positionsRef.current = m
  }, [rfNodes])

  // Reset expansion + clear seeded positions when navigating to a different page.
  useEffect(() => {
    setExpanded(new Set([centerId]))
    positionsRef.current = new Map()
  }, [centerId])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Recompute layout whenever the visible set changes. Positions of nodes that
  // were already on screen are seeded from positionsRef so the user's drags
  // and prior simulation results persist.
  useEffect(() => {
    const { ids, edges, parentOf } = buildVisibleSet(centerId, expanded)
    const angleByType = new Map<string, number>()
    for (const id of ids) {
      if (id === centerId) continue
      const node = getNode(id)
      if (!node) continue
      angleByType.set(id, DIRECTION_BY_TYPE[node.type])
    }
    const positions = computeForceLayout(ids, edges, centerId, parentOf, angleByType, positionsRef.current)
    const visibleSet = new Set(ids)

    const nextNodes: Node<NodeData>[] = ids.map((id) => {
      const node = getNode(id)!
      const isCurrent = id === centerId
      const neighborCount = getNeighbors(id).length
      const visibleNeighbors = getNeighbors(id).filter((n) => visibleSet.has(n)).length
      return {
        id,
        type: 'wiki',
        position: positions.get(id)!,
        data: {
          node,
          current: isCurrent,
          expanded: expanded.has(id),
          hasUnexploredNeighbors: !isCurrent && neighborCount > visibleNeighbors,
          onToggle: () => toggle(id)
        },
        selectable: false
      }
    })

    const nextEdges: Edge[] = edges.map((e) => {
      const targetNode = getNode(e.to)
      const targetSide = targetNode ? TARGET_SIDE_BY_TYPE[targetNode.type] : 't'
      const sourceSide = OPPOSITE[targetSide]
      return {
        id: `${e.kind}:${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        sourceHandle: `s-${sourceSide}`,
        targetHandle: `t-${targetSide}`,
        style: {
          stroke: e.kind === 'project' ? '#0b5394' : '#a2a9b1',
          strokeWidth: 1,
          strokeDasharray: e.kind === 'project' ? '4 3' : undefined
        }
      }
    })

    setRfNodes(nextNodes)
    setRfEdges(nextEdges)
  }, [centerId, expanded, toggle, setRfNodes])

  // Re-fit when the visible set size changes (initial mount + expand/collapse).
  const visibleCount = rfNodes.length
  useEffect(() => {
    if (visibleCount === 0) return
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 250 }), 30)
    return () => clearTimeout(t)
  }, [visibleCount, fitView])

  if (rfNodes.length === 0) return null

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag
      zoomOnScroll
      zoomOnPinch
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      maxZoom={1.5}
    >
      <Background gap={20} size={1} color="#eaecf0" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  )
}

export function GraphPanel({ type, slug }: { type: WikiType; slug: string }) {
  const centerId = nodeIdOf(type, slug)
  const node = getNode(centerId)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!node) return null

  return (
    <aside className="graph-panel" aria-label="Linkage graph">
      <h4>Linkages</h4>
      <div className="graph-canvas">
        {mounted ? (
          <ReactFlowProvider>
            <GraphCanvas centerId={centerId} />
          </ReactFlowProvider>
        ) : (
          <div className="graph-placeholder" />
        )}
      </div>
      <p className="graph-hint">Drag nodes to rearrange. Click a node to expand neighbors; click the title to navigate.</p>
    </aside>
  )
}
