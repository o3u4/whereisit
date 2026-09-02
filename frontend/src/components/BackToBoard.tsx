import { useTranslation } from 'react-i18next'
import { useUi } from '../stores/ui'

export default function BackToBoard() {
  const { t } = useTranslation()
  const goBoard = useUi((s) => s.goBoard)
  return (
    <button
      type="button"
      onClick={goBoard}
      className="pressable fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border border-white/50 bg-white/75 px-3.5 py-2 text-[12.5px] font-medium text-ink shadow-[0_10px_26px_-10px_rgb(20_50_44/0.4)] backdrop-blur-md hover:text-accent"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-accent"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 11 12 5l8 6M6.5 9.5V19h11V9.5M9 19v-5h6v5" />
      </svg>
      {t('home.scenesTitle')}
    </button>
  )
}
