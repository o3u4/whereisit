import type { SpaceNode } from '../api/types'
import { useTranslation } from 'react-i18next'
import { useUi } from '../stores/ui'

export default function Breadcrumbs({ path }: { path: SpaceNode[] }) {
  const { t } = useTranslation()
  const select = useUi((s) => s.select)

  if (path.length === 0) return null

  return (
    <nav
      aria-label="path"
      className="pretty-scroll flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap py-0.5"
    >
      <span className="shrink-0 font-mono text-[13px] font-semibold text-accent">
        {t('browse.selectedPathPrefix')}
      </span>
      {path.map((node, i) => {
        const isLast = i === path.length - 1
        return isLast ? (
          <span
            key={node.id}
            className="shrink-0 rounded-full border border-white/30 bg-accent px-2.5 py-1 font-mono text-[12px] font-medium text-accent-ink shadow-[0_1px_2px_rgb(20_40_36_/0.12)]"
          >
            {node.name}
          </span>
        ) : (
          <button
            key={node.id}
            type="button"
            onClick={() => select(node.id)}
            className="glass-chip pressable shrink-0 rounded-full px-2.5 py-1 font-mono text-[12px] text-muted hover:text-accent"
          >
            {node.name}
          </button>
        )
      })}
    </nav>
  )
}
