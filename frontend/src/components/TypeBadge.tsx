import { useTranslation } from 'react-i18next'

/* 每类空间一个低饱和色点,让人群一眼分型。 */
const TYPE_TINTS: Record<string, string> = {
  room: '#2e8b84',
  wardrobe: '#4f8f6b',
  drawer: '#5c7fae',
  desk: '#b08a5e',
  shelf: '#9a7ba6',
  box: '#8aa050',
  generic: '#8e9994',
}

export default function TypeBadge({ tag, dotOnly = false }: { tag: string; dotOnly?: boolean }) {
  const { t } = useTranslation()
  const tint = TYPE_TINTS[tag] ?? TYPE_TINTS.generic

  if (dotOnly) {
    return (
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: tint }}
      />
    )
  }

  return (
    <span className="glass-chip inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] text-muted">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: tint }} />
      {t(`type.${tag}`, { defaultValue: tag })}
    </span>
  )
}
