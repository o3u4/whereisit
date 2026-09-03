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
  const goBoard = useUi((s) => s.goBoard)

  const path = selectedId != null ? findPath(tree, selectedId) : null
  const selected = path ? path[path.length - 1] : null

  // 浏览页总得有落脚点:没有选中时自动落到第一个场景(看板入口保证几乎不发生)
  useEffect(() => {
    if (selectedId == null && tree.length > 0) select(tree[0].id)
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

  if (tree.length === 0)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-[13px] text-faint">{t('browse.emptySpacesHint')}</p>
        <button
          type="button"
          onClick={goBoard}
          className="pressable rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-accent-ink"
        >
          {t('home.scenesTitle')}
        </button>
      </div>
    )

  if (!path || !selected)
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-[13px] text-faint">
        …
      </div>
    )

  return (
    <div className="flex min-h-0 w-full flex-1 gap-3 sm:gap-4">
      {/* ---- 玻璃侧栏:空间树 ---- */}
      <aside className="glass-panel flex w-72 shrink-0 flex-col overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between gap-2 border-b border-white/40 px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
            {t('nav.browse')}
          </span>
          <AddSpace parentId={selected.id} />
        </div>
        <div className="pretty-scroll min-h-0 flex-1 overflow-y-auto p-2">
          <TreePane roots={tree} />
        </div>
      </aside>

      {/* ---- 选中空间详情:路径 + 子空间漂浮卡 ---- */}
      <section className="pretty-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-5 px-1 py-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Breadcrumbs path={path} />
            <AddSpace parentId={selected.id} />
          </div>

          <div>
            <h3 className="text-[26px] font-semibold tracking-tight text-ink">{selected.name}</h3>
            <p className="mt-1 text-[12px] text-faint">
              {t('browse.subSpaces')} · {selected.children.length}
            </p>
          </div>

          {selected.children.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/80 bg-white/45 px-5 py-8 text-center text-[13px] text-muted backdrop-blur-md">
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
        className="glass-card lift-card group flex w-full flex-col gap-2.5 rounded-[20px] p-3.5 text-left"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <TypeBadge tag={node.type_tag} />
          <span className="font-mono text-[11px] text-muted">{node.children.length}</span>
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
