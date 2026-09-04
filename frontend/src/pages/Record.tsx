/*
 * whereisit · 登记 / 挪动 (record) — two-mode wizard.
 * Ports screens/record.html: mode A "放新东西" (fresh entry) and mode B "挪动更新"
 * (move/update an existing item). Desktop sticky draft rail, mobile pinned CTA,
 * location bottom-sheet, success card. URL params: ?at=<dirId> pre-selects the
 * destination container; ?move=<slug> jumps straight into mode B for that item.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Wordmark, Seg, Stepper, StatusBadge, ToastsHost } from '../components/ui';
import { TabBar, TabLink } from '../components/TabBar';
import { LocationPicker } from '../components/LocationPicker';
import { catMeta, KNOWN_CAT_LABELS, STATUS } from '../lib/meta';
import { pathNames } from '../lib/tree';
import type { Item, ItemStatus, RecentEntry } from '../lib/types';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';

const V = (o: Record<string, string>): CSSProperties => o as CSSProperties;

type Mode = 'A' | 'B';

type Tone = RecentEntry['tone'];

const STATUS_OPTS: { value: ItemStatus; label: string }[] = (['present', 'lent', 'consumed'] as const).map(
  (v) => ({ value: v, label: STATUS[v].label }),
);

const stLabel = (s: ItemStatus) => STATUS[s].label;

export default function Record() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const toast = useToast((s) => s.push);

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
      toast(`已新增分类「${n}」`);
      setCat(n);
      setNewCatName('');
    }
  };

  const [mode, setMode] = useState<Mode>('A');
  const [slug, setSlug] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
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
      ? '保持原数量'
      : delta > 0
        ? `较原来 +${delta} ${srcItem.unit}`
        : `较原来 −${-delta} ${srcItem.unit}`;
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
  const ctaLabel = mode === 'A' ? '确认登记' : '确认移动';

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
      toast('登记失败 · 无法连接后端');
      return;
    }
    pushRecent({ id: 'r' + Date.now(), verb: '放好', tone: 'present', icon: 'plus', name, sub: pathNames(tree, spot).join(' / '), time: '刚刚' });
    toast(`已登记「${name}」`);
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
      toast('更新失败 · 无法连接后端');
      return;
    }
    const targetSpot = locC && spot ? spot : it.spot;
    let verb = '挪动';
    let tone: Tone = 'present';
    let icon: string = 'move';
    if (!locC && sC) {
      if (status === 'lent') {
        verb = '借出';
        tone = 'lent';
        icon = 'arrow-l';
      } else if (status === 'consumed') {
        verb = '用完';
        tone = 'consumed';
        icon = 'x';
      } else {
        verb = '更新';
        icon = 'tag';
      }
    } else if (qC) {
      verb = '整理';
    }
    pushRecent({ id: 'r' + Date.now(), verb, tone, icon, name: it.name, sub: pathNames(tree, targetSpot).join(' / '), time: '刚刚' });
    toast(`已更新「${it.name}」的位置与状态`);
    setSlug(res.slug);
    setDone(true);
  };

  const goSee = (s: string) => {
    setReveal(s);
    navigate(`/browse?at=${spot}`);
  };

  /* -------- render: status badge inline --------------------------------- */
  const statusBadge = (s: ItemStatus) => <StatusBadge cls={s} label={stLabel(s)} />;

  const previewRows: ReactNode =
    mode === 'A' ? (
      <>
        <PvRow k="名称" v={aName.trim() || <Faint>未填写</Faint>} />
        <PvRow k="类别" v={cat ? catMeta(cat).label : <Faint>未选择</Faint>} />
        <PvRow k="数量" v={`${qty} ${unit}`} mono />
        <PvRow k="状态" v={statusBadge(status)} tail />
        <PvRow k="位置" v={spotPathTxt || <Faint>还没选</Faint>} mono />
      </>
    ) : srcItem ? (
      <>
        <PvRow k="物品" v={srcItem.name} />
        <PvRow k="数量" v={`${qty} ${srcItem.unit}`} mono />
        <PvRow k="状态" v={statusBadge(status)} tail />
        <PvRow k="位置" v={spotPathTxt || <Faint>还没选</Faint>} mono />
      </>
    ) : (
      <div className="empty-state" style={{ padding: '16px 8px' }}>
        <b>还没挑物品</b>
        <span>选一件已有物品来挪动</span>
      </div>
    );

  const ctaSum = (() => {
    if (mode === 'A')
      return aName.trim()
        ? { nm: aName.trim(), pth: spotPathTxt || '还没选位置' }
        : { nm: '尚未填写名称', pth: '', ghost: true };
    if (srcItem) return { nm: srcItem.name, pth: spotPathTxt || '还没选位置' };
    return { nm: '尚未选择物品', pth: '', ghost: true };
  })();

  const locRow = (labelHint?: boolean) => (
    <>
      <div className="between">
        <span className="field-label" style={{ margin: 0 }}>
          位置
          {labelHint ? <span className="hint">必填 · 选一个格子</span> : null}
        </span>
        <button type="button" className="btn--text t-sm" onClick={openPick}>
          更改
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
            <span className="plh">还没选位置</span>
          )}
        </span>
        <span className="btn btn--soft btn--sm" style={V({ pointerEvents: 'none', minHeight: '38px' })}>
          选择
        </span>
      </button>
    </>
  );

  /* -------- stage A: fresh entry --------------------------------------- */
  const stageA = (
    <div className="rec-form">
      <div className="rec-hint">
        <span className="cdot" />同类可多处存在 · 这里登记的是新的一次
      </div>

      <div className="glass-card panel rec-card">
        <div className="between">
          <span className="field-label" style={{ margin: 0 }}>
            名称 <span className="hint">必填</span>
          </span>
        </div>
        <input
          className="field rec-field"
          placeholder="例如 HDMI 线 / 剪刀"
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
                    已在 <span className="mono-path">~/ {pathNames(tree, it.spot).join(' / ')}</span> · 有{' '}
                    {it.qty} {it.unit}「{it.name}」
                  </div>
                  <div className="rec-sug-hint">是同一件？还是想新增一件同类？</div>
                </div>
                <div className="rec-sug-act">
                  <button type="button" className="btn btn--soft btn--sm" onClick={() => pickItem(it.slug)}>
                    去更新它
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => dismiss(it.slug)}>
                    仍要新增
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="rec-hr" />
        <span className="field-label">
          别名 <span className="hint">可选 · 便于搜索</span>
        </span>
        <input
          className="field rec-field"
          placeholder="别名，用逗号分隔"
          autoComplete="off"
          maxLength={40}
          value={aAlias}
          onChange={(e) => setAAlias(e.target.value)}
        />
      </div>

      <div className="glass-card panel rec-card">
        <div className="between">
          <span className="field-label" style={{ margin: 0 }}>
            类别 <span className="hint">必填</span>
          </span>
          {others.length > 0 ? (
            <button
              type="button"
              className="btn--text t-sm"
              aria-expanded={catExpanded}
              onClick={() => setCatExpanded((v) => !v)}
            >
              {catExpanded ? '收起' : `全部类别 (${others.length})`}
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
            placeholder="新类别名称 · 回车新增"
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
            ＋ 新增
          </button>
        </div>
      </div>

      <div className="glass-card panel rec-card">
        <div className="between">
          <span className="field-label" style={{ margin: 0 }}>
            数量 <span className="hint">0–999</span>
          </span>
        </div>
        <div className="rec-field-row">
          <Stepper value={qty} onChange={setQtyV} min={0} max={999} />
          <input
            className="field rec-unit"
            aria-label="单位"
            maxLength={6}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
        <div className="rec-hr" />
        <span className="field-label">状态</span>
        <Seg value={status} onChange={(v) => setStatusV(v as ItemStatus)} options={STATUS_OPTS} />
      </div>

      <div className="glass-card panel rec-card">{locRow(true)}</div>
    </div>
  );

  /* -------- mode B chooser --------------------------------------------- */
  const stageChooser = (
    <div className="rec-form">
      <div className="rec-hint">
        <span className="cdot" />要挪动或更新哪一件？搜索，或直接挑一行。
      </div>
      <div className="glass-card panel rec-card">
        <div className="rec-pick-filter">
          <Icon name="search" />
          <input
            className="field"
            placeholder="搜索物品名称 / 别名…"
            autoComplete="off"
            aria-label="搜索要挪动的物品"
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
              <b>没有「{bQ.trim()}」</b>
              <span>换个名称或别名</span>
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
        <span className="cdot" />挪动 = 同步「位置 / 数量 / 状态」到这次记录
      </div>

      <div className="glass-card panel rec-source">
        <div className="between">
          <span className="section-kicker">当前记录</span>
          <button type="button" className="btn--text t-sm" onClick={toChooser}>
            换个物品
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
            去目录里看
          </Link>
        </div>
      </div>

      <div className="glass-card panel rec-card">
        <div className="between">
          <span className="field-label" style={{ margin: 0 }}>
            数量
          </span>
          <span className="t-xs mono-path" style={V({ color: 'var(--faint)' })}>
            {deltaTxt}
          </span>
        </div>
        <div className="rec-field-row">
          <Stepper value={qty} onChange={setQtyV} min={0} max={999} />
          <span className="t-muted t-sm" style={{ marginLeft: 2 }}>
            {srcItem.name} · 单位 {srcItem.unit}
          </span>
        </div>
      </div>

      <div className="glass-card panel rec-card">
        <span className="field-label">状态</span>
        <Seg value={status} onChange={(v) => setStatusV(v as ItemStatus)} options={STATUS_OPTS} />
      </div>

      <div className="glass-card panel rec-card">{locRow(false)}</div>

      <div className="glass-card panel rec-card">
        <span className="field-label">
          备注 <span className="hint">可选</span>
        </span>
        <input
          className="field rec-field"
          placeholder="例如：借给同事 / 放进箱底"
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
            已放进 <span className="mono-path">~/ {spotPathTxt.replace(/^~\/ /, '')}</span>
          </h2>
          <p className="rec-succ-sub">
            「{aName.trim()}」× {qty} {unit} · {cat ? catMeta(cat).label : ''} · {stLabel(status)}
          </p>
          <div className="rec-succ-actions">
            <button type="button" className="btn btn--soft btn--lg" onClick={startA}>
              再放一个
            </button>
            <Link className="btn btn--primary btn--lg" to={`/browse?at=${spot}`} onClick={() => goSee(slug)}>
              去看看它在哪
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
          已更新 · 现在在 <span className="mono-path">~/ {spotPathTxt.replace(/^~\/ /, '')}</span>
        </h2>
        <p className="rec-succ-sub">
          「{srcItem.name}」× {qty} {srcItem.unit} · {stLabel(status)}
        </p>
        <div className="rec-succ-actions">
          <button type="button" className="btn btn--soft btn--lg" onClick={toChooser}>
            再动一个
          </button>
          <Link className="btn btn--primary btn--lg" to={`/browse?at=${spot}`} onClick={() => goSee(srcItem.slug)}>
            去看看它在哪
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
                  <Link className="chip chip--glass hide-mobile" to="/browse">
                    去目录
                  </Link>
                </div>
              </div>
              <div className="rec-ttl">
                <div style={{ minWidth: 0 }}>
                  <p className="section-kicker rec-eyebrow">登记 · REGISTER</p>
                  <h1 className="rec-h1">{mode === 'A' ? '放新东西' : '挪动更新'}</h1>
                  <p className="rec-sub mono-path">
                    {mode === 'A' ? '登记一次「它在哪」' : '更新某件东西的位置与状态'}
                  </p>
                </div>
                <Seg className="rec-mode-seg" value={mode} onChange={onModeSeg} options={[{ value: 'A', label: '放新东西' }, { value: 'B', label: '挪动更新' }]} />
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
                    <span className="rec-pv-lbl">本次登记 · DRAFT</span>
                    <span className="t-xs t-faint">{mode === 'A' ? '放新东西' : '挪动更新'}</span>
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
          <TabLink to="/" icon="home" label="中枢" />
          <TabLink to="/browse" icon="dir" label="目录" />
          <TabLink to="/record" icon="plus" label="登记" pill current />
        </TabBar>
      </div>

      <LocationPicker
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title={mode === 'A' ? '放到哪里？' : '挪到哪儿？'}
        value={spot}
        onCommit={setSpot}
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
