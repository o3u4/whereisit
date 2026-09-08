/*
 * whereisit · 登记 / 挪动 (record) — two-mode wizard.
 * Ports screens/record.html: mode A "放新东西" (fresh entry) and mode B "挪动更新"
 * (move/update an existing item). Desktop sticky draft rail, mobile pinned CTA,
 * location bottom-sheet, success card. URL params: ?at=<dirId> pre-selects the
 * destination container; ?move=<slug> jumps straight into mode B for that item.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Wordmark, Seg, Stepper, StatusBadge, ToastsHost } from '../components/ui';
import { TabBar, TabLink } from '../components/TabBar';
import { LocationPicker } from '../components/LocationPicker';
import { NewPathSheet } from '../components/NewPathSheet';
import { catMeta, KNOWN_CAT_LABELS } from '../lib/meta';
import { pathNames } from '../lib/tree';
import type { Item, ItemStatus, RecentEntry } from '../lib/types';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';
import { useTr } from '../i18n';

const V = (o: Record<string, string>): CSSProperties => o as CSSProperties;

type Mode = 'A' | 'B';

type Tone = RecentEntry['tone'];

const STATUS_LIST: ItemStatus[] = ['present', 'lent', 'consumed'];

export default function Record() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { t, fmt } = useTr();
  const stText = (s: ItemStatus) => t('status.' + s);
  const statusOpts = STATUS_LIST.map((v) => ({ value: v, label: t('status.' + v) }));
  const [search] = useSearchParams();
  const toast = useToast((s) => s.push);

  /* return to whichever page opened this wizard (that browse path or the hub) */
  const goBack = () => {
    if (loc.key !== 'default') navigate(-1);
    else navigate('/');
  };

  const items = useCatalog((s) => s.items);
  const tree = useCatalog((s) => s.tree);
  const categories = useCatalog((s) => s.categories);
  const addCategory = useCatalog((s) => s.addCategory);
  const ready = useCatalog((s) => s.ready);
  const addItem = useCatalog((s) => s.addItem);
  const commit = useCatalog((s) => s.commit);
  const pushRecent = useCatalog((s) => s.pushRecent);
  const setReveal = useCatalog((s) => s.setReveal);

  /* category picker: frequent ones always visible, rest under an expand, + add-new */
  const demoChoices = KNOWN_CAT_LABELS.map((n) => ({ id: n, name: n }));
  const freq =
    categories.length > 0
      ? [...categories].sort((a, b) => b.itemCount - a.itemCount).slice(0, 4)
      : demoChoices;
  const freqNames = new Set(freq.map((c) => c.name));
  const others = categories.length > 0 ? categories.filter((c) => !freqNames.has(c.name)) : [];

  const catChip = (id: number | string, name: string) => (
    <button
      key={id}
      type="button"
      className={`rec-cat${cat === name ? ' rec-cat--on' : ''}`}
      aria-pressed={cat === name}
      onClick={() => setCat(name)}
      style={V({ ['--tc']: catMeta(name).tint })}
    >
      <Icon name={catMeta(name).icon} />
      {name}
    </button>
  );

  const addNewCat = async () => {
    const n = newCatName.trim();
    if (!n) return;
    if (await addCategory(n)) {
      toast(fmt('rec.catAdded', { name: n }));
      setCat(n);
      setNewCatName('');
    }
  };

  const [mode, setMode] = useState<Mode>('A');
  const [slug, setSlug] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [npsOpen, setNpsOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [catExpanded, setCatExpanded] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  /* fields (A name/alias live under their own inputs; qty/unit/status/spot shared) */
  const [aName, setAName] = useState('');
  const [aAlias, setAAlias] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [qty, setQtyV] = useState(1);
  const [unit, setUnit] = useState('件');
  const [status, setStatusV] = useState<ItemStatus>('present');
  const [note, setNote] = useState('');
  const [spot, setSpot] = useState<string | null>(null);
  const [diss, setDiss] = useState<string[]>([]);
  const [bQ, setBQ] = useState('');

  /* seed from URL params once the catalog has loaded (deep-link may land before fetch) */
  const booted = useRef(false);
  useEffect(() => {
    if (!ready || booted.current) return;
    booted.current = true;
    const mv = search.get('move');
    const at = search.get('at');
    if (mv) {
      const it = useCatalog.getState().items.find((i) => i.slug === mv);
      if (it) {
        setMode('B');
        setSlug(mv);
        setQtyV(it.qty);
        setUnit(it.unit);
        setStatusV(it.status);
        setSpot(at || it.spot);
        setDone(false);
      } else if (at) {
        setSpot(at);
      }
    } else if (at) {
      setSpot(at);
    }
    // booted.current guards re-seeding when `search` changes after the first run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, search]);

  const srcItem = slug ? items.find((i) => i.slug === slug) ?? null : null;
  const spotPath = (id: string) => '~/ ' + pathNames(tree, id).join(' / ');
  const spotPathTxt = spot ? spotPath(spot) : '';

  const openPick = () => setPickOpen(true);

  /* -------- transitions ------------------------------------------------ */
  const startA = () => {
    setMode('A');
    setSlug(null);
    setCat(null);
    setQtyV(1);
    setUnit('件');
    setStatusV('present');
    setAName('');
    setAAlias('');
    setNote('');
    setSpot(search.get('at') || null);
    setDiss([]);
    setDone(false);
  };
  const toChooser = () => {
    setSlug(null);
    setQtyV(1);
    setStatusV('present');
    setCat(null);
    setDone(false);
  };
  const onModeSeg = (v: string) => {
    if (done) return;
    if (v === 'A') {
      if (mode !== 'A') startA();
    } else if (mode !== 'B') {
      setMode('B');
      toChooser();
    }
  };
  const pickItem = (s: string) => {
    const it = items.find((i) => i.slug === s);
    if (!it) return;
    setSlug(s);
    setQtyV(it.qty);
    setUnit(it.unit);
    setStatusV(it.status);
    setNote('');
    setSpot(search.get('at') || it.spot);
    setDone(false);
  };

  /* -------- mode A suggest ("已存在?" reminder) ------------------------- */
  const q = aName.trim().toLowerCase();
  const suggestHits =
    mode === 'A' && q.length >= 2
      ? items
          .filter(
            (it) => !diss.includes(it.slug) && (it.name + ' ' + it.alias).toLowerCase().includes(q),
          )
          .slice(0, 2)
      : [];
  const dismiss = (s: string) => setDiss((d) => [...d, s]);

  /* -------- mode B chooser filter -------------------------------------- */
  const bQuery = bQ.trim().toLowerCase();
  const bList = bQuery
    ? items.filter((it) => (it.name + ' ' + it.alias + ' ' + it.cat).toLowerCase().includes(bQuery))
    : items;

  /* -------- CTA validity ------------------------------------------------ */
  const delta = srcItem ? qty - srcItem.qty : 0;
  const deltaTxt = !srcItem
    ? ''
    : delta === 0
      ? t('rec.keepQty')
      : delta > 0
        ? fmt('rec.deltaMore', { n: delta, unit: srcItem.unit })
        : fmt('rec.deltaLess', { n: -delta, unit: srcItem.unit });
  const changed =
    srcItem !== null &&
    (spot !== srcItem.spot || qty !== srcItem.qty || status !== srcItem.status);
  const validQty = qty >= 1;
  const ok =
    mode === 'A'
      ? validQty && !!cat && !!spot && aName.trim().length > 0
      : srcItem
        ? changed && validQty
        : false;
  const ctaLabel = mode === 'A' ? t('rec.ctaA') : t('rec.ctaB');

  const busyRef = useRef(false);
  const confirm = async () => {
    if (!ok || busyRef.current) return;
    busyRef.current = true;
    try {
      if (mode === 'A') await confirmA();
      else if (srcItem) await confirmB(srcItem);
    } finally {
      busyRef.current = false;
    }
  };

  const confirmA = async () => {
    const name = aName.trim();
    if (!cat || !spot || !name) return;
    const s = await addItem({
      name,
      alias: aAlias.trim() || undefined,
      qty: Math.max(1, qty),
      unit: unit.trim() || '件',
      cat,
      status,
      spot,
    });
    if (!s) {
      toast(t('rec.regFail'));
      return;
    }
    pushRecent({ id: 'r' + Date.now(), verb: t('rec.verbPlaced'), tone: 'present', icon: 'plus', name, slug: s, spot, sub: pathNames(tree, spot).join(' / '), time: t('recent.justNow') });
    toast(fmt('rec.regToast', { name }));
    setSlug(s);
    setDone(true);
  };

  const confirmB = async (it: Item) => {
    const locC = spot !== it.spot;
    const qC = qty !== it.qty;
    const sC = status !== it.status;
    if (!(locC || qC || sC)) return;
    const res = await commit(it.slug, {
      spot: locC && spot ? spot : undefined,
      qty: qC ? Math.max(1, qty) : undefined,
      status: sC ? status : undefined,
    });
    if (!res) {
      toast(t('rec.updateFail'));
      return;
    }
    const targetSpot = locC && spot ? spot : it.spot;
    let verb = t('rec.verbMoved');
    let tone: Tone = 'present';
    let icon: string = 'move';
    if (!locC && sC) {
      if (status === 'lent') {
        verb = t('rec.verbLent');
        tone = 'lent';
        icon = 'arrow-l';
      } else if (status === 'consumed') {
        verb = t('rec.verbConsumed');
        tone = 'consumed';
        icon = 'x';
      } else {
        verb = t('rec.verbUpdated');
        icon = 'tag';
      }
    } else if (qC) {
      verb = t('rec.verbTidy');
    }
    pushRecent({ id: 'r' + Date.now(), verb, tone, icon, name: it.name, slug: res.slug, spot: targetSpot, sub: pathNames(tree, targetSpot).join(' / '), time: t('recent.justNow') });
    toast(fmt('rec.updateToast', { name: it.name }));
    setSlug(res.slug);
    setDone(true);
  };

  const goSee = (s: string) => {
    setReveal(s);
    navigate(`/browse?at=${spot}`);
  };

  /* -------- render: status badge inline --------------------------------- */
  const statusBadge = (s: ItemStatus) => <StatusBadge cls={s} label={stText(s)} />;

  const previewRows: ReactNode =
    mode === 'A' ? (
      <>
        <PvRow k={t('rec.kName')} v={aName.trim() || <Faint>{t('rec.notFilled')}</Faint>} />
        <PvRow k={t('rec.kCat')} v={cat ? catMeta(cat).label : <Faint>{t('rec.notChosen')}</Faint>} />
        <PvRow k={t('rec.kQty')} v={`${qty} ${unit}`} mono />
        <PvRow k={t('rec.kStatus')} v={statusBadge(status)} tail />
        <PvRow k={t('rec.kPos')} v={spotPathTxt || <Faint>{t('rec.noSpot')}</Faint>} mono />
      </>
    ) : srcItem ? (
      <>
        <PvRow k={t('rec.kItem')} v={srcItem.name} />
        <PvRow k={t('rec.kQty')} v={`${qty} ${srcItem.unit}`} mono />
        <PvRow k={t('rec.kStatus')} v={statusBadge(status)} tail />
        <PvRow k={t('rec.kPos')} v={spotPathTxt || <Faint>{t('rec.noSpot')}</Faint>} mono />
      </>
    ) : (
      <div className="empty-state" style={{ padding: '16px 8px' }}>
        <b>{t('rec.noItemChosen')}</b>
        <span>{t('rec.noItemChosenHint')}</span>
      </div>
    );

  const ctaSum = (() => {
    if (mode === 'A')
      return aName.trim()
        ? { nm: aName.trim(), pth: spotPathTxt || t('rec.noSpotTxt') }
        : { nm: t('rec.noName'), pth: '', ghost: true };
    if (srcItem) return { nm: srcItem.name, pth: spotPathTxt || t('rec.noSpotTxt') };
    return { nm: t('rec.noItem'), pth: '', ghost: true };
  })();

  const locRow = (labelHint?: boolean) => (
    <>
      <div className="between">
        <span className="field-label" style={{ margin: 0 }}>
          {t('rec.kPos')}
          {labelHint ? <span className="hint">{t('rec.locHint')}</span> : null}
        </span>
        <button type="button" className="btn--text t-sm" onClick={openPick}>
          {t('rec.locChange')}
        </button>
      </div>
      <button type="button" className="rec-locrow" onClick={openPick}>
        <span className="rec-locglyph">
          <Icon name="locate" />
        </span>
        <span className="rec-locval">
          {spotPathTxt ? (
            <span>{spotPathTxt}</span>
          ) : (
            <span className="plh">{t('rec.noSpotTxt')}</span>
          )}
        </span>
        <span className="btn btn--soft btn--sm" style={V({ pointerEvents: 'none', minHeight: '38px' })}>
          {t('rec.locSelect')}
        </span>
      </button>
      <button type="button" className="btn--text t-sm" style={{ marginTop: 6 }} onClick={() => setNpsOpen(true)}>
        ＋ {t('new.create')}
      </button>
    </>
  );

  /* -------- stage A: fresh entry --------------------------------------- */
  const stageA = (
    <div className="rec-form">
      <div className="rec-hint">
        <span className="cdot" />{t('rec.hintMulti')}
      </div>

      <div className="glass-card panel rec-card">
        <div className="between">
          <span className="field-label" style={{ margin: 0 }}>
            {t('rec.kName')} <span className="hint">{t('rec.nameReq')}</span>
          </span>
        </div>
        <input
          className="field rec-field"
          placeholder={t('rec.namePh')}
          autoComplete="off"
          maxLength={30}
          value={aName}
          onChange={(e) => setAName(e.target.value)}
          autoFocus
        />
        {suggestHits.length > 0 ? (
          <div className="rec-suggest-region">
            {suggestHits.map((it) => (
              <div key={it.slug} className="glass-card rec-suggest in">
                <div className="rec-sug-ic">
                  <Icon name="locate" />
                </div>
                <div className="rec-sug-txt">
                  <div className="rec-sug-line">
                    {fmt('rec.alreadyAt', { path: `~/ ${pathNames(tree, it.spot).join(' / ')}`, qty: it.qty, unit: it.unit, name: it.name })}
                  </div>
                  <div className="rec-sug-hint">{t('rec.sameOrNew')}</div>
                </div>
                <div className="rec-sug-act">
                  <button type="button" className="btn btn--soft btn--sm" onClick={() => pickItem(it.slug)}>
                    {t('rec.goUpdate')}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => dismiss(it.slug)}>
                    {t('rec.stillNew')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="rec-hr" />
        <span className="field-label">
          {t('rec.kAlias')} <span className="hint">{t('rec.aliasHint')}</span>
        </span>
        <input
          className="field rec-field"
          placeholder={t('rec.aliasPh')}
          autoComplete="off"
          maxLength={40}
          value={aAlias}
          onChange={(e) => setAAlias(e.target.value)}
        />
      </div>

      <div className="glass-card panel rec-card">
        <div className="between">
          <span className="field-label" style={{ margin: 0 }}>
            {t('rec.kCat')} <span className="hint">{t('rec.nameReq')}</span>
          </span>
          {others.length > 0 ? (
            <button
              type="button"
              className="btn--text t-sm"
              aria-expanded={catExpanded}
              onClick={() => setCatExpanded((v) => !v)}
            >
              {catExpanded ? t('rec.catCollapse') : fmt('rec.catAll', { n: others.length })}
            </button>
          ) : null}
        </div>
        <div className="rec-cats">{freq.map((c) => catChip(c.id, c.name))}</div>
        {catExpanded && others.length > 0 ? (
          <div className="rec-cats" style={{ marginTop: 9 }}>
            {others.map((c) => catChip(c.id, c.name))}
          </div>
        ) : null}
        <div className="rec-addrow">
          <input
            className="field"
            placeholder={t('rec.newCatPh')}
            maxLength={12}
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addNewCat();
            }}
          />
          <button
            type="button"
            className="btn btn--soft btn--sm"
            disabled={!newCatName.trim()}
            onClick={() => void addNewCat()}
          >
            {t('rec.addCat')}
          </button>
        </div>
      </div>

      <div className="glass-card panel rec-card">
        <div className="between">
          <span className="field-label" style={{ margin: 0 }}>
            {t('rec.kQty')} <span className="hint">{t('rec.qtyHint')}</span>
          </span>
        </div>
        <div className="rec-field-row">
          <Stepper value={qty} onChange={setQtyV} min={0} max={999} />
          <input
            className="field rec-unit"
            aria-label={t('rec.unitAria')}
            maxLength={6}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
        <div className="rec-hr" />
        <span className="field-label">{t('rec.kStatus')}</span>
        <Seg value={status} onChange={(v) => setStatusV(v as ItemStatus)} options={statusOpts} />
      </div>

      <div className="glass-card panel rec-card">{locRow(true)}</div>
    </div>
  );

  /* -------- mode B chooser --------------------------------------------- */
  const stageChooser = (
    <div className="rec-form">
      <div className="rec-hint">
        <span className="cdot" />{t('rec.hintMove')}
      </div>
      <div className="glass-card panel rec-card">
        <div className="rec-pick-filter">
          <Icon name="search" />
          <input
            className="field"
            placeholder={t('rec.bSearchPh')}
            autoComplete="off"
            aria-label={t('rec.bSearchAria')}
            value={bQ}
            onChange={(e) => setBQ(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bList.map((it) => (
            <button key={it.slug} type="button" className="glass-card rec-bitem" onClick={() => pickItem(it.slug)}>
              <span className="rec-src-glyph" style={V({ ['--tc']: catMeta(it.cat).tint })}>
                <Icon name={catMeta(it.cat).icon} />
              </span>
              <span className="rec-src-main">
                <span className="rec-src-name">
                  <b>{it.name}</b>
                  {statusBadge(it.status)}
                </span>
                <span className="rec-src-path">~/ {pathNames(tree, it.spot).join(' / ')}</span>
              </span>
              <span className="rec-qty">
                <span className="times">×</span>
                {it.qty} {it.unit}
              </span>
              <Icon name="chev" size={16} style={V({ color: 'var(--faint)', flex: 'none' })} />
            </button>
          ))}
          {bList.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 4 }}>
              <b>{fmt('rec.bEmpty', { q: bQ.trim() })}</b>
              <span>{t('rec.bEmptyHint')}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  /* -------- stage B: move/update form ---------------------------------- */
  const stageB = srcItem ? (
    <div className="rec-form">
      <div className="rec-hint">
        <span className="cdot" />{t('rec.hintSync')}
      </div>

      <div className="glass-card panel rec-source">
        <div className="between">
          <span className="section-kicker">{t('rec.curRecord')}</span>
          <button type="button" className="btn--text t-sm" onClick={toChooser}>
            {t('rec.switchItem')}
          </button>
        </div>
        <div className="rec-src-row">
          <span className="rec-src-glyph" style={V({ ['--tc']: catMeta(srcItem.cat).tint })}>
            <Icon name={catMeta(srcItem.cat).icon} />
          </span>
          <span className="rec-src-main">
            <span className="rec-src-name">
              <b>{srcItem.name}</b>
              {statusBadge(srcItem.status)}
            </span>
            <span className="rec-src-path">~/ {pathNames(tree, srcItem.spot).join(' / ')}</span>
          </span>
        </div>
        <div className="between" style={{ gap: 10 }}>
          <span className="t-xs t-muted mono-path">
            {srcItem.qty} {srcItem.unit}
          </span>
          <Link className="btn--text t-sm" to={`/browse?at=${srcItem.spot}`}>
            {t('rec.viewInTree')}
          </Link>
        </div>
      </div>

      <div className="glass-card panel rec-card">
        <div className="between">
          <span className="field-label" style={{ margin: 0 }}>
            {t('rec.kQty')}
          </span>
          <span className="t-xs mono-path" style={V({ color: 'var(--faint)' })}>
            {deltaTxt}
          </span>
        </div>
        <div className="rec-field-row">
          <Stepper value={qty} onChange={setQtyV} min={0} max={999} />
          <span className="t-muted t-sm" style={{ marginLeft: 2 }}>
            {fmt('rec.unitOf', { name: srcItem.name, unit: srcItem.unit })}
          </span>
        </div>
      </div>

      <div className="glass-card panel rec-card">
        <span className="field-label">{t('rec.kStatus')}</span>
        <Seg value={status} onChange={(v) => setStatusV(v as ItemStatus)} options={statusOpts} />
      </div>

      <div className="glass-card panel rec-card">{locRow(false)}</div>

      <div className="glass-card panel rec-card">
        <span className="field-label">
          {t('item.notes')} <span className="hint">{t('rec.notesHint')}</span>
        </span>
        <input
          className="field rec-field"
          placeholder={t('rec.notesPh')}
          autoComplete="off"
          maxLength={60}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </div>
  ) : (
    stageChooser
  );

  const stage = mode === 'A' ? stageA : stageB;

  /* -------- success ----------------------------------------------------- */
  const success = mode === 'A' ? (
    slug ? (
      <div className="rec-success">
        <div className="glass-card panel rec-succ-card in d1">
          <div className="rec-check">
            <Icon name="check" />
          </div>
          <h2 className="rec-succ-h">
            {fmt('rec.doneA', { path: spotPathTxt.replace(/^~\/ /, '') })}
          </h2>
          <p className="rec-succ-sub">
            {fmt('rec.doneSubA', { name: aName.trim(), qty, unit, cat: cat ? catMeta(cat).label : '', status: stText(status) })}
          </p>
          <div className="rec-succ-actions">
            <button type="button" className="btn btn--soft btn--lg" onClick={startA}>
              {t('rec.againA')}
            </button>
            <Link className="btn btn--primary btn--lg" to={`/browse?at=${spot}`} onClick={() => goSee(slug)}>
              {t('rec.seeIt')}
            </Link>
          </div>
        </div>
      </div>
    ) : null
  ) : srcItem ? (
    <div className="rec-success">
      <div className="glass-card panel rec-succ-card in d1">
        <div className="rec-check">
          <Icon name="check" />
        </div>
        <h2 className="rec-succ-h">
          {fmt('rec.doneB', { path: spotPathTxt.replace(/^~\/ /, '') })}
        </h2>
        <p className="rec-succ-sub">
          {fmt('rec.doneSubB', { name: srcItem.name, qty, unit: srcItem.unit, status: stText(status) })}
        </p>
        <div className="rec-succ-actions">
          <button type="button" className="btn btn--soft btn--lg" onClick={toChooser}>
            {t('rec.againB')}
          </button>
          <Link className="btn btn--primary btn--lg" to={`/browse?at=${spot}`} onClick={() => goSee(srcItem.slug)}>
            {t('rec.seeIt')}
          </Link>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="tone-record">
      <div className="wall" aria-hidden="true">
        <i className="blob b1" />
        <i className="blob b2" />
        <i className="blob b3" />
        <i className="blob b4" />
      </div>

      <div className="shell">
        <div className="wrap">
          <header className="topglass glass in">
            <div className="rec-head">
              <div className="rec-tbrow">
                <Wordmark />
                <div className="hd-group">
                  <button type="button" className="chip chip--glass" onClick={goBack} aria-label={t('rec.ariaBack')}>
                    <Icon name="arrow-l" size={14} />
                    {t('rec.back')}
                  </button>
                  <Link className="chip chip--glass" to="/">
                    <Icon name="home" size={14} />
                    {t('rec.hub')}
                  </Link>
                  <Link className="chip chip--glass hide-mobile" to="/browse">
                    {t('rec.browse')}
                  </Link>
                </div>
              </div>
              <div className="rec-ttl">
                <div style={{ minWidth: 0 }}>
                  <p className="section-kicker rec-eyebrow">{t('rec.regKicker')}</p>
                  <h1 className="rec-h1">{mode === 'A' ? t('rec.titleA') : t('rec.titleB')}</h1>
                  <p className="rec-sub mono-path">
                    {mode === 'A' ? t('rec.subA') : t('rec.subB')}
                  </p>
                </div>
                <Seg className="rec-mode-seg" value={mode} onChange={onModeSeg} options={[{ value: 'A', label: t('rec.titleA') }, { value: 'B', label: t('rec.titleB') }]} />
              </div>
            </div>
          </header>

          <main>
            {done && success ? (
              success
            ) : (
              <div className="rec-layout">
                <div className="rec-stage" aria-live="polite">
                  {stage}
                </div>
                <aside className="rec-rail glass-card panel">
                  <div className="rec-rail-head">
                    <span className="rec-pv-lbl">{t('rec.draftLbl')}</span>
                    <span className="t-xs t-faint">{mode === 'A' ? t('rec.titleA') : t('rec.titleB')}</span>
                  </div>
                  <div className="hr" />
                  <div className="rec-rail-prev">{previewRows}</div>
                  <div className="grow" />
                  <button type="button" className="btn btn--primary btn--lg" disabled={!ok} onClick={confirm}>
                    {ctaLabel}
                  </button>
                </aside>
              </div>
            )}
          </main>
        </div>

        {!done ? (
          <div className="rec-cta-bar glass-card">
            <div className="rec-cta-sum">
              <span className="nm" style={ctaSum.ghost ? V({ color: 'var(--faint)' }) : undefined}>
                {ctaSum.nm}
              </span>
              {ctaSum.pth ? <span className="pth">{ctaSum.pth}</span> : null}
            </div>
            <button type="button" className="btn btn--primary" disabled={!ok} onClick={confirm}>
              {ctaLabel}
            </button>
          </div>
        ) : null}

        <TabBar>
          <TabLink to="/" icon="home" label={t('nav.hub')} />
          <TabLink to="/browse" icon="dir" label={t('nav.browse')} />
          <TabLink to="/record" icon="plus" label={t('nav.recordPill')} pill current />
        </TabBar>
      </div>

      <LocationPicker
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title={mode === 'A' ? t('rec.toWhereA') : t('rec.toWhereB')}
        value={spot}
        onCommit={setSpot}
      />
      <NewPathSheet
        open={npsOpen}
        onClose={() => setNpsOpen(false)}
        basePathNames={[]}
        onCreated={(id) => {
          setNpsOpen(false);
          setSpot(String(id));
        }}
      />

      <ToastsHost />
    </div>
  );
}

/* small preview-row helper for the draft rail */
function PvRow({ k, v, mono, tail }: { k: string; v: ReactNode; mono?: boolean; tail?: boolean }) {
  return (
    <div className="rec-pv-item">
      <span className="rec-pv-lbl" style={{ width: 52 }}>
        {k}
      </span>
      {mono ? (
        <span className="mono-path grow">{v}</span>
      ) : (
        <span className="grow ellip">{v}</span>
      )}
      {tail ? <span className="grow" /> : null}
    </div>
  );
}

function Faint({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--faint)' }}>{children}</span>;
}
