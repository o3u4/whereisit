import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { isZh, setLang } from '../i18n'

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
  const cls = pending ? 'bg-faint' : ok ? 'bg-accent' : 'bg-danger'
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
}

export default function TopBar() {
  const { t } = useTranslation()
  const { data, isError, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  })

  const ok = !!data?.ok && !isError

  return (
    <header className="glass flex shrink-0 items-center justify-between gap-3 rounded-[22px] px-4 py-2.5 sm:px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="flex items-baseline gap-1 font-mono text-[16px] font-semibold tracking-tight">
          <span className="text-accent">~/</span>
          <span>whereisit</span>
        </h1>
        <span className="hidden truncate text-[12px] text-faint sm:inline">{t('app.tagline')}</span>
      </div>
      <div className="flex shrink-0 items-center gap-4">
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
          className="glass-chip pressable rounded-full px-3 py-1 text-[12px] text-muted hover:text-accent"
        >
          {t('nav.langSwitch')}
        </button>
      </div>
    </header>
  )
}
