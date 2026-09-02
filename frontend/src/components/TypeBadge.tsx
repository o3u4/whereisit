import { useTranslation } from 'react-i18next'

export default function TypeBadge({ tag }: { tag: string }) {
  const { t } = useTranslation()
  return (
    <span className="shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] leading-4 text-muted">
      {t(`type.${tag}`, { defaultValue: tag })}
    </span>
  )
}
