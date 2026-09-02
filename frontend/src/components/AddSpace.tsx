import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { useUi } from '../stores/ui'
import { useQueryClient } from '@tanstack/react-query'

const TYPE_TAGS = ['generic', 'room', 'wardrobe', 'desk', 'drawer', 'shelf', 'box'] as const

export default function AddSpace({ parentId }: { parentId: number | null }) {
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
      select(created.id)
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
        className="flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M8 3v10M3 8h10" />
        </svg>
        {t('browse.newSpace')}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-3 shadow-sm">
      <label className="flex flex-col gap-1 text-[11px] text-muted">
        {t('browse.name')}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('browse.namePlaceholder')}
          className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {TYPE_TAGS.map((tagId) => (
          <button
            key={tagId}
            type="button"
            onClick={() => setTag(tagId)}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              tag === tagId
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line text-muted hover:border-accent hover:text-accent'
            }`}
          >
            {t(`type.${tagId}`)}
          </button>
        ))}
      </div>
      {error && <p className="text-[12px] text-[#b3452f]">{error}</p>}
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
          className="rounded-full bg-ink px-3 py-1 text-[12px] text-paper transition-opacity disabled:opacity-40"
        >
          {t('browse.create')}
        </button>
      </div>
    </div>
  )
}
