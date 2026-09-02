import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { isZh, setLang } from './i18n'
import Browse from './pages/Browse'

interface Health {
  ok: boolean
  app: string
  schema_version: number
}

function fetchHealth(): Promise<Health> {
  return fetch('/api/health').then((r) => {
    if (!r.ok) throw new Error(`health ${r.status}`)
    return r.json() as Promise<Health>
  })
}

function StatusDot({ ok, pending }: { ok: boolean; pending: boolean }) {
  const cls = pending ? 'bg-faint' : ok ? 'bg-accent' : 'bg-[#c24b3a]'
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
}

export default function App() {
  const { t } = useTranslation()
  const { data, isError, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  })

  const ok = !!data?.ok && !isError

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-[15px] font-medium tracking-tight">
            {t('app.name')}
          </h1>
          <span className="text-[13px] text-faint">{t('app.tagline')}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <StatusDot ok={ok} pending={isPending} />
            {isPending ? t('status.pending') : ok ? t('status.online') : t('status.offline')}
            {ok && (
              <span className="font-mono text-faint">
                {t('status.schemaVersion')} {data!.schema_version}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setLang(isZh() ? 'en' : 'zh-Hans')}
            className="rounded-full border border-line bg-paper px-3 py-1 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {t('nav.langSwitch')}
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <Browse />
      </main>
    </div>
  )
}
