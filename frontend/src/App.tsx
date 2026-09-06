import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Hub from './pages/Hub'
import Browse from './pages/Browse'
import Record from './pages/Record'
import { useCatalog } from './stores/catalog'
import { useAuth } from './stores/auth'
import { useTr } from './i18n'

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
    </BrowserRouter>
  )
}

/** full-screen gate shown when a guarded /api call returns 401 without a token */
function TokenGate({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTr()
  const setToken = useAuth((s) => s.setToken)
  const clearToken = useAuth((s) => s.clearToken)
  const [v, setV] = useState('')

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
        </div>
      </div>
    </div>
  )
}