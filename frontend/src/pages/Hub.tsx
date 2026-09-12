/*
 * whereisit · 中枢 (hub) — one-line search entry + recent + scene catalog.
 * Ports screens/home.html: hero ⌘K search, spotlight overlay, settings / exist /
 * item sheets, wide split mode (search left + detail right), mobile tab bar.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../api/client';
import { useMedia } from '../hooks/useMedia';
import { NewPathSheet } from '../components/NewPathSheet';
import { Icon, CDot, TYPE_ICON, type IconName } from '../components/icons';
import { Wordmark, Seg, Switch, Sheet, StatusBadge, Kbd, ToastsHost } from '../components/ui';
import { TabBar, TabLink, TabAction } from '../components/TabBar';
import { TYPE_TINT } from '../lib/meta';
import { countItemsIn, frequentItemNames, pathNames, scenesFromTree } from '../lib/tree';
import type { DirNode, Item, RecentEntry, Scene } from '../lib/types';
import { useCatalog } from '../stores/catalog';
import { useAuth } from '../stores/auth';
import { useOverlay } from '../stores/overlay';
import { useFreq } from '../stores/freq';
import { useTheme } from '../stores/theme';
import { useToast } from '../stores/toast';
import { useTr } from '../i18n';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

const LLM_VENDORS = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', tint: '#1b7ff0' },
  { id: 'glm', name: 'GLM', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6v-flash', tint: '#3b7cff' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', tint: '#10a37f' },
  { id: 'claude', name: 'Claude', url: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022', tint: '#d97757' },
];

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SceneCard({ sc, i }: { sc: Scene; i: number }) {
  const { fmt } = useTr();
  const tree = useCatalog((s) => s.tree);
  const items = useCatalog((s) => s.items);
  const { url, hasImage } = useMedia('space', Number(sc.slug), true);
  const kids = sc.kids;
  return (
    <article className={`scene-card in d${(i % 3) + 2}`} style={V({ ['--tint-a']: sc.tintA, ['--tint-b']: sc.tintB })}>
      <Link className="scene-cover" to={`/browse?at=${sc.slug}`} aria-label={fmt('hub.enter', { name: sc.name })}>
        {hasImage && url ? (
          <img className="scene-cover-img" src={url} alt={sc.name} />
        ) : (
          <span className="icon-tile">
            <Icon name={TYPE_ICON[sc.type]} />
          </span>
        )}
        <span className="scrim" aria-hidden="true" />
        <span className="title">
          <b>{sc.name}</b>
          {sc.parent ? <span className="nchip">{sc.parent}</span> : null}
        </span>
      </Link>
      <div className="scene-body">
        <Link className="between scene-goto" to={`/browse?at=${sc.slug}`} aria-label={fmt('hub.enter', { name: sc.name })}>
          <span className="t-xs t-muted">
            {fmt('hub.sceneMeta', { kids: kids.length, items: countItemsIn(tree, items, sc.slug) })}
          </span>
          <Icon name="chev" size={15} style={V({ color: 'var(--faint)' })} />
        </Link>
        <div className="scene-subchips">
          {kids.map((k) => (
            <Link
              key={k.id}
              className="glass-chip chip-sub"
              to={`/browse?at=${k.id}`}
              aria-label={fmt('hub.enter', { name: k.name })}
            >
              <CDot color={TYPE_TINT[k.type]} />
              {k.name}
            </Link>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function Hub() {
  const navigate = useNavigate();
  const { t, fmt } = useTr();
  const tree = useCatalog((s) => s.tree);
  const items = useCatalog((s) => s.items);
  const recent = useCatalog((s) => s.recent);
  const setReveal = useCatalog((s) => s.setReveal);
  const toast = useToast((s) => s.push);
  const openSpot = useOverlay((s) => s.openSpot);

  /* recent handling row → jump to that item's spot in browse & open its detail */
  const openRecent = (r: RecentEntry) => {
    if (r.slug && r.spot) {
      setReveal(r.slug);
      navigate(`/browse?at=${r.spot}`);
    } else {
      toast(fmt('hub.locating', { name: r.name }));
    }
  };

  const [existOpen, setExistOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [npsOpen, setNpsOpen] = useState(false);

  /* Esc closes the modal sheets (spotlight + item detail close via global overlay) */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (existOpen) setExistOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (catOpen) setCatOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [existOpen, settingsOpen, catOpen]);

  const scenes = useMemo(() => scenesFromTree(tree), [tree]);

  const freqTick = useFreq((s) => s.tick);
  const QUICK = useMemo(() => frequentItemNames(items), [items, freqTick]);

  return (
    <div className="tone-hub">
      <div className="wall" aria-hidden="true">
        <i className="blob b1" />
        <i className="blob b2" />
        <i className="blob b3" />
        <i className="blob b4" />
      </div>

      <div className="shell">
        <div className="wrap">
          <header className="topglass glass in">
            <Wordmark />
            <div className="hd-group">
              <button type="button" className="ibtn" aria-label={t('nav.settings')} onClick={() => setSettingsOpen(true)}>
                <Icon name="sliders" />
              </button>
              <Link className="btn btn--primary btn--sm hide-mobile" to="/record">
                <Icon name="plus" size={16} />{t('nav.record')}
              </Link>
            </div>
          </header>

          <main>
            <section className="hero in d1">
              <p className="section-kicker">{t('hub.kicker')}</p>
              <h1>{t('hub.title')}</h1>
              <p className="lead">{t('hub.sub')}</p>
              <button type="button" className="hero-search" aria-haspopup="dialog" onClick={() => openSpot()}>
                <Icon name="search" className="mag" />
                <span className="ph">{t('hub.searchPh')}</span>
                <span className="hint">
                  <Kbd>⌘ K</Kbd>
                </span>
              </button>
              <div className="quick" aria-label="我常找">
                <span
                  className="chip"
                  style={V({
                    pointerEvents: 'none',
                    background: 'transparent',
                    borderColor: 'transparent',
                    color: 'var(--faint)',
                    fontWeight: '600',
                  })}
                >
                  {t('hub.frequent')}
                </span>
                {QUICK.map((k) => (
                  <button key={k} type="button" className="chip chip--glass" onClick={() => openSpot(k)}>
                    {k}
                  </button>
                ))}
                <span className="chip" aria-hidden="true" />
                <button
                  type="button"
                  className="chip chip--glass"
                  style={V({ color: 'var(--accent)' })}
                  onClick={() => setExistOpen(true)}
                >
                  <Icon name="locate" size={14} />
                  {t('hub.exist')}
                </button>
              </div>
            </section>

            <div className="hub-sections">
              {recent.length > 0 ? (
              <section aria-labelledby="recentTitle">
                <div className="section-head">
                  <div>
                    <h2 className="st" id="recentTitle">
                      {t('hub.recentTitle')}
                    </h2>
                  </div>
                  <span className="t-xs t-muted mono-path">LAST · {recent.length}</span>
                </div>
                <div className="card-stack">
                  {recent.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="glass-card item-row hover-lift"
                      onClick={() => openRecent(r)}
                    >
                      <span className="glyph" style={V({ ['--tc']: 'var(--accent)' })}>
                        <Icon name={r.icon as IconName} />
                      </span>
                      <span className="ir-main">
                        <span className="rowline gap8">
                          <b>{r.name}</b>
                          <StatusBadge cls={r.tone === 'accent' ? 'present' : r.tone} label={r.verb} />
                        </span>
                        <span className="ir-sub">
                          <span className="mono-path">~/ {r.sub}</span>
                        </span>
                      </span>
                      <span className="ir-right">
                        <span className="t-xs t-faint">{r.time}</span>
                        <Icon name="chev" size={16} style={V({ color: 'var(--faint)' })} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              ) : null}

              <section aria-labelledby="sceneTitle">
                <div className="section-head">
                  <div>
                    <h2 className="st" id="sceneTitle">
                      {t('hub.sceneTitle')}
                    </h2>
                    <p className="t-sm t-muted mt8">
                      {t('hub.sceneHint')}
                    </p>
                  </div>
                  <Link className="link" to="/browse">
                    {t('hub.scenes')} <Icon name="chev" size={13} style={V({ display: 'inline-block', verticalAlign: '-1px' })} />
                  </Link>
                </div>
                {scenes.length === 0 ? (
                  <div className="glass-card brw-empty">
                    <Icon name="plus" />
                    <b>{t('new.emptyTitle')}</b>
                    <p>{t('new.emptyHint')}</p>
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => setNpsOpen(true)}>
                      {t('new.emptyCta')}
                    </button>
                  </div>
                ) : (
                  <div className="grid-scenes">
                    {scenes.map((sc, i) => (
                      <SceneCard key={sc.slug} sc={sc} i={i} />
                    ))}
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>

        <TabBar>
          <TabLink to="/" icon="home" label={t('nav.hub')} current />
          <TabLink to="/browse" icon="dir" label={t('nav.browse')} />
          <TabLink to="/record" icon="plus" label={t('nav.recordPill')} pill />
          <TabAction icon="search" label={t('nav.search')} onClick={() => openSpot()} />
          <TabAction icon="sliders" label={t('nav.settings')} onClick={() => setSettingsOpen(true)} />
        </TabBar>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onManageCategories={() => {
          setSettingsOpen(false);
          setCatOpen(true);
        }}
      />
      <CategorySheet open={catOpen} onClose={() => setCatOpen(false)} />
      <ExistSheet open={existOpen} onClose={() => setExistOpen(false)} onOpenItem={(slug) => useOverlay.getState().openItem(slug)} />
      <NewPathSheet
        open={npsOpen}
        onClose={() => setNpsOpen(false)}
        basePathNames={[]}
        onCreated={(id) => {
          setNpsOpen(false);
          navigate(`/browse?at=${id}`);
        }}
      />
      <ToastsHost />
    </div>
  );
}

/* ------------------------------------------------ settings --------------- */
function SettingsSheet({
  open,
  onClose,
  onManageCategories,
}: {
  open: boolean;
  onClose: () => void;
  onManageCategories: () => void;
}) {
  const toast = useToast((s) => s.push);
  const reload = useCatalog((s) => s.load);
  const { t, fmt, setLang } = useTr();
  const [s, setS] = useState<api.SettingsDTO | null>(null);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [users, setUsers] = useState<api.AdminUser[]>([]);
  const [newName, setNewName] = useState('');
  const [justCreated, setJustCreated] = useState<api.CreatedUser | null>(null);
  const [llmUrl, setLlmUrl] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmKey, setLlmKey] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCurrentToken(null);
    api
      .fetchSettings()
      .then((d) => {
        setS(d);
        setLlmUrl(d.llm_base_url);
        setLlmModel(d.llm_model);
      })
      .catch(() => setS(null));
    setLlmKey('');
    api
      .fetchAccessToken()
      .then(({ token }) => setCurrentToken(token))
      .catch(() => setCurrentToken(null));
  }, [open]);

  const setLangPref = async (l: 'zh' | 'en') => {
    setLang(l); // apply immediately (client preference)
    try {
      await api.saveSettings({ lang: l });
      setS((p) => (p ? { ...p, lang: l } : p));
    } catch {
      /* server write is best-effort */
    }
  };

  const setThemePref = async (th: 'apple' | 'flat' | 'pixel') => {
    useTheme.getState().setTheme(th); // apply + persist locally immediately
    try {
      setS(await api.saveSettings({ theme: th }));
    } catch {
      /* local theme still applies */
    }
  };

  const saveLlm = async () => {
    try {
      const patch: Record<string, string> = { llm_base_url: llmUrl, llm_model: llmModel };
      if (llmKey.trim()) patch.llm_api_key = llmKey; // blank = keep current, never clears
      setS(await api.saveSettings(patch));
      setLlmKey('');
      toast(t('llm.saved'));
    } catch {
      toast(t('llm.saveFail'));
    }
  };

  const clearLlmKey = async () => {
    if (!window.confirm(t('llm.clearKeyQ'))) return;
    try {
      setS(await api.saveSettings({ llm_api_key: '' }));
      toast(t('llm.saved'));
    } catch {
      toast(t('llm.saveFail'));
    }
  };

  const copyLan = async () => {
    if (!s) return;
    try {
      await navigator.clipboard.writeText(`http://${s.lan_url}`);
      toast(t('set.copied'));
    } catch {
      toast(t('set.copyFail'));
    }
  };

  const toggleToken = async (onTok: boolean) => {
    try {
      if (onTok) {
        const { token } = await api.createAccessToken();
        // keep the current session unlocked (the token is for other LAN devices too)
        useAuth.getState().setToken(token);
        setCurrentToken(token);
        setS((p) => (p ? { ...p, token_enabled: true } : p));
      } else {
        // revoke first while the browser still holds the token; clearing the
        // local copy beforehand strips the auth header → 401 → the token gate
        // pops up and protection never actually turns off.
        await api.revokeAccessToken();
        useAuth.getState().clearToken();
        setCurrentToken(null);
        setS((p) => (p ? { ...p, token_enabled: false } : p));
      }
    } catch {
      toast(t('set.tokenFail'));
    }
  };

  const copyToken = async (tk: string) => {
    try {
      await navigator.clipboard.writeText(tk);
      toast(t('set.copied'));
    } catch {
      toast(t('set.copyFail'));
    }
  };

  const replaceToken = async () => {
    try {
      const { token } = await api.replaceAccessToken();
      useAuth.getState().setToken(token);
      setCurrentToken(token);
      toast(t('set.tokenReplaced'));
    } catch {
      toast(t('set.tokenFail'));
    }
  };

  useEffect(() => {
    if (!open || !s?.is_admin) {
      setUsers([]);
      return;
    }
    api.fetchUsers().then(setUsers).catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, s?.is_admin]);

  const doCreateUser = async () => {
    const n = newName.trim();
    if (!n) return;
    try {
      const created = await api.createUser(n);
      setJustCreated(created);
      setNewName('');
      api.fetchUsers().then(setUsers).catch(() => undefined);
      toast(fmt('usr.created', { name: n }));
    } catch {
      toast(t('set.tokenFail'));
    }
  };

  const userReplaceToken = async (u: api.AdminUser) => {
    try {
      await api.replaceUserToken(u.id);
      toast(t('set.tokenReplaced'));
    } catch {
      toast(t('set.tokenFail'));
    }
  };

  const userRevokeToken = async (u: api.AdminUser) => {
    try {
      await api.revokeUserToken(u.id);
      toast(t('usr.revokeToken'));
    } catch {
      toast(t('set.tokenFail'));
    }
  };

  const userDelete = async (u: api.AdminUser) => {
    if (!window.confirm(t('usr.deleteQ'))) return;
    try {
      await api.deleteUser(u.id);
      setUsers((p) => p.filter((x) => x.id !== u.id));
      if (justCreated?.id === u.id) setJustCreated(null);
    } catch {
      toast(t('set.tokenFail'));
    }
  };

  const setRegistration = async (r: 'auto' | 'manual') => {
    try {
      setS(await api.saveSettings({ registration: r }));
    } catch {
      toast(t('set.tokenFail'));
    }
  };

  const logout = () => {
    if (!window.confirm(t('set.logoutQ'))) return;
    useAuth.getState().clearToken();
    window.location.reload();
  };

  const doExport = async () => {
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whereisit-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast(t('set.exportFail'));
    }
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text) as Record<string, unknown>;
      if (!window.confirm(t('set.importWarn'))) return;
      const counts = await api.importData(obj);
      toast(
        fmt('set.importDone', {
          spaces: counts.spaces_inserted ?? 0,
          defs: counts.defs_inserted ?? 0,
          lots: counts.lots_inserted ?? 0,
        }),
      );
      reload();
    } catch (err) {
      toast(fmt('set.importFail', { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <Sheet open={open} onClose={onClose} side="right" title={t('set.title')}>
      {s?.username ? (
        <div className="rowline between" style={{ gap: 8 }}>
          <span className="t-sm t-muted ellip">{fmt('usr.you', { name: s.username })}</span>
          <button type="button" className="btn btn--ghost btn--sm" style={{ flex: 'none' }} onClick={logout}>
            {t('set.logout')}
          </button>
        </div>
      ) : null}
      <div>
        <span className="field-label">{t('set.lang')}</span>
        <Seg
          value={s?.lang ?? 'zh'}
          onChange={(v) => setLangPref(v as 'zh' | 'en')}
          options={[
            { value: 'zh', label: '简体中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
      <div>
        <span className="field-label">{t('set.theme')}</span>
        <Seg
          value={s?.theme ?? 'apple'}
          onChange={(v) => void setThemePref(v as 'apple' | 'flat' | 'pixel')}
          options={[
            { value: 'apple', label: t('set.themeApple') },
            { value: 'flat', label: t('set.themeFlat') },
            { value: 'pixel', label: t('set.themePixel') },
          ]}
        />
      </div>
      <hr className="hr" />
      <div className="col gap6">
        <span className="field-label">{t('llm.cfg')}</span>
        <p className="t-sm t-muted" style={{ margin: 0 }}>{t('llm.cfgHint')}</p>
        <div className="wrap-t gap6">
          <span className="t-xs t-muted" style={{ alignSelf: 'center' }}>{t('llm.quick')}</span>
          {LLM_VENDORS.map((v) => {
            const on = llmUrl.trim() === v.url;
            return (
              <button
                key={v.id}
                type="button"
                className={`chip${on ? ' chip--active' : ' chip--glass'}`}
                title={`${v.url} · ${v.model}`}
                onClick={() => { setLlmUrl(v.url); setLlmModel(v.model); }}
              >
                <i className="cdot" style={{ background: v.tint }} />
                {v.name}
              </button>
            );
          })}
        </div>
        <span className="t-xs t-mono" style={V({ color: s?.llm_configured ? 'var(--present)' : 'var(--faint)' })}>
          {s?.llm_configured ? fmt('llm.onModel', { model: s?.llm_model || '?' }) : t('llm.off')}
        </span>
        <input className="field" value={llmUrl} placeholder={t('llm.baseUrlPh')} autoComplete="off" onChange={(e) => setLlmUrl(e.target.value)} />
        <input className="field" value={llmModel} placeholder={t('llm.modelPh')} autoComplete="off" onChange={(e) => setLlmModel(e.target.value)} />
        <input
          className="field"
          type="password"
          value={llmKey}
          placeholder={s?.llm_has_key ? '••••••••' : t('llm.apiKeyPh')}
          autoComplete="off"
          onChange={(e) => setLlmKey(e.target.value)}
        />
        <div className="rowline gap8">
          <button type="button" className="btn btn--soft btn--sm" onClick={() => void saveLlm()}>
            {t('llm.save')}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" style={{ color: 'var(--danger)' }} onClick={() => void clearLlmKey()}>
            {t('llm.clearKey')}
          </button>
        </div>
      </div>
      <div>
        <span className="field-label">{t('set.lan')}</span>
        <div className="rowline between" style={{ gap: 8 }}>
          <code
            className="t-mono t-sm ellip"
            style={V({
              background: 'rgb(255 255 255/0.6)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '9px 12px',
              flex: '1',
              minWidth: 0,
            })}
          >
            {s ? `http://${s.lan_url}` : '…'}
          </code>
          <button type="button" className="btn btn--soft btn--sm" onClick={copyLan}>
            {t('set.copy')}
          </button>
        </div>
      </div>
      <hr className="hr" />
      <div>
        <span className="field-label">{t('set.token')}</span>
        <div className="rowline between mt8">
          <span className="t-sm">{t('set.tokenProtect')}</span>
          <Switch on={s?.token_enabled ?? false} onChange={toggleToken} />
        </div>
        {s?.token_enabled && currentToken ? (
          <div className="col gap6 mt8">
            <p className="t-sm t-muted" style={{ margin: 0 }}>
              {t('set.tokenShow')}
            </p>
            <code
              className="t-mono t-sm"
              style={{
                wordBreak: 'break-all',
                background: 'rgb(255 255 255/0.6)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '9px 12px',
              }}
            >
              {currentToken}
            </code>
            <div className="rowline gap8">
              <button type="button" className="btn btn--soft btn--sm" onClick={() => void copyToken(currentToken)}>
                {t('set.copy')}
              </button>
              <button
                type="button"
                className="btn btn--soft btn--sm"
                onClick={() => downloadText(`${s?.username ?? 'whereisit'}.token`, currentToken + '\n')}
              >
                {t('set.download')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void replaceToken()}>
                {t('set.replace')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <hr className="hr" />
      <div className="col gap6">
        <span className="field-label">{t('set.data')}</span>
        <div className="rowline gap8">
          <button type="button" className="btn btn--soft btn--sm" onClick={() => void doExport()}>
            {t('set.export')}
          </button>
          <button type="button" className="btn btn--soft btn--sm" onClick={() => importRef.current?.click()}>
            {t('set.import')}
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => void onPickFile(e)}
          />
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onManageCategories}>
          {t('set.cats')}
        </button>
      </div>
      {s?.is_admin ? (
        <>
          <hr className="hr" />
          <div className="col gap6">
            <span className="field-label">{t('usr.title')}</span>
            <p className="t-sm t-muted" style={{ margin: 0 }}>{t('usr.hint')}</p>
            <div className="rowline between" style={{ gap: 8 }}>
              <span className="t-sm">{t('set.reg')}</span>
              <Seg
                value={s?.registration ?? 'manual'}
                onChange={(r) => void setRegistration(r as 'auto' | 'manual')}
                options={[
                  { value: 'manual', label: t('set.regManual') },
                  { value: 'auto', label: t('set.regAuto') },
                ]}
              />
            </div>
            <div className="rowline gap8">
              <input
                className="field"
                placeholder={t('usr.newPh')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) void doCreateUser();
                }}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!newName.trim()}
                onClick={() => void doCreateUser()}
              >
                {t('usr.create')}
              </button>
            </div>
            {justCreated ? (
              <div className="col gap6">
                <p className="t-sm" style={{ margin: 0 }}>
                  {fmt('usr.created', { name: justCreated.username })}
                </p>
                <p className="t-sm t-muted" style={{ margin: 0 }}>{t('usr.tokenOnce')}</p>
                <code
                  className="t-mono t-sm"
                  style={{
                    wordBreak: 'break-all',
                    background: 'rgb(255 255 255/0.6)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: '9px 12px',
                  }}
                >
                  {justCreated.token}
                </code>
                <div className="rowline gap8">
                  <button type="button" className="btn btn--soft btn--sm" onClick={() => void copyToken(justCreated.token)}>
                    {t('set.copy')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--soft btn--sm"
                    onClick={() => downloadText(`${justCreated.username}.token`, justCreated.token + '\n')}
                  >
                    {t('set.download')}
                  </button>
                </div>
              </div>
            ) : null}
            {users.length === 0 ? (
              <p className="t-sm t-faint">{t('usr.noUsers')}</p>
            ) : (
              users.map((u) => (
                <div
                  key={u.id}
                  className="glass-card panel"
                  style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <span className="grow ellip">
                    {u.username}
                    {u.is_admin ? <span className="tag" style={V({ color: 'var(--accent)' })}>admin</span> : null}
                  </span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void userReplaceToken(u)}>
                    {t('usr.replaceToken')}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void userRevokeToken(u)}>
                    {t('usr.revokeToken')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={V({ color: 'var(--danger)' })}
                    onClick={() => void userDelete(u)}
                  >
                    {t('usr.delete')}
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
      <p className="t-xs t-faint">{t('set.foot')}</p>
    </Sheet>
  );
}

/* ------------------------------------------------ exist-check ------------ */
function ExistSheet({
  open,
  onClose,
  onOpenItem,
}: {
  open: boolean;
  onClose: () => void;
  onOpenItem: (slug: string) => void;
}) {
  const tree = useCatalog((s) => s.tree);
  const search = useCatalog((s) => s.search);
  const [scopeId, setScopeId] = useState(''); // '' = everywhere; else a space node id
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);
  const { t, fmt } = useTr();

  const query = q.trim().toLowerCase();
  /* every existing space at any depth, as "~/ a / b" — pick a middle layer too */
  const spaces = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: DirNode[], path: string[]) => {
      for (const n of nodes) {
        const p = [...path, n.name];
        out.push({ id: n.id, label: p.join(' / ') });
        walk(n.kids, p);
      }
    };
    walk(tree, []);
    return out;
  }, [tree]);
  const scopeSpaceId = scopeId === '' ? undefined : Number(scopeId);

  /* existence check via backend; stale responses are ignored by seq */
  useEffect(() => {
    if (!query) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const t = window.setTimeout(async () => {
      try {
        const r = await search(query, 'existence', scopeSpaceId);
        if (seq === seqRef.current) setHits(r.items);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scopeSpaceId, search]);

  return (
    <Sheet open={open} onClose={onClose} side="bottom" title={t('hub.exist')} grab>
      <div>
        <span className="field-label">{t('exist.scope')}</span>
        <select className="field" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
          <option value="">{t('exist.all')}</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              ~/ {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className="field-label">{t('exist.what')}</span>
        <input
          className="field"
          placeholder={t('exist.placeholder')}
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="wrap-t gap6 mt8">
          {['充电宝', '剪刀', 'HDMI 线'].map((x) => (
            <button key={x} type="button" className="chip chip--glass" onClick={() => setQ(x)}>
              {fmt('exist.try', { x })}
            </button>
          ))}
        </div>
      </div>
      <div aria-live="polite">
        {!query ? (
          <p className="t-sm t-faint">{t('exist.tip')}</p>
        ) : searching && hits.length === 0 ? (
          <p className="t-sm t-faint">{t('exist.searching')}</p>
        ) : hits.length ? (
          hits.slice(0, 4).map((it) => (
            <button key={it.slug} type="button" className="glass-card rec-suggest in" onClick={() => onOpenItem(it.slug)} style={{ width: '100%' }}>
              <span className="rec-sug-ic">
                <Icon name="locate" size={16} />
              </span>
              <span className="rec-sug-txt">
                <span className="rec-sug-line">
                  {fmt('exist.hit', { path: `~/ ${pathNames(tree, it.spot).join(' / ')}`, qty: it.qty, unit: it.unit, name: it.name })}
                </span>
                <span className="rec-sug-hint">{t('exist.hitHint')}</span>
              </span>
            </button>
          ))
        ) : (
          <div className="empty-state" style={{ marginTop: 4 }}>
            <b>{fmt('exist.none', { q: q.trim() })}</b>
            <span>{t('exist.noneHint')}</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------ category management ----- */
function CategorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const categories = useCatalog((s) => s.categories);
  const addCategory = useCatalog((s) => s.addCategory);
  const renameCategory = useCatalog((s) => s.renameCategory);
  const removeCategory = useCatalog((s) => s.removeCategory);
  const toast = useToast((s) => s.push);
  const { t, fmt } = useTr();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteInto, setDeleteInto] = useState<number | ''>('');

  const submitNew = async () => {
    const n = newName.trim();
    if (!n) return;
    if (await addCategory(n)) toast(`已新增分类「${n}」`);
    setNewName('');
  };
  const saveRename = async () => {
    if (editingId == null) return;
    const n = editingName.trim();
    if (n && (await renameCategory(editingId, n))) toast('已重命名');
    setEditingId(null);
  };
  const confirmDelete = async () => {
    if (deletingId == null) return;
    const into = deleteInto === '' ? undefined : Number(deleteInto);
    if (await removeCategory(deletingId, into)) toast('已删除分类');
    setDeletingId(null);
    setDeleteInto('');
  };

  return (
    <Sheet open={open} onClose={onClose} side="bottom" title={t('cat.title')} grab>
      <div className="rowline gap8">
        <input
          className="field"
          placeholder={t('cat.newPh')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitNew();
          }}
        />
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => void submitNew()}
          disabled={!newName.trim()}
        >
          {t('app.add')}
        </button>
      </div>
      <div className="col gap6">
        {categories.map((c) => {
          const editing = editingId === c.id;
          const deleting = deletingId === c.id;
          return (
            <div key={c.id} className="glass-card panel" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              {editing ? (
                <>
                  <input
                    className="field"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename();
                    }}
                  />
                  <button type="button" className="btn btn--soft btn--sm" onClick={() => void saveRename()}>{t('app.save')}</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingId(null)}>{t('app.cancel')}</button>
                </>
              ) : deleting ? (
                <>
                  <span className="grow t-sm" style={{ minWidth: 0 }}>
                    {c.itemCount > 0 ? (
                      <select
                        className="field"
                        style={{ margin: 0 }}
                        value={deleteInto}
                        onChange={(e) => setDeleteInto(e.target.value ? Number(e.target.value) : '')}
                      >
                        <option value="">{t('cat.mergeIntoPh')}</option>
                        {categories.filter((x) => x.id !== c.id).map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{fmt('cat.confirmDelete', { name: c.name })}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={c.itemCount > 0 && deleteInto === ''}
                    onClick={() => void confirmDelete()}
                  >
                    {t('app.delete')}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDeletingId(null)}>{t('app.cancel')}</button>
                </>
              ) : (
                <>
                  <span className="grow ellip">{c.name}</span>
                  <span className="tag tag--type" style={V({ ['--tc']: 'var(--muted)' })}>{fmt('cat.count', { n: c.itemCount })}</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditingName(c.name);
                    }}
                  >
                    {t('cat.rename')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={V({ color: 'var(--danger)' })}
                    onClick={() => {
                      setDeletingId(c.id);
                      setDeleteInto('');
                    }}
                  >
                    {t('app.delete')}
                  </button>
                </>
              )}
            </div>
          );
        })}
        {categories.length === 0 ? (
          <p className="t-sm t-faint">{t('cat.empty')}</p>
        ) : null}
      </div>
    </Sheet>
  );
}
