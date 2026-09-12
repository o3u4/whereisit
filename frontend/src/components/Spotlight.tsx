/* whereisit · global ⌘K search spotlight. Rendered once at the app root so the
 * hotkey summons the same overlay from any page (Hub / Browse / Record). */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, TYPE_ICON } from './icons';
import { Seg, Kbd, EmptyState, StatusBadge } from './ui';
import { catMeta } from '../lib/meta';
import { dirById, frequentItemNames, pathNames } from '../lib/tree';
import type { Item } from '../lib/types';
import type { AgentStep, SearchResult } from '../api/client';
import { agentRun, agentUndo } from '../api/client';
import type { SearchModeDTO } from '../api/types';
import { useCatalog } from '../stores/catalog';
import { useOverlay } from '../stores/overlay';
import { useFreq } from '../stores/freq';
import { useTr } from '../i18n';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

type Row = { kind: 'item'; slug: string } | { kind: 'space'; slug: string };


export function Spotlight() {
  const navigate = useNavigate();
  const { t, fmt } = useTr();
  const spot = useOverlay((s) => s.spot);
  const initialQ = useOverlay((s) => s.initialQ);
  const closeSpot = useOverlay((s) => s.closeSpot);
  const openItem = useOverlay((s) => s.openItem);
  const items = useCatalog((s) => s.items);
  const tree = useCatalog((s) => s.tree);
  const search = useCatalog((s) => s.search);

  const [q, setQ] = useState('');
  const [sel, setSel] = useState(-1);
  const [mode, setMode] = useState<SearchModeDTO>('fuzzy');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const qInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  const [view, setView] = useState<'search' | 'agent'>('search');
  const [aMsg, setAMsg] = useState('');
  const [aImgB, setAImgB] = useState<string | null>(null); // base64 for API
  const [aImgU, setAImgU] = useState<string | null>(null); // dataURL preview
  const [aSteps, setASteps] = useState<AgentStep[]>([]);
  const [aReply, setAReply] = useState('');
  const [aUndoId, setAUndoId] = useState<number | null>(null);
  const [aBusy, setABusy] = useState(false);
  const aFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (spot) {
      if (initialQ) setQ(initialQ);
      window.setTimeout(() => qInput.current?.focus({ preventScroll: true }), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, initialQ]);

  const query = q.trim().toLowerCase();
  const freqTick = useFreq((s) => s.tick);
  const rows = useMemo<Row[]>(() => {
    if (!query) {
      const slugs: string[] = [];
      for (const n of frequentItemNames(items)) {
        const s = items.find((i) => i.name === n)?.slug;
        if (s) slugs.push(s);
      }
      return slugs.map((s) => ({ kind: 'item' as const, slug: s }));
    }
    const itemRows: Row[] = (res?.items ?? []).map((it) => ({ kind: 'item', slug: it.slug }));
    const spaceRows: Row[] = (res?.spaces ?? []).map((sp) => ({ kind: 'space', slug: String(sp.id) }));
    return [...itemRows, ...spaceRows];
  }, [query, res, items, freqTick]);

  useEffect(() => setSel(-1), [query, mode]);

  useEffect(() => {
    if (!query) {
      setRes(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(async () => {
      try {
        const r = await search(query, mode);
        if (seq === searchSeq.current) setRes(r);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, search]);

  const moveSel = (d: number) => {
    if (!rows.length) return;
    setSel((prev) => {
      const n = rows.length;
      return ((prev + d) % n + n) % n;
    });
  };

  const goSpace = (id: string) => {
    closeSpot();
    navigate(`/browse?at=${id}`);
  };

  const openRow = (i: number) => {
    const r = rows[i];
    if (!r) return;
    if (r.kind === 'item') openItem(r.slug);
    else goSpace(r.slug);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSel(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSel(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openRow(sel >= 0 ? sel : 0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSpot();
    }
  };

  const itemPathOf = (it: Item) => '~/ ' + pathNames(tree, it.spot).join(' / ');

  const rowOf = (r: Row, idx: number): ReactNode => {
    if (r.kind === 'item') {
      const it = items.find((x) => x.slug === r.slug);
      if (!it) return null;
      const cat = catMeta(it.cat);
      return (
        <button key={r.slug} type="button" className={`result-row${idx === sel ? ' sel' : ''}`} onClick={() => openRow(idx)}>
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
          <span className="tag" style={V({ color: 'var(--muted)' })}>{cat.label}</span>
          <Icon name="chev" size={16} style={V({ color: 'var(--faint)', flex: 'none' })} />
        </button>
      );
    }
    const node = dirById(tree, r.slug);
    if (!node) return null;
    return (
      <button key={r.slug} type="button" className={`result-row${idx === sel ? ' sel' : ''}`} onClick={() => openRow(idx)}>
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
  const renderList = (list: Row[]) => list.map((r) => rowOf(r, rows.indexOf(r)));

  let body: ReactNode;
  if (!query) {
    body = (
      <>
        {groupHead(t('hub.recentLookup'))}
        {renderList(rows)}
      </>
    );
  } else if (rows.length === 0) {
    body = searching ? (
      <p className="t-sm t-faint" style={{ padding: '12px 10px' }}>{t('hub.searching')}</p>
    ) : (
      <EmptyState
        icon="search"
        title={fmt('hub.notFound', { q: q.trim() })}
        hint={t('hub.notFoundHint')}
        action={
          <button
            type="button"
            className="btn btn--soft btn--sm mt8"
            onClick={() => {
              closeSpot();
              navigate('/browse');
            }}
          >
            {t('hub.goBrowse')}
          </button>
        }
      />
    );
  } else {
    body = (
      <>
        {groupHead(fmt('hub.groupItem', { n: itemRows.length }))}
        {renderList(itemRows)}
        {groupHead(fmt('hub.groupSpace', { n: spaceRows.length }))}
        {renderList(spaceRows)}
      </>
    );
  }

  const pickAgentImg = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const d = String(rd.result);
      setAImgU(d);
      setAImgB(d.slice(d.indexOf(',') + 1));
    };
    rd.readAsDataURL(f);
  };

  const runAgent = async () => {
    if ((!aMsg.trim() && !aImgB) || aBusy) return;
    setABusy(true);
    setAReply('');
    setASteps([]);
    setAUndoId(null);
    try {
      const r = await agentRun(aMsg.trim() || undefined, aImgB ? [{ image_base64: aImgB }] : undefined);
      setASteps(r.steps);
      setAReply(r.reply);
      setAUndoId(r.undo_id);
      void useCatalog.getState().load();
    } catch (err) {
      setAReply(err instanceof Error ? err.message : String(err));
    } finally {
      setABusy(false);
    }
  };

  const doAgentUndo = async () => {
    if (aUndoId == null) return;
    try {
      await agentUndo(aUndoId);
      setAUndoId(null);
      void useCatalog.getState().load();
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div className={`dim${spot ? ' show' : ''}`} onClick={closeSpot} aria-hidden={!spot} />
      <div
        className={`spot glass-panel${spot ? ' show' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('hub.spotAria')}
      >
        <div style={{ padding: '10px 14px 0' }}>
          <Seg
            fluid
            value={view}
            onChange={(v) => setView(v as 'search' | 'agent')}
            options={[
              { value: 'search', label: t('ai.search') },
              { value: 'agent', label: t('ai.title') },
            ]}
          />
        </div>
        {view === 'agent' ? (
          <div className="col gap8" style={{ padding: '12px 14px 6px' }}>
            <textarea
              className="field"
              value={aMsg}
              onChange={(e) => setAMsg(e.target.value)}
              placeholder={t('ai.ph')}
              rows={3}
              style={{ resize: 'vertical', minHeight: 64, padding: '10px 14px' }}
            />
            <div className="rowline gap8">
              {aImgU ? (
                <img src={aImgU} alt="" style={{ width: 52, height: 40, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
              ) : null}
              <button type="button" className="btn btn--soft btn--sm" onClick={() => aFile.current?.click()}>
                {t('ai.attach')}
              </button>
              {aImgU ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setAImgB(null); setAImgU(null); }}>
                  {t('ai.remove')}
                </button>
              ) : null}
              <input ref={aFile} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickAgentImg} />
              <span className="grow" />
              <button type="button" className="btn btn--primary" disabled={(!aMsg.trim() && !aImgB) || aBusy} onClick={() => void runAgent()}>
                {aBusy ? t('ai.busy') : t('ai.send')}
              </button>
            </div>
            {aSteps.length ? (
              <div className="col gap4" style={{ maxHeight: '40vh', overflow: 'auto' }}>
                {aSteps.map((s, i) => (
                  <div key={i} className="rowline gap6 t-sm">
                    <span style={{ color: 'var(--present)' }}>✓</span>
                    <span className="t-mono t-xs" style={{ color: 'var(--faint)' }}>{s.tool}</span>
                    <span className="ellip">{s.result}</span>
                  </div>
                ))}
                {aUndoId != null ? (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void doAgentUndo()}>
                    {t('ai.undo')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {aReply ? <p className="t-sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{aReply}</p> : null}
          </div>
        ) : (
          <>
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
              onKeyDown={onKey}
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
          {body}
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
          </>
        )}
      </div>
    </>
  );
}