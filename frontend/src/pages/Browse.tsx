import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { findPath, type SpaceNode } from '../api/types'
import { useUi } from '../stores/ui'
import TreePane from '../components/TreePane'
import Breadcrumbs from '../components/Breadcrumbs'
import AddSpace from '../components/AddSpace'
import TypeBadge from '../components/TypeBadge'

export default function Browse() {
  const { t } = useTranslation()
  const { data: tree = [], isLoading, isError } = useQuery({
    queryKey: ['spaces', 'tree'],
    queryFn: api.tree,
  })

  const selectedId = useUi((s) => s.selectedId)
  const select = useUi((s) => s.select)
  const expandPath = useUi((s) => s.expandPath)

  const path = selectedId != null ? findPath(tree, selectedId) : null
  const selected = path ? path[path.length - 1] : null

  useEffect(() => {
    if (tree.length > 0 && selectedId == null) select(tree[0].id)
  }, [tree, selectedId, select])

  useEffect(() => {
    if (selectedId == null) return
    const p = findPath(tree, selectedId)
    if (p && p.length > 1) expandPath(p.slice(0, -1).map((n) => n.id))
  }, [tree, selectedId, expandPath])

  if (isLoading) return <div className="p-6 text-[13px] text-faint">…</div>
  if (isError) return <div className="p-6 text-[13px] text-[#b3452f]">{t('status.offline')}</div>

  return (
    <div className="flex min-h-0 w-full flex-1">
      {/* ---- tree sidebar ---- */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
            {t('nav.browse')}
          </span>
          <AddSpace parentId={selectedId} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {tree.length === 0 ? (
            <p className="px-2 py-3 text-[12px] leading-relaxed text-faint">
              {t('browse.emptySpacesHint')}
            </p>
          ) : (
            <TreePane roots={tree} />
          )}
        </div>
      </aside>

      {/* ---- content ---- */}
      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tree.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <h2 className="text-[15px] font-medium">{t('browse.emptySpacesTitle')}</h2>
              <p className="mb-4 mt-2 text-[13px] leading-relaxed text-muted">
                {t('browse.emptySpacesHint')}
              </p>
              <div className="mx-auto w-56">
                <AddSpace parentId={null} />
              </div>
            </div>
          </div>
        ) : !path || !selected ? (
          <div className="flex flex-1 items-center justify-center px-6 text-[13px] text-faint">
            {t('browse.emptySelected')}
          </div>
        ) : (
          <div className="flex flex-col gap-5 p-5">
            <div className="flex items-center justify-between gap-3">
              <Breadcrumbs path={path} />
              <AddSpace parentId={selected.id} />
            </div>

            <div>
              <h3 className="mb-1 text-[18px] font-medium tracking-tight text-ink">
                {selected.name}
              </h3>
              <p className="text-[12px] text-faint">
                {t('browse.subSpaces')} · {selected.children.length}
              </p>
            </div>

            {selected.children.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-faint">
                {t('browse.noChildren')}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {selected.children.map((child) => (
                  <ChildCard key={child.id} node={child} onOpen={() => select(child.id)} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function ChildCard({ node, onOpen }: { node: SpaceNode; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 text-left transition-colors hover:border-accent/40"
      >
        <TypeBadge tag={node.type_tag} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {node.name}
        </span>
        <span className="font-mono text-[11px] text-faint">
          {node.children.length}
        </span>
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="m6 3 5 5-5 5" />
        </svg>
      </button>
    </li>
  )
}
