import type { SpaceNode } from '../api/types'
import { useUi } from '../stores/ui'
import TypeBadge from './TypeBadge'

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  )
}

function TreeNode({ node, depth }: { node: SpaceNode; depth: number }) {
  const selectedId = useUi((s) => s.selectedId)
  const expanded = useUi((s) => s.expanded)
  const select = useUi((s) => s.select)
  const toggle = useUi((s) => s.toggle)

  const hasKids = node.children.length > 0
  const isOpen = expanded.has(node.id)
  const isSel = selectedId === node.id

  return (
    <li>
      <div
        role="treeitem"
        aria-expanded={hasKids ? isOpen : undefined}
        aria-selected={isSel}
        onClick={() => select(node.id)}
        style={{ paddingLeft: depth * 16 }}
        className={`flex cursor-pointer items-center gap-1.5 rounded-lg py-1 pr-2 text-[13px] transition-colors ${
          isSel ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-paper hover:text-ink'
        }`}
      >
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            if (hasKids) toggle(node.id)
          }}
          className={`flex h-4 w-4 items-center justify-center rounded ${hasKids ? 'text-faint hover:text-ink' : 'opacity-0'}`}
        >
          <Chevron open={isOpen} />
        </button>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <TypeBadge tag={node.type_tag} />
      </div>
      {hasKids && isOpen && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function TreePane({ roots }: { roots: SpaceNode[] }) {
  if (roots.length === 0) return null
  return (
    <ul role="tree">
      {roots.map((root) => (
        <TreeNode key={root.id} node={root} depth={0} />
      ))}
    </ul>
  )
}
