import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { SpaceNode } from '../api/types'
import { useUi } from '../stores/ui'
import AddSpace from '../components/AddSpace'
import TypeIcon from '../components/TypeIcon'

/* 场景卡预览色板:回响看板背景的色相(青绿/琥珀/靛蓝/莓粉)+ 两个调和色。
   每张卡按 id 哈希取色——相邻卡几乎不撞色,整板 = 背景渐变的映射;换个
   设备或加卡也不会乱。duotone = [深色, 亮色]。 */
const SCENE_DUO: Array<[string, string]> = [
  ['#0e7c6b', '#6fc9b0'],
  ['#c17a1f', '#f3d69b'],
  ['#4457a8', '#a0afe8'],
  ['#a1436f', '#efb0c9'],
  ['#3f8a5e', '#a8d3af'],
  ['#2f7fb0', '#a3cdeb'],
]
function duoFor(id: number): [string, string] {
  return SCENE_DUO[(Math.imul(id, 2654435761) >>> 0) % SCENE_DUO.length]
}
/* 子空间 quick-open 小片的类型色点 */
const TYPE_DOT: Record<string, string> = {
  room: '#2e8b84',
  wardrobe: '#4f8f6b',
  drawer: '#5c7fae',
  desk: '#b08a5e',
  shelf: '#9a7ba6',
  box: '#8aa050',
  generic: '#8e9994',
}
function dotColor(tag: string): string {
  return TYPE_DOT[tag] ?? TYPE_DOT.generic
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

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1500px] flex-col px-4 py-4 sm:px-7 sm:py-5">
        {/* 极简台头:唯一非看板元素即品牌与新建 */}
        <header className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[17px] font-semibold text-accent">~/</span>
            <span className="font-mono text-[16px] font-semibold tracking-tight text-ink">
              whereisit
            </span>
          </div>
          {roots.length > 0 && <AddSpace parentId={null} accent />}
        </header>

        <section className="pretty-scroll mt-3 min-h-0 flex-1 overflow-y-auto sm:mt-4">
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
              <div className="material-in flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
                <div>
                  <h2 className="text-[24px] font-semibold tracking-tight text-ink sm:text-[30px]">
                    {t('home.scenesTitle')}
                  </h2>
                  <p className="mt-1 text-[13px] text-muted">{t('home.scenesHint')}</p>
                </div>
                <span className="glass-chip mb-1 inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[12px] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {roots.length}
                </span>
              </div>

              <ul className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
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
  const [a, b] = duoFor(node.id)

  return (
    <li className="material-in flex" style={{ animationDelay: `${Math.min(index * 55, 320)}ms` }}>
      <article
        className="scene-card group flex w-full flex-1 flex-col gap-3 overflow-hidden rounded-[26px] p-3 sm:gap-3.5 sm:p-3.5 min-h-[clamp(250px,36vh,470px)]"
        style={{ '--tint-a': a, '--tint-b': b } as CSSProperties}
      >
        {/* 主体 = 空间预览大图位(占卡内最大面积),点整块即进入 */}
        <button
          type="button"
          onClick={() => openSpace(node.id)}
          className="relative block min-h-[clamp(170px,24vh,320px)] w-full flex-1 overflow-hidden rounded-[20px] text-left"
        >
          {/* 图位底:本卡 duotone 渐变(以后换成真图) */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{ background: `linear-gradient(152deg, ${b} -12%, ${a} 96%)` }}
          />
          {/* 图位玻璃受光,让「照片」有液态高光感 */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(130% 90% at 84% -10%, rgb(255 255 255 / 0.5), transparent 55%), radial-gradient(100% 100% at -6% 108%, rgb(255 255 255 / 0.16), transparent 52%)',
            }}
          />

          {/* 顶栏:类型图标 + 子空间数 */}
          <span
            aria-hidden
            className="absolute left-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/40 bg-white/20 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.5)] backdrop-blur-sm"
          >
            <TypeIcon tag={node.type_tag} />
          </span>
          <span className="absolute right-3 top-3 rounded-full border border-white/40 bg-black/15 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm">
            {kids.length}
          </span>

          {/* 底部压黑 + 名字,保证在彩色图上可读 */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-28 rounded-b-[20px] bg-gradient-to-t from-black/45 to-transparent"
          />
          <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3.5">
            <span className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.45)] sm:text-[19px]">
              {node.name}
            </span>
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white/30 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m6 3 5 5-5 5" />
              </svg>
            </span>
          </span>
        </button>

        {/* 底部:子空间快速直达片(不进次级也可一键到下级) */}
        {kids.length > 0 ? (
          <div className="flex min-h-0 flex-wrap gap-1.5">
            {kids.slice(0, 8).map((child) => (
              <ChildChip key={child.id} node={child} />
            ))}
            {kids.length > 8 && (
              <button
                type="button"
                onClick={() => openSpace(node.id)}
                className="glass-chip pressable inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] text-muted hover:text-accent"
              >
                +{kids.length - 8}
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openSpace(node.id)}
            className="pressable flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/80 bg-white/40 px-3 py-2.5 text-[12px] text-muted hover:text-accent"
          >
            {t('browse.noChildren')}
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="m6 3 5 5-5 5" />
            </svg>
          </button>
        )}
      </article>
    </li>
  )
}

function ChildChip({ node }: { node: SpaceNode }) {
  const openSpace = useUi((s) => s.openSpace)
  const c = dotColor(node.type_tag)
  return (
    <button
      type="button"
      onClick={() => openSpace(node.id)}
      className="glass-chip pressable inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] text-ink hover:-translate-y-px"
      style={{ borderColor: `${c}99` }}
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
    <div className="flex h-full items-center justify-center p-2">
      <div className="material-in glass flex w-full max-w-lg flex-col items-center rounded-[28px] px-8 py-10 text-center sm:px-10">
        <h2 className="text-[20px] font-semibold tracking-tight text-ink">
          {t('browse.emptySpacesTitle')}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('browse.emptySpacesHint')}</p>

        <div className="my-6 flex items-center gap-1 rounded-full border border-white/70 bg-white/70 px-3.5 py-1.5 font-mono text-[13px] shadow-[0_1px_2px_rgb(20_40_36/0.06)]">
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
