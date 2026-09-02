import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { SpaceNode } from '../api/types'
import { useUi } from '../stores/ui'
import AddSpace from '../components/AddSpace'
import TypeIcon from '../components/TypeIcon'

/* 每类空间一组双色(tint-a → tint-b),看板因此彩色而不单调 */
const TINTS: Record<string, [string, string]> = {
  room: ['#2e8b84', '#7ec9b4'],
  wardrobe: ['#3f7d5a', '#9fc98f'],
  desk: ['#b0893f', '#e3c58f'],
  drawer: ['#4f6fae', '#9bb6e2'],
  shelf: ['#8f6fae', '#c9a8dd'],
  box: ['#7f9c4a', '#c6d98f'],
  generic: ['#5f7f94', '#a3c3d6'],
}
function tints(tag: string): [string, string] {
  return TINTS[tag] ?? TINTS.generic
}

export default function Board() {
  const { t } = useTranslation()
  const { data: roots = [], isLoading, isError } = useQuery({
    queryKey: ['spaces', 'tree'],
    queryFn: api.tree,
  })

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <div className="board-bg" aria-hidden>
        <i className="blob2 bz-teal" />
        <i className="blob2 bz-amber" />
        <i className="blob2 bz-indigo" />
        <i className="blob2 bz-plum" />
      </div>

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1280px] flex-col px-4 py-4 sm:px-6 sm:py-5">
        {/* 极简台头:唯一非看板元素即品牌与新建 */}
        <header className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[16px] font-semibold text-accent">~/</span>
            <span className="font-mono text-[15px] font-semibold tracking-tight text-ink">
              whereisit
            </span>
          </div>
          {roots.length > 0 && <AddSpace parentId={null} accent />}
        </header>

        <section className="pretty-scroll mt-4 min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-[13px] text-faint">…</div>
          ) : isError ? (
            <div className="flex h-full items-center justify-center text-[13px] text-danger">
              {t('status.offline')}
            </div>
          ) : roots.length === 0 ? (
            <EmptyBoard />
          ) : (
            <>
              <div className="material-in">
                <h2 className="text-[32px] font-semibold tracking-tight text-ink">
                  {t('home.scenesTitle')}
                </h2>
                <p className="mt-1 text-[13px] text-muted">{t('home.scenesHint')}</p>
              </div>

              <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {roots.map((root, i) => (
                  <SceneCard key={root.id} node={root} index={i} />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function SceneCard({ node, index }: { node: SpaceNode; index: number }) {
  const { t } = useTranslation()
  const openSpace = useUi((s) => s.openSpace)
  const kids = node.children
  const [a, b] = tints(node.type_tag)

  return (
    <li className="material-in" style={{ animationDelay: `${Math.min(index * 45, 260)}ms` }}>
      <article
        className="scene-card group flex h-full min-h-[236px] flex-col overflow-hidden rounded-[22px]"
        style={{ '--tint-a': a, '--tint-b': b } as CSSProperties}
      >
        {/* 彩色横幅:类型图标 + 子空间数 */}
        <button
          type="button"
          onClick={() => openSpace(node.id)}
          className="relative block h-[96px] w-full shrink-0 overflow-hidden text-left"
        >
          <span className="scene-banner absolute inset-0" aria-hidden />
          <span
            className="absolute right-3 top-3 rounded-full border border-white/45 bg-white/20 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm"
            aria-hidden
          >
            {kids.length}
          </span>
          <span className="absolute inset-0 flex items-start p-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-white/25 text-white backdrop-blur-sm">
              <TypeIcon tag={node.type_tag} />
            </span>
          </span>
        </button>

        {/* 主体:场景名 + 子空间彩色小片 */}
        <div className="flex min-h-0 flex-1 flex-col p-3 pt-2.5">
          <button
            type="button"
            onClick={() => openSpace(node.id)}
            className="pressable flex items-center justify-between gap-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight text-ink">
              {node.name}
            </span>
            <svg
              viewBox="0 0 16 16"
              className="h-4 w-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="m6 3 5 5-5 5" />
            </svg>
          </button>

          {kids.length > 0 ? (
            <div className="pretty-scroll mt-2 flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto">
              {kids.slice(0, 8).map((child) => (
                <ChildChip key={child.id} node={child} />
              ))}
              {kids.length > 8 && (
                <button
                  type="button"
                  onClick={() => openSpace(node.id)}
                  className="rounded-lg border border-white/70 bg-white/70 px-2 py-1 text-[11.5px] text-faint hover:text-accent"
                >
                  +{kids.length - 8}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openSpace(node.id)}
              className="pressable mt-2 flex min-h-0 flex-1 items-center justify-center gap-1 rounded-xl border border-dashed border-white/80 bg-white/40 px-2 text-[11.5px] text-faint hover:text-accent"
            >
              {t('browse.noChildren')}
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="m6 3 5 5-5 5" />
              </svg>
            </button>
          )}
        </div>
      </article>
    </li>
  )
}

function ChildChip({ node }: { node: SpaceNode }) {
  const openSpace = useUi((s) => s.openSpace)
  const c = tints(node.type_tag)[0]
  return (
    <button
      type="button"
      onClick={() => openSpace(node.id)}
      className="pressable inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] text-ink hover:-translate-y-px"
      style={{ background: `${c}26`, borderColor: `${c}55` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} />
      <span className="truncate">{node.name}</span>
      {node.children.length > 0 && (
        <span className="shrink-0 font-mono text-[10px] opacity-60">{node.children.length}</span>
      )}
    </button>
  )
}

function EmptyBoard() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="material-in flex w-full max-w-md flex-col items-center rounded-3xl border border-white/80 bg-white/70 px-8 py-10 text-center backdrop-blur-xl">
        <h2 className="text-[20px] font-semibold tracking-tight text-ink">
          {t('browse.emptySpacesTitle')}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('browse.emptySpacesHint')}</p>

        <div className="my-6 flex items-center gap-1 rounded-full border border-white/70 bg-white/70 px-3.5 py-1.5 font-mono text-[13px] shadow-[0_1px_2px_rgb(20_40_36_/0.06)]">
          <span className="font-semibold text-accent">~/</span>
          <span className="text-ink">卧室</span>
          <span className="text-faint">/</span>
          <span className="text-muted">衣柜</span>
          <span className="text-faint">/</span>
          <span className="text-muted">上排左格</span>
        </div>

        <AddSpace parentId={null} accent />
      </div>
    </div>
  )
}
