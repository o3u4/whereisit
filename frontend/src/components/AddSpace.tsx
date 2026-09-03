import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { useUi } from '../stores/ui'
import { useQueryClient } from '@tanstack/react-query'

const TYPE_TAGS = ['generic', 'room', 'wardrobe', 'desk', 'drawer', 'shelf', 'box'] as const

export default function AddSpace({ parentId, accent = false }: { parentId: number | null; accent?: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const select = useUi((s) => s.select)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [tag, setTag] = useState<string>('generic')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.createSpace({ parent_id: parentId, name: trimmed, type_tag: tag })
      setName('')
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['spaces'] })
      // 顶级场景(看板 CTA)建完留在看板看新卡浮现;子空间建完进到该空间继续铺
      if (parentId != null) select(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          accent
            ? 'pressable inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/40 bg-accent px-3.5 py-1.5 text-[12px] font-medium text-accent-ink shadow-[0_6px_16px_-6px_rgb(46_110_104/0.6)] hover:bg-accent/90'
            : 'glass-chip pressable inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12px] text-muted hover:text-accent'
        }
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M8 3v10M3 8h10" />
        </svg>
        {accent ? t('home.newScene') : t('browse.newSpace')}
      </button>
    )
  }

  return (
    <div className="glass-card material-in flex flex-col gap-2 rounded-[20px] p-3">
      <label className="flex flex-col gap-1 text-[11px] text-muted">
        {t('browse.name')}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('browse.namePlaceholder')}
          className="rounded-lg border border-white/70 bg-white/55 px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {TYPE_TAGS.map((tagId) => (
          <button
            key={tagId}
            type="button"
            onClick={() => setTag(tagId)}
            className={
              tag === tagId
                ? 'rounded-full border border-white/30 bg-accent px-2 py-0.5 text-[11px] text-accent-ink'
                : 'glass-chip pressable rounded-full px-2 py-0.5 text-[11px] text-muted hover:text-accent'
            }
          >
            {t(`type.${tagId}`)}
          </button>
        ))}
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full px-3 py-1 text-[12px] text-muted hover:text-ink"
        >
          {t('browse.cancel')}
        </button>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={submit}
          className="pressable rounded-full bg-ink px-3 py-1 text-[12px] text-paper disabled:opacity-40"
        >
          {t('browse.create')}
        </button>
      </div>
    </div>
  )
}
