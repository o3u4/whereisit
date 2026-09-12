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
import type { ApplyResult, PlanStep, PlanTool, SearchResult } from '../api/client';
import { agentApply, agentPlan, agentUndo } from '../api/client';
import type { SearchModeDTO } from '../api/types';
import { useCatalog } from '../stores/catalog';
import { useOverlay } from '../stores/overlay';
import { useFreq } from '../stores/freq';
import { useTr } from '../i18n';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

type Row = { kind: 'item'; slug: string } | { kind: 'space'; slug: string };

/* ---- agent plan rendering helpers ---------------------------------------- */
const pathStr = (p: unknown) => '/' + (Array.isArray(p) ? (p as string[]) : []).join('/');
const TOOL_LABEL: Record<PlanTool, string> = {
  create: 'ai.tool.create',
  update: 'ai.tool.update',
  remove: 'ai.tool.remove',
  category: 'ai.tool.category',
  merge_defs: 'ai.tool.mergeDefs',
  set_image: 'ai.tool.setImage',
  reorder: 'ai.tool.reorder',
};
const TOOL_COLOR: Record<PlanTool, string> = {
  create: 'var(--present)',
  update: 'var(--accent)',
  remove: 'var(--danger)',
  category: 'var(--accent)',
  merge_defs: 'var(--faint)',
  set_image: 'var(--present)',
  reorder: 'var(--muted)',
};

/** client-side preview of what one plan step will do (server results replace it) */
function planLines(step: PlanStep, tr: (k: string, v?: Record<string, string | number>) => string): string[] {
  const a = step.args as Record<string, unknown>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  if (step.tool === 'create') {
    return [
      ...arr<string[]>(a.spaces).map((p) => tr('ai.ln.space', { p: pathStr(p) })),
      ...arr<{ name: string; at: string[]; qty?: number; attrs?: unknown[] }>(a.items).map(
        (i) => tr('ai.ln.item', { n: i.name, q: i.qty ?? 1, p: pathStr(i.at) }),
      ),
    ];
  }
  if (step.tool === 'update') {
    return [
      ...arr<{ from_path: string[]; to_path: string[] }>(a.moves).map(
        (m) => tr('ai.ln.move', { from: pathStr(m.from_path), to: pathStr(m.to_path) }),
      ),
      ...arr<{ name: string; to_path: string[] }>(a.item_moves).map(
        (m) => tr('ai.ln.moveN', { n: m.name, to: pathStr(m.to_path) }),
      ),
      ...arr<{ path: string[]; name?: string }>(a.spaces).map(
        (s) => tr('ai.ln.spacePatch', { p: pathStr(s.path) }),
      ),
      ...arr<{ name: string }>(a.items).map((i) => tr('ai.ln.itemPatch', { n: i.name })),
      ...arr<string[]>(a.to_items).map((p) => tr('ai.ln.toItem', { p: pathStr(p) })),
    ];
  }
  if (step.tool === 'remove') {
    return [
      ...arr<string[]>(a.spaces).map((p) => tr('ai.ln.space', { p: pathStr(p) })),
      ...arr<{ name: string }>(a.items).map((i) => tr('ai.ln.itemN', { n: i.name })),
    ];
  }
  if (step.tool === 'category') {
    return [
      ...arr<string>(a.add).map((n) => tr('ai.ln.catAdd', { n })),
      ...arr<{ name: string; to: string }>(a.rename).map((r) => tr('ai.ln.catRename', { n: r.name, to: r.to })),
      ...arr<{ source: string; into: string }>(a.merge).map((m) => tr('ai.ln.catMerge', { n: m.source, into: m.into })),
      ...arr<string>(a.remove).map((n) => tr('ai.ln.catRemove', { n })),
    ];
  }
  if (step.tool === 'merge_defs') {
    const t = a.target as string;
    return [tr('ai.ln.mergeDefs', { target: t, n: arr<string>(a.sources).length })];
  }
  if (step.tool === 'set_image') {
    const refs = [
      ...arr<{ name: string }>(a.items).map((i) => i.name),
      ...arr<string[]>(a.spaces).map((p) => pathStr(p)),
    ];
    return refs.length ? refs.map((n) => tr('ai.ln.setImage', { n })) : [tr('ai.ln.setImage', { n: '—' })];
  }
  if (step.tool === 'reorder') {
    return [tr('ai.ln.reorder', { p: pathStr(a.path), n: arr<string>(a.spaces).length })];
  }
  return [];
}


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
  type APhase = 'idle' | 'planning' | 'await' | 'applying' | 'done';
  const [aPhase, setAPhase] = useState<APhase>('idle');
  const [aPlan, setAPlan] = useState<PlanStep[]>([]);
  const [aReply, setAReply] = useState('');
  const [aResults, setAResults] = useState<ApplyResult[] | null>(null);
  const [aUndoId, setAUndoId] = useState<number | null>(null);
  const [aRevOpen, setARevOpen] = useState(false);
  const [aRev, setARev] = useState('');
  const aFile = useRef<HTMLInputElement>(null);

  const aBusy = aPhase === 'planning' || aPhase === 'applying';

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

  const aReset = () => {
    setAPhase('idle');
    setAPlan([]);
    setAResults(null);
    setAUndoId(null);
    setAReply('');
    setARevOpen(false);
    setARev('');
  };
  const aResetAll = () => {
    aReset();
    setAMsg('');
    setAImgB(null);
    setAImgU(null);
  };

  const pickAgentImg = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    aReset();
    const rd = new FileReader();
    rd.onload = () => {
      const d = String(rd.result);
      setAImgU(d);
      setAImgB(d.slice(d.indexOf(',') + 1));
    };
    rd.readAsDataURL(f);
  };

  const runAgentPlan = async () => {
    if ((!aMsg.trim() && !aImgB) || aBusy) return;
    aReset();
    setAPhase('planning');
    try {
      const r = await agentPlan(aMsg.trim() || undefined, aImgB ? [{ image_base64: aImgB }] : undefined);
      setAReply(r.reply);
      if (r.steps.length) {
        setAPlan(r.steps);
        setAPhase('await');
      } else {
        setAPhase('idle');
      }
    } catch (err) {
      setAReply(err instanceof Error ? err.message : String(err));
      setAPhase('idle');
    }
  };

  const confirmApply = async () => {
    if (aPhase !== 'await') return;
    setAPhase('applying');
    try {
      const r = await agentApply(aPlan, aImgB ? [{ image_base64: aImgB }] : undefined);
      setAResults(r.results);
      setAUndoId(r.undo_id);
      setAPhase('done');
      void useCatalog.getState().load();
    } catch (err) {
      setAReply(err instanceof Error ? err.message : String(err));
      setAPhase('await');
    }
  };

  const doAgentUndo = async () => {
    if (aUndoId == null) return;
    try {
      await agentUndo(aUndoId);
      void useCatalog.getState().load();
    } catch {
      /* ignore */
    }
    aResetAll();
  };

  const runRevisePlan = async () => {
    if (!aRev.trim() || aBusy) return;
    setAPhase('planning');
    try {
      const r = await agentPlan(aMsg.trim() || undefined, aImgB ? [{ image_base64: aImgB }] : undefined, {
        revision: aRev.trim(),
        prev_steps: aPlan,
      });
      setAReply(r.reply);
      if (r.steps.length) {
        setAPlan(r.steps);
        setARev('');
        setARevOpen(false);
      }
      setAPhase('await');
    } catch (err) {
      setAReply(err instanceof Error ? err.message : String(err));
      setAPhase('await');
    }
  };

  const dropStep = (i: number) => {
    const next = aPlan.filter((_, idx) => idx !== i);
    if (!next.length) aReset();
    else setAPlan(next);
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
          <div className="col gap8" style={{ padding: '12px 14px 6px', maxHeight: '60vh', overflowY: 'auto', minHeight: 0 }}>
            <textarea
              className="field"
              value={aMsg}
              onChange={(e) => {
                setAMsg(e.target.value);
                if (aPhase === 'await' || aPhase === 'done') aReset();
              }}
              placeholder={t('ai.ph')}
              rows={3}
              disabled={aBusy}
              style={{ resize: 'vertical', minHeight: 64, padding: '10px 14px' }}
            />
            <div className="rowline gap8">
              {aImgU ? (
                <img src={aImgU} alt="" style={{ width: 52, height: 40, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
              ) : null}
              <button type="button" className="btn btn--soft btn--sm" disabled={aBusy} onClick={() => aFile.current?.click()}>
                {t('ai.attach')}
              </button>
              {aImgU ? (
                <button type="button" className="btn btn--ghost btn--sm" disabled={aBusy} onClick={() => { setAImgB(null); setAImgU(null); aReset(); }}>
                  {t('ai.remove')}
                </button>
              ) : null}
              <input ref={aFile} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickAgentImg} />
              <span className="grow" />
              <button type="button" className="btn btn--primary" disabled={(!aMsg.trim() && !aImgB) || aBusy} onClick={() => void runAgentPlan()}>
                {aPhase === 'planning' ? t('ai.planning') : t('ai.send')}
              </button>
            </div>

            {aPlan.length ? (
              <div className="col gap6">
                <div className="rowline gap6" style={{ alignItems: 'baseline' }}>
                  <span className="t-sm" style={{ fontWeight: 600 }}>{t('ai.planTitle')}</span>
                  {aPlan.length > 1 ? <span className="t-xs t-faint">{fmt('ai.orderHint', { n: aPlan.length })}</span> : null}
                </div>
                {aPlan.map((s, i) => {
                  const res = aResults?.find((r) => r.index === i);
                  const lines = res
                    ? res.lines
                    : planLines(s, (k, v) => fmt(k, v ?? {})).map((x) => ({ ok: true, text: x }));
                  return (
                    <details key={i}>
                      <summary className="rowline gap6" style={{ cursor: 'pointer', alignItems: 'center' }}>
                        <span className="t-mono t-xs" style={{ color: 'var(--faint)', width: 16, flex: 'none' }}>{i + 1}.</span>
                        <span
                          className="tag"
                          style={V({ color: TOOL_COLOR[s.tool], borderColor: TOOL_COLOR[s.tool], flex: 'none' })}
                        >
                          {t(TOOL_LABEL[s.tool])}
                        </span>
                        <span className="t-sm ellip">{lines[0]?.text ?? '—'}</span>
                        <span className="grow" />
                        <span className="t-xs t-faint" style={{ flex: 'none' }}>{fmt('ai.stepCount', { n: lines.length })}</span>
                        {aPhase === 'await' && !aResults ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            style={V({ color: 'var(--danger)', padding: '0 6px' })}
                            aria-label={t('ai.removeStep')}
                            title={t('ai.removeStep')}
                            onClick={(e) => {
                              e.stopPropagation();
                              dropStep(i);
                            }}
                          >
                            ✕
                          </button>
                        ) : null}
                      </summary>
                      <div className="col gap4" style={{ padding: '4px 0 4px 24px' }}>
                        {lines.map((l, j) => (
                          <div key={j} className="rowline gap6 t-sm">
                            <span style={{ color: res ? (l.ok ? 'var(--present)' : 'var(--danger)') : 'var(--faint)', flex: 'none' }}>
                              {res ? (l.ok ? '✓' : '✗') : '·'}
                            </span>
                            <span>{l.text}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
                {aPhase === 'await' ? (
                  <div className="col gap8">
                    <div className="rowline gap8">
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => void confirmApply()}>
                        {t('ai.approve')}
                      </button>
                      <button type="button" className="btn btn--soft btn--sm" onClick={() => setARevOpen((v) => !v)}>
                        {t('ai.modifyPlan')}
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={aResetAll}>
                        {t('ai.cancelPlan')}
                      </button>
                    </div>
                    {aRevOpen ? (
                      <div className="col gap6">
                        <input
                          className="field"
                          value={aRev}
                          onChange={(e) => setARev(e.target.value)}
                          placeholder={t('ai.revisePh')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void runRevisePlan();
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn--soft btn--sm"
                          disabled={!aRev.trim() || aBusy}
                          onClick={() => void runRevisePlan()}
                        >
                          {aBusy ? t('ai.planning') : t('ai.revise')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {aPhase === 'applying' ? <p className="t-sm t-faint" style={{ margin: 0 }}>{t('ai.applying')}</p> : null}
                {aPhase === 'done' ? (
                  <div className="rowline gap8">
                    {aUndoId != null ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void doAgentUndo()}>
                        {t('ai.undo')}
                      </button>
                    ) : null}
                    <button type="button" className="btn btn--soft btn--sm" onClick={aResetAll}>
                      {t('ai.done')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {aReply ? <p className="t-sm t-faint" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{aReply}</p> : null}
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