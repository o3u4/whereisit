/*
 * whereisit · 中枢 (hub) — one-line search entry + recent + scene catalog.
 * Ports screens/home.html: hero ⌘K search, spotlight overlay, settings / exist /
 * item sheets, wide split mode (search left + detail right), mobile tab bar.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, CDot, TYPE_ICON, type IconName } from '../components/icons';
import { Wordmark, Seg, Switch, Sheet, StatusBadge, Kbd, EmptyState, ToastsHost } from '../components/ui';
import { TabBar, TabLink, TabAction } from '../components/TabBar';
import { ItemSheet } from '../components/ItemSheet';
import { catMeta, TYPE_TINT } from '../lib/meta';
import { countItemsIn, dirById, pathNames, scenesFromTree } from '../lib/tree';
import type { Item, Scene } from '../lib/types';
import type { SearchResult } from '../api/client';
import type { SearchModeDTO } from '../api/types';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

type Row = { kind: 'item'; slug: string } | { kind: 'space'; slug: string };

export default function Hub() {
  const navigate = useNavigate();
  const items = useCatalog((s) => s.items);
  const tree = useCatalog((s) => s.tree);
  const recent = useCatalog((s) => s.recent);
  const search = useCatalog((s) => s.search);
  const toast = useToast((s) => s.push);

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
              <StatusBadge cls={it.status} label={it.status === 'present' ? '在' : it.status === 'lent' ? '借出' : '用完'} />
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
            <span className="t-xs">空间 · {node.kids.length} 个子空间</span>
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
        {groupHead('最近查找')}
        {renderList(rows)}
      </>
    );
  } else if (rows.length === 0) {
    spotBody = searching ? (
      <p className="t-sm t-faint" style={{ padding: '12px 10px' }}>搜索中…</p>
    ) : (
      <EmptyState
        icon="search"
        title={`没有找到「${q.trim()}」`}
        hint="换个说法，或去「目录」里翻一翻"
        action={
          <Link className="btn btn--soft btn--sm mt8" to="/browse">
            去目录浏览
          </Link>
        }
      />
    );
  } else {
    spotBody = (
      <>
        {groupHead(`物品 · ${itemRows.length}`)}
        {renderList(itemRows)}
        {groupHead(`空间 · ${spaceRows.length}`)}
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
              <LangToggle />
              <button type="button" className="ibtn" aria-label="设置" onClick={() => setSettingsOpen(true)}>
                <Icon name="sliders" />
              </button>
              <Link className="btn btn--primary btn--sm hide-mobile" to="/record">
                <Icon name="plus" size={16} />登记
              </Link>
            </div>
          </header>

          <main>
            <section className="hero in d1">
              <p className="section-kicker">中枢 · SPOTLIGHT</p>
              <h1>问一句，东西在哪。</h1>
              <p className="lead">输入物品、空间或类别，路径自动给出；拿不准再进「目录」慢慢逛。</p>
              <button type="button" className="hero-search" aria-haspopup="dialog" onClick={() => openSpot()}>
                <Icon name="search" className="mag" />
                <span className="ph">找「HDMI 线」「书房」… 或一个类别</span>
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
                  我常找
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
                  确认这里有没有…
                </button>
              </div>
            </section>

            <div className="hub-sections">
              {recent.length > 0 ? (
              <section aria-labelledby="recentTitle">
                <div className="section-head">
                  <div>
                    <h2 className="st" id="recentTitle">
                      最近处理
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
                      onClick={() => toast(`正在定位到「${r.name}」`)}
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
                      场景目录
                    </h2>
                    <p className="t-sm t-muted mt8">
                      每个空间都是一层「路径」。点卡片进入；点卡里的子空间胶囊，直接跳进那一格。
                    </p>
                  </div>
                  <Link className="link" to="/browse">
                    进目录 <Icon name="chev" size={13} style={V({ display: 'inline-block', verticalAlign: '-1px' })} />
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
                        <Link className="scene-cover" to={`/browse?at=${sc.slug}`} aria-label={`进入 ${sc.name}`}>
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
                          <Link className="between scene-goto" to={`/browse?at=${sc.slug}`} aria-label={`进入 ${sc.name}`}>
                            <span className="t-xs t-muted">
                              {kids.length} 个子空间 · {sceneCnt(sc)} 件物品
                            </span>
                            <Icon name="chev" size={15} style={V({ color: 'var(--faint)' })} />
                          </Link>
                          <div className="scene-subchips">
                            {kids.map((k) => (
                              <Link
                                key={k.id}
                                className="glass-chip chip-sub"
                                to={`/browse?at=${k.id}`}
                                aria-label={`进入 ${k.name}`}
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
          <TabLink to="/" icon="home" label="中枢" current />
          <TabLink to="/browse" icon="dir" label="目录" />
          <TabLink to="/record" icon="plus" label="登记" pill />
          <TabAction icon="search" label="搜索" onClick={() => openSpot()} />
          <TabAction icon="sliders" label="设置" onClick={() => setSettingsOpen(true)} />
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
        aria-label="搜索"
      >
        <div style={{ padding: '12px 14px 4px' }}>
          <div className="rowline" style={V({ gap: 10 })}>
            <Icon name="search" size={20} style={V({ color: 'var(--accent)', flex: 'none' })} />
            <input
              ref={qInput}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="field"
              placeholder="找物品、空间或类别…"
              autoComplete="off"
              aria-label="搜索词"
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
                { value: 'fuzzy', label: '模糊' },
                { value: 'exact', label: '精确' },
                { value: 'category', label: '类别' },
                { value: 'existence', label: '存在' },
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
            <Kbd>↓</Kbd> 选择
          </span>
          <span className="rowline gap6">
            <Kbd>↵</Kbd> 打开
          </span>
          <span className="grow" />
          <span className="t-mono">按 ⌘K 随时唤起</span>
        </div>
      </div>

      <ItemSheet item={item} open={itemOpen} onClose={closeItem} primary="locate" />

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

/* ------------------------------------------------ language demo chip ------ */
function LangToggle() {
  const [zh, setZh] = useState(true);
  return (
    <button type="button" className="chip chip--glass hide-mobile" onClick={() => setZh((v) => !v)}>
      {zh ? 'EN' : '中'}
    </button>
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
  const [lang, setLang] = useState('zh');
  const [theme, setTheme] = useState('light');
  const [pin, setPin] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText('http://192.168.31.14:8080');
      toast('已复制局域网地址');
    } catch {
      toast('复制失败，请手动复制');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} side="right" title="设置">
      <div>
        <span className="field-label">语言</span>
        <Seg
          value={lang}
          onChange={setLang}
          options={[
            { value: 'zh', label: '简体中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
      <div>
        <span className="field-label">
          外观 <span className="hint">原型演示浅色</span>
        </span>
        <Seg
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
            { value: 'auto', label: '跟随系统' },
          ]}
        />
      </div>
      <hr className="hr" />
      <div>
        <span className="field-label">局域网访问</span>
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
            http://192.168.31.14:8080
          </code>
          <button type="button" className="btn btn--soft btn--sm" onClick={copy}>
            复制
          </button>
        </div>
        <div className="rowline between mt8">
          <span className="t-sm">访问需口令</span>
          <Switch on={pin} onChange={setPin} />
        </div>
      </div>
      <hr className="hr" />
      <div className="col gap6">
        <span className="field-label">数据整理</span>
        <div className="rowline gap8">
          <button type="button" className="btn btn--soft btn--sm" onClick={onManageCategories}>
            分类管理
          </button>
        </div>
      </div>
      <hr className="hr" />
      <div className="col gap6">
        <span className="field-label">搜索与解析引擎</span>
        <div className="between">
          <span className="t-sm">内置全文搜索</span>
          <span className="tag tag--type" style={V({ ['--tc']: 'var(--accent)' })}>
            <CDot />FTS5 已启用
          </span>
        </div>
        <div className="between">
          <span className="t-sm">语义 / 向量搜索</span>
          <span className="tag" style={V({ background: 'var(--gone-soft)', color: 'var(--gone)' })}>
            预留接口
          </span>
        </div>
        <div className="between">
          <span className="t-sm">拍照 / 语音登记（LLM）</span>
          <span className="tag" style={V({ background: 'var(--gone-soft)', color: 'var(--gone)' })}>
            1.x 规划
          </span>
        </div>
      </div>
      <hr className="hr" />
      <div className="rowline between">
        <span className="t-sm">数据备份</span>
        <div className="hd-group">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => toast('演示版不支持导出')}>
            导出
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => toast('演示版不支持导入')}>
            导入
          </button>
        </div>
      </div>
      <p className="t-xs t-faint">whereisit prototype · M1 数据模型演示</p>
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
  const [scope, setScope] = useState('all');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);

  const query = q.trim().toLowerCase();
  const scopeRoot =
    scope === 'all'
      ? undefined
      : tree.find((n) => n.name === (scope === 'study' ? '书房' : '卧室'));
  const scopeSpaceId = scopeRoot ? Number(scopeRoot.id) : undefined;

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
    <Sheet open={open} onClose={onClose} side="bottom" title="确认这里有没有…" grab>
      <div>
        <span className="field-label">在哪个范围里找？</span>
        <Seg
          fluid
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: '全部位置' },
            { value: 'study', label: '书房' },
            { value: 'bedroom', label: '卧室' },
          ]}
        />
      </div>
      <div>
        <span className="field-label">找什么？</span>
        <input
          className="field"
          placeholder="例如：充电宝 / 剪刀"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="wrap-t gap6 mt8">
          {['充电宝', '剪刀', 'HDMI 线'].map((x) => (
            <button key={x} type="button" className="chip chip--glass" onClick={() => setQ(x)}>
              试试：{x}
            </button>
          ))}
        </div>
      </div>
      <div aria-live="polite">
        {!query ? (
          <p className="t-sm t-faint">输入名称后，这里会直接告诉你「在不在」。 </p>
        ) : searching && hits.length === 0 ? (
          <p className="t-sm t-faint">正在查看…</p>
        ) : hits.length ? (
          hits.slice(0, 4).map((it) => (
            <button key={it.slug} type="button" className="glass-card rec-suggest in" onClick={() => onOpenItem(it.slug)} style={{ width: '100%' }}>
              <span className="rec-sug-ic">
                <Icon name="locate" size={16} />
              </span>
              <span className="rec-sug-txt">
                <span className="rec-sug-line">
                  在 <span className="mono-path">~/ {pathNames(tree, it.spot).join(' / ')}</span> · 有 {it.qty} {it.unit}「{it.name}」
                </span>
                <span className="rec-sug-hint">点这里看它的详情</span>
              </span>
            </button>
          ))
        ) : (
          <div className="empty-state" style={{ marginTop: 4 }}>
            <b>这个范围里没有「{q.trim()}」</b>
            <span>换个说法，或确认是否真的在这里登记过</span>
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
    <Sheet open={open} onClose={onClose} side="bottom" title="分类管理" grab>
      <div className="rowline gap8">
        <input
          className="field"
          placeholder="新分类名称"
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
          添加
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
                  <button type="button" className="btn btn--soft btn--sm" onClick={() => void saveRename()}>保存</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingId(null)}>取消</button>
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
                        <option value="">先选合并到的分类…</option>
                        {categories.filter((x) => x.id !== c.id).map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span>确认删除「{c.name}」？</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={c.itemCount > 0 && deleteInto === ''}
                    onClick={() => void confirmDelete()}
                  >
                    删除
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDeletingId(null)}>取消</button>
                </>
              ) : (
                <>
                  <span className="grow ellip">{c.name}</span>
                  <span className="tag tag--type" style={V({ ['--tc']: 'var(--muted)' })}>{c.itemCount} 件</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditingName(c.name);
                    }}
                  >
                    改名
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
                    删除
                  </button>
                </>
              )}
            </div>
          );
        })}
        {categories.length === 0 ? (
          <p className="t-sm t-faint">还没有分类。登记时会自动创建；也可以在这里新增。</p>
        ) : null}
      </div>
    </Sheet>
  );
}
