export interface SpaceNode {
  id: number
  parent_id: number | null
  name: string
  type_tag: string
  ord: number
  layout_json: string | null
  created_at: string
  updated_at: string
  children: SpaceNode[]
}

export interface SpaceInput {
  parent_id: number | null
  name: string
  type_tag: string
}

/** Returns the chain from root -> target node, or null if not found. */
export function findPath(tree: SpaceNode[], targetId: number): SpaceNode[] | null {
  for (const node of tree) {
    const chain = descend(node, targetId, [])
    if (chain) return chain
  }
  return null
}

function descend(node: SpaceNode, targetId: number, acc: SpaceNode[]): SpaceNode[] | null {
  const next = [...acc, node]
  if (node.id === targetId) return next
  for (const child of node.children) {
    const found = descend(child, targetId, next)
    if (found) return found
  }
  return null
}
