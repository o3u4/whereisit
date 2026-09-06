/*
 * whereisit · 中枢 (hub) — one-line search entry + recent + scene catalog.
 * Ports screens/home.html: hero ⌘K search, spotlight overlay, settings / exist /
 * item sheets, wide split mode (search left + detail right), mobile tab bar.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../api/client';
import { Icon, CDot, TYPE_ICON, type IconName } from '../components/icons';
import { Wordmark, Seg, Switch, Sheet, StatusBadge, Kbd, EmptyState, ToastsHost } from '../components/ui';
import { TabBar, TabLink, TabAction } from '../components/TabBar';
import { ItemSheet } from '../components/ItemSheet';
import { catMeta, TYPE_TINT } from '../lib/meta';
import { countItemsIn, dirById, pathNames, scenesFromTree } from '../lib/tree';
import type { DirNode, Item, RecentEntry, Scene } from '../lib/types';
import type { SearchResult } from '../api/client';
import type { SearchModeDTO } from '../api/types';
import { useCatalog } from '../stores/catalog';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/toast';
import { useTr } from '../i18n';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Row = { kind: 'item'; slug: string } | { kind: 'space'; slug: string };

export default function Hub() {
  const navigate = useNavigate();
  const { t, fmt } = useTr();
  const items = useCatalog((s) => s.items);
  const tree = useCatalog((s) => s.tree);
  const recent = useCatalog((s) => s.recent);
  const search = useCatalog((s) => s.search);
  const setReveal = useCatalog((s) => s.setReveal);
  const toast = useToast((s) => s.push);

  /* recent handling row → jump to that item's spot in browse & open its detail */
  const openRecent = (r: RecentEntry) => {
    if (r.slug && r.spot) {
      setReveal(r.slug);
      navigate(`/browse?at=${r.spot}`);
    } else {
      toast(fmt('hub.locating', { name: r.name }));
    }
  };

  const [spotOpen, setSpotOpen] = useState(false);
  const [itemSlug, setItemSlug] = useState<string | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [split, setSplit] = useState(false);
  const [existOpen, setExistOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(-1);
  const [mode, setMode] = useState<SearchModeDTO>('fuzzy');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const qInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  const openSpot = (initial = '') => {
    setQ(initial);
    setSel(-1);
    setSpotOpen(true);
    window.setTimeout(() => qInput.current?.focus({ preventScroll: true }), 60);
  };
  const closeSpot = () => {
    setSpotOpen(false);
    setSplit(false);
  };
  const closeItem = () => {
    setItemOpen(false);
    setSplit(false);
  };
  const openItem = (slug: string) => {
    setItemSlug(slug);
    setItemOpen(true);
    if (window.matchMedia('(min-width: 900px)').matches) {
      setSplit(true);
      setSpotOpen(true);
    } else {
      setSpotOpen(false);
    }
  };
  const goSpace = (slug: string) => {
    closeSpot();
    navigate(`/browse?at=${slug}`);
  };

  /* keyboard: ⌘/Ctrl-K · '/' · Esc */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSpot();
        return;
      }
      if (e.key === 'Escape') {
        if (split || itemOpen) closeItem();
        else if (spotOpen) closeSpot();
        else if (existOpen) setExistOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        return;
      }
      if (e.key === '/' && !typing && !spotOpen) {
        e.preventDefault();
        openSpot();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotOpen, itemOpen, existOpen, settingsOpen, split]);

  const item = itemSlug ? (items.find((i) => i.slug === itemSlug) ?? null) : null;

  const scenes = useMemo(() => scenesFromTree(tree), [tree]);

  /* ---- spotlight results (server-side, debounced; hot defaults stay client-side) ---- */
  const query = q.trim().toLowerCase();
  const rows = useMemo<Row[]>(() => {
    if (!query) {
      const hot = ['HDMI 线', '备用钥匙', '护照', '剪刀'];
      const slugs = hot
        .map((n) => items.find((i) => i.name === n)?.slug)
        .filter((s): s is string => !!s);
      return slugs.map((s) => ({ kind: 'item' as const, slug: s }));
    }
    const itemRows: Row[] = (res?.items ?? []).map((it) => ({ kind: 'item', slug: it.slug }));
    const spaceRows: Row[] = (res?.spaces ?? []).map((sp) => ({ kind: 'space', slug: String(sp.id) }));
    return [...itemRows, ...spaceRows];
  }, [query, res, items]);

  useEffect(() => setSel(-1), [query, mode]);

  /* debounced search request (each keystroke cancels the previous) */
  useEffect(() => {
    if (!query) {
      setRes(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = window.setTimeout(async () => {
      try {
        const r = await search(query, mode);
        if (seq === searchSeq.current) setRes(r);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, search]);

  const moveSel = (d: number) => {
    if (!rows.length) return;
    setSel((prev) => {
      const n = rows.length;
      return ((prev + d) % n + n) % n;
    });
  };
  const openSel = (i: number) => {
    const r = rows[i];
    if (!r) return;
    if (r.kind === 'item') openItem(r.slug);
    else goSpace(r.slug);
  };
  const onSpotKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSel(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSel(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSel(sel >= 0 ? sel : 0);
    }
  };

  const itemPathOf = (it: Item) => '~/ ' + pathNames(tree, it.spot).join(' / ');

  const rowOf = (r: Row, idx: number): ReactNode => {
    if (r.kind === 'item') {
      const it = items.find((x) => x.slug === r.slug);
      if (!it) return null;
      const cat = catMeta(it.cat);
      return (
        <button key={r.slug} type="button" className={`result-row${idx === sel ? ' sel' : ''}`} onClick={() => openSel(idx)}>
          <span className="rr-glyph" style={V({ ['--tc']: cat.tint })}>
            <Icon name={cat.icon} />
          </span>
          <span className="rr-main">
            <span className="rr-name">
              {it.name} <span className="t-xs" style={V({ color: 'var(--faint)', fontFamily: 'var(--font-mono)' })}>×{it.qty}</span>
            </span>
            <span className="rr-sub">
              <StatusBadge cls={it.status} label={t('status.' + it.status)} />
              <span className="mono-path ellip">{itemPathOf(it)}</span>
            </span>
          </span>
          <span className="tag" style={V({ color: 'var(--muted)' })}>
            {cat.label}
          </span>
          <Icon name="chev" size={16} style={V({ color: 'var(--faint)', flex: 'none' })} />
        </button>
      );
    }
    const node = dirById(tree, r.slug);
    if (!node) return null;
    return (
      <button key={r.slug} type="button" className={`result-row${idx === sel ? ' sel' : ''}`} onClick={() => openSel(idx)}>
        <span className="rr-glyph" style={V({ ['--tc']: 'var(--accent)' })}>
          <Icon name={TYPE_ICON[node.type]} />
        </span>
        <span className="rr-main">
          <span className="rr-name">{node.name}</span>
          <span className="rr-sub">
            <span className="t-xs">{fmt('hub.spaceRow', { n: node.kids.length })}</span>
          </span>
        </span>
        <Icon name="chev" size={16} style={V({ color: 'var(--faint)', flex: 'none' })} />
      </button>
    );
  };

  const groupHead = (label: string) => (
    <div key={`h-${label}`} className="t-xs section-kicker" style={{ padding: '6px 10px 2px' }}>
      {label}
    </div>
  );

  const itemRows = rows.filter((r) => r.kind === 'item');
  const spaceRows = rows.filter((r) => r.kind === 'space');
  const renderList = (list: Row[]) =>
    list.map((r) => rowOf(r, rows.indexOf(r)));

  let spotBody: ReactNode;
  if (!query) {
    spotBody = (
      <>
        {groupHead(t('hub.recentLookup'))}
        {renderList(rows)}
      </>
    );
  } else if (rows.length === 0) {
    spotBody = searching ? (
      <p className="t-sm t-faint" style={{ padding: '12px 10px' }}>{t('hub.searching')}</p>
    ) : (
      <EmptyState
        icon="search"
        title={fmt('hub.notFound', { q: q.trim() })}
        hint={t('hub.notFoundHint')}
        action={
          <Link className="btn btn--soft btn--sm mt8" to="/browse">
            {t('hub.goBrowse')}
          </Link>
        }
      />
    );
  } else {
    spotBody = (
      <>
        {groupHead(fmt('hub.groupItem', { n: itemRows.length }))}
        {renderList(itemRows)}
        {groupHead(fmt('hub.groupSpace', { n: spaceRows.length }))}
        {renderList(spaceRows)}
      </>
    );
  }

  const QUICK = ['钥匙', 'HDMI 线', '护照', '剪刀'];
  const sceneCnt = (sc: Scene) => countItemsIn(tree, items, sc.slug);

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
                <div className="grid-scenes">
                  {scenes.map((sc, i) => {
                    const kids = sc.kids;
                    return (
                      <article
                        key={sc.slug}
                        className={`scene-card in d${(i % 3) + 2}`}
                        style={V({ ['--tint-a']: sc.tintA, ['--tint-b']: sc.tintB })}
                      >
                        <Link className="scene-cover" to={`/browse?at=${sc.slug}`} aria-label={fmt('hub.enter', { name: sc.name })}>
                          <span className="icon-tile">
                            <Icon name={TYPE_ICON[sc.type]} />
                          </span>
                          <span className="scrim" aria-hidden="true" />
                          <span className="title">
                            <b>{sc.name}</b>
                            <span className="nchip">{sc.parent}</span>
                          </span>
                        </Link>
                        <div className="scene-body">
                          <Link className="between scene-goto" to={`/browse?at=${sc.slug}`} aria-label={fmt('hub.enter', { name: sc.name })}>
                            <span className="t-xs t-muted">
                              {fmt('hub.sceneMeta', { kids: kids.length, items: sceneCnt(sc) })}
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
                  })}
                </div>
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

      {/* spotlight */}
      <div
        className={`dim${spotOpen && !split ? ' show' : ''}`}
        onClick={closeSpot}
        aria-hidden={!(spotOpen && !split)}
      />
      <div
        className={`spot glass-panel${spotOpen ? ' show' : ''}${split ? ' spot--left' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('hub.spotAria')}
      >
        <div style={{ padding: '12px 14px 4px' }}>
          <div className="rowline" style={V({ gap: 10 })}>
            <Icon name="search" size={20} style={V({ color: 'var(--accent)', flex: 'none' })} />
            <input
              ref={qInput}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="field"
              placeholder={t('hub.spotPh')}
              autoComplete="off"
              aria-label={t('hub.spotInAria')}
              style={V({ flex: '1', minHeight: 44 })}
              onKeyDown={onSpotKey}
            />
            <Kbd>esc</Kbd>
          </div>
          <div className="spot-mode" style={{ marginTop: 10 }}>
            <Seg
              fluid
              value={mode}
              onChange={(v) => {
                setMode(v as SearchModeDTO);
                setSel(-1);
                setRes(null);
              }}
              options={[
                { value: 'fuzzy', label: t('mode.fuzzy') },
                { value: 'exact', label: t('mode.exact') },
                { value: 'category', label: t('mode.category') },
                { value: 'existence', label: t('mode.existence') },
              ]}
            />
          </div>
        </div>
        <div className="spot-body" style={{ paddingTop: 8 }}>
          {spotBody}
        </div>
        <div
          style={V({
            padding: '8px 18px 14px',
            borderTop: '1px solid rgb(255 255 255/0.6)',
            display: 'flex',
            gap: 14,
            alignItems: 'center',
          })}
          className="t-xs t-faint"
        >
          <span className="rowline gap6">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t('hub.kbdSelect')}
          </span>
          <span className="rowline gap6">
            <Kbd>↵</Kbd> {t('hub.kbdOpen')}
          </span>
          <span className="grow" />
          <span className="t-mono">{t('hub.kbdHint')}</span>
        </div>
      </div>

      <ItemSheet item={item} open={itemOpen} onClose={closeItem} />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onManageCategories={() => {
          setSettingsOpen(false);
          setCatOpen(true);
        }}
      />
      <CategorySheet open={catOpen} onClose={() => setCatOpen(false)} />
      <ExistSheet open={existOpen} onClose={() => setExistOpen(false)} onOpenItem={openItem} />
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
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCurrentToken(null);
    api.fetchSettings().then(setS).catch(() => setS(null));
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
        useAuth.getState().clearToken();
        await api.revokeAccessToken();
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
                onClick={() => downloadText(`whereisit.token`, currentToken + '\n')}
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
