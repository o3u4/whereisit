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

  if (isLoading)
    return (
      <div className="flex w-full items-center justify-center py-10 text-[13px] text-faint">
        …
      </div>
    )
  if (isError)
    return (
      <div className="flex w-full items-center justify-center py-10 text-[13px] text-danger">
        {t('status.offline')}
      </div>
    )

  return (
    <div className="flex min-h-0 w-full flex-1 gap-3 sm:gap-4">
      {/* ---- 玻璃侧栏:空间树 ---- */}
      <aside className="glass-panel flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/40 px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
            {t('nav.browse')}
          </span>
          <AddSpace parentId={selectedId} />
        </div>
        <div className="pretty-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {tree.length === 0 ? (
            <p className="px-2 py-3 text-[12px] leading-relaxed text-faint">
              {t('browse.emptySpacesHint')}
            </p>
          ) : (
            <TreePane roots={tree} />
          )}
        </div>
      </aside>

      {/* ---- 内容:漂浮在光晕上的卡片 ---- */}
      <section className="pretty-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tree.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="glass-panel material-in flex w-full max-w-md flex-col items-center rounded-3xl px-8 py-10 text-center">
              <h2 className="text-[19px] font-semibold tracking-tight text-ink">
                {t('browse.emptySpacesTitle')}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                {t('browse.emptySpacesHint')}
              </p>

              {/* 路径隐喻锚点:让「空间=文件夹路径」一眼看懂 */}
              <div className="my-6 flex items-center gap-1 rounded-full border border-white/70 bg-white/60 px-3.5 py-1.5 font-mono text-[13px] shadow-[0_1px_2px_rgb(20_40_36_/0.06)]">
                <span className="font-semibold text-accent">~/</span>
                <span className="text-ink">卧室</span>
                <span className="text-faint">/</span>
                <span className="text-muted">衣柜</span>
                <span className="text-faint">/</span>
                <span className="text-muted">上排左格</span>
              </div>

              <AddSpace parentId={null} />
            </div>
          </div>
        ) : !path || !selected ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <span className="glass rounded-full px-5 py-2 text-[13px] text-faint">
              {t('browse.emptySelected')}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-1 py-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Breadcrumbs path={path} />
              <AddSpace parentId={selected.id} />
            </div>

            <div>
              <h3 className="text-[26px] font-semibold tracking-tight text-ink">
                {selected.name}
              </h3>
              <p className="mt-1 text-[12px] text-faint">
                {t('browse.subSpaces')} · {selected.children.length}
              </p>
            </div>

            {selected.children.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/80 bg-white/45 px-5 py-8 text-center text-[13px] text-faint backdrop-blur-md">
                {t('browse.noChildren')}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {selected.children.map((child, i) => (
                  <ChildCard key={child.id} node={child} index={i} onOpen={() => select(child.id)} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function ChildCard({
  node,
  index,
  onOpen,
}: {
  node: SpaceNode
  index: number
  onOpen: () => void
}) {
  return (
    <li className="material-in" style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}>
      <button
        type="button"
        onClick={onOpen}
        className="glass-card lift-card group flex w-full flex-col gap-2.5 rounded-2xl p-3.5 text-left"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <TypeBadge tag={node.type_tag} />
          <span className="font-mono text-[11px] text-faint">{node.children.length}</span>
        </div>
        <span className="flex w-full items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
            {node.name}
          </span>
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="m6 3 5 5-5 5" />
          </svg>
        </span>
      </button>
    </li>
  )
}
