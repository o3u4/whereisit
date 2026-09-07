import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Hub from './pages/Hub'
import Browse from './pages/Browse'
import Record from './pages/Record'
import { useCatalog } from './stores/catalog'
import { useAuth } from './stores/auth'
import { useTr } from './i18n'
import * as api from './api/client'
import { SearchOverlay } from './components/SearchOverlay'

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t)
    return true
  } catch {
    return false
  }
}

/** whereisit · three-screen IA: 中枢 (/) → 目录 (/browse?at=) → 登记 (/record?at=|move=) */
export default function App() {
  const load = useCatalog((s) => s.load)
  const unauthorized = useAuth((s) => s.unauthorized)

  useEffect(() => {
    load()
  }, [load])

  if (unauthorized) return <TokenGate onUnlock={() => void load()} />
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/record" element={<Record />} />
        <Route path="*" element={<Hub />} />
      </Routes>
      <SearchOverlay />
    </BrowserRouter>
  )
}

/** full-screen gate shown when a guarded /api call returns 401 without a token */
function TokenGate({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTr()
  const setToken = useAuth((s) => s.setToken)
  const clearToken = useAuth((s) => s.clearToken)
  const [v, setV] = useState('')
  const [policy, setPolicy] = useState<'auto' | 'manual' | null>(null)
  const [regName, setRegName] = useState('')
  const [regToken, setRegToken] = useState<api.CreatedUser | null>(null)
  const [regBusy, setRegBusy] = useState(false)
  const [regErr, setRegErr] = useState('')

  useEffect(() => {
    api.fetchRegisterPolicy().then(setPolicy).catch(() => setPolicy('manual'))
  }, [])

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setV((await file.text()).trim())
  }

  const doRegister = async () => {
    const n = regName.trim()
    if (!n || regBusy) return
    setRegBusy(true)
    setRegErr('')
    try {
      setRegToken(await api.registerSelf(n))
    } catch (err) {
      setRegErr(err instanceof Error ? err.message : String(err))
    } finally {
      setRegBusy(false)
    }
  }

  return (
    <div className="tone-hub">
      <div className="wall" aria-hidden="true">
        <i className="blob b1" /><i className="blob b2" /><i className="blob b3" /><i className="blob b4" />
      </div>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="glass-card panel" style={{ width: 'min(420px, 100%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <b style={{ fontSize: 18 }}>{t('gate.title')}</b>
          <p className="t-sm t-muted" style={{ margin: 0 }}>{t('gate.msg')}</p>
          <input
            className="field"
            type="password"
            autoComplete="off"
            placeholder={t('gate.ph')}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && v.trim()) { setToken(v.trim()); onUnlock(); }
            }}
          />
          <label htmlFor="tokfile" className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }}>
            {t('gate.import')}
          </label>
          <input
            id="tokfile"
            type="file"
            accept=".token,.json,text/plain,application/json"
            style={{ display: 'none' }}
            onChange={(e) => void importFile(e)}
          />
          <div className="rowline gap8">
            <button
              type="button"
              className="btn btn--primary"
              style={{ flex: 1 }}
              disabled={!v.trim()}
              onClick={() => { setToken(v.trim()); onUnlock(); }}
            >
              {t('gate.submit')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={clearToken}>
              {t('app.cancel')}
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgb(255 255 255/0.6)', margin: '4px 0' }} />
          {policy === 'manual' ? (
            <p className="t-sm t-muted" style={{ margin: 0 }}>{t('gate.manualHint')}</p>
          ) : regToken ? (
            <div className="col gap6">
              <p className="t-sm t-muted" style={{ margin: 0 }}>{t('gate.regDone')}</p>
              <code
                className="t-mono t-sm"
                style={{ wordBreak: 'break-all', background: 'rgb(255 255 255/0.6)', border: '1px solid var(--border)', borderRadius: 12, padding: '9px 12px' }}
              >
                {regToken.token}
              </code>
              <div className="rowline gap8">
                <button
                  type="button"
                  className="btn btn--soft btn--sm"
                  onClick={() => { void copyText(regToken.token) }}
                >
                  {t('set.copy')}
                </button>
                <button
                  type="button"
                  className="btn btn--soft btn--sm"
                  onClick={() => downloadText(`${regToken.username}.token`, regToken.token + '\n')}
                >
                  {t('set.download')}
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => { setToken(regToken.token); onUnlock(); }}
                >
                  {t('gate.enter')}
                </button>
              </div>
            </div>
          ) : (
            <div className="col gap6">
              <p className="t-sm t-muted" style={{ margin: 0 }}>{t('gate.signupHint')}</p>
              <div className="rowline gap8">
                <input
                  className="field"
                  placeholder={t('gate.regPh')}
                  value={regName}
                  autoComplete="off"
                  onChange={(e) => setRegName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && regName.trim()) void doRegister()
                  }}
                />
                <button
                  type="button"
                  className="btn btn--soft btn--sm"
                  disabled={!regName.trim() || regBusy}
                  onClick={() => void doRegister()}
                >
                  {regBusy ? t('gate.regBusy') : t('gate.getToken')}
                </button>
              </div>
              {regErr ? <p className="t-sm" style={{ margin: 0, color: 'var(--danger)' }}>{regErr}</p> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}