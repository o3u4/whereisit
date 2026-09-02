import type { SpaceNode } from '../api/types'
import { useTranslation } from 'react-i18next'
import { useUi } from '../stores/ui'

export default function Breadcrumbs({ path }: { path: SpaceNode[] }) {
  const { t } = useTranslation()
  const select = useUi((s) => s.select)

  if (path.length === 0) return null

  return (
    <nav aria-label="path" className="flex items-center gap-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-muted">
      <span className="text-faint">{t('browse.selectedPathPrefix')}</span>
      {path.map((node, i) => {
        const isLast = i === path.length - 1
        return (
          <span key={node.id} className="flex items-center gap-1">
            {i > 0 && <span className="text-faint">/</span>}
            {isLast ? (
              <span className="font-medium text-ink">{node.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => select(node.id)}
                className="rounded px-0.5 transition-colors hover:text-accent"
              >
                {node.name}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
