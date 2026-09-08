/*
 * whereisit · 空间目录 (browse) — the tree path walker.
 * Ports screens/browse.html: sticky space-tree rail, path spine crumbs, and a
 * content pane that shows either the top scene grid or the current container's
 * folders / items. Drag a folder tile or an item row onto any container
 * (rail node, folder tile, ancestor crumb) to "move" it. URL ?at=<dirId> opens
 * a container; store.reveal auto-opens an item's detail after record success.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, TYPE_ICON } from '../components/icons';
import { Wordmark, Seg, Sheet, StatusBadge, ToastsHost } from '../components/ui';
import { TabBar, TabLink } from '../components/TabBar';
import { ItemSheet } from '../components/ItemSheet';
import { NewPathSheet } from '../components/NewPathSheet';
import { catMeta, TYPE_TINT } from '../lib/meta';
import { chainOf, countItemsIn, dirById, directItemsIn, pathNames, sceneTint } from '../lib/tree';
import type { DirNode, Item } from '../lib/types';
import * as api from '../api/client';
import { useMedia } from '../hooks/useMedia';
import { useCatalog } from '../stores/catalog';
import { useOverlay } from '../stores/overlay';
import { useToast } from '../stores/toast';
import { useTr } from '../i18n';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

type View = 'all' | 'folders' | 'items';
type Drag = { kind: 'folder' | 'item'; id: string };

export default function Browse() {
  const navigate = useNavigate();
  const { t, fmt } = useTr();
  const [search] = useSearchParams();
  const toast = useToast((s) => s.push);

  const items = useCatalog((s) => s.items);
  const tree = useCatalog((s) => s.tree);
  const reveal = useCatalog((s) => s.reveal);
  const setReveal = useCatalog((s) => s.setReveal);
  const moveItem = useCatalog((s) => s.moveItem);
  const moveDir = useCatalog((s) => s.moveDir);
  const mergeDefs = useCatalog((s) => s.mergeDefs);

  const atParam = search.get('at');
  const [cur, setCur] = useState<string | null>(() =>
    atParam && dirById(tree, atParam) ? atParam : null,
  );
  const [view, setView] = useState<View>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [itemSlug, setItemSlug] = useState<string | null>(null);
  const [dragId, setDragId] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [overItem, setOverItem] = useState<string | null>(null);
  /* inline batch-merge: pick a keep row (○) then check rows to fold into it */
  const [mergeOn, setMergeOn] = useState(false);
  const [keepSlug, setKeepSlug] = useState<string | null>(null);
  const [fold, setFold] = useState<ReadonlySet<string>>(new Set());
  const dragRef = useRef<Drag | null>(null);

  /* URL drives the current container (keeps back/forward + reveal coherent) */
  useEffect(() => {
    const v = atParam && dirById(tree, atParam) ? atParam : null;
    setCur(v);
    if (v) {
      const ids = chainOf(tree, v).map((n) => n.id);
      setExpanded((prev) => {
        const next = { ...prev };
        ids.forEach((id) => (next[id] = true));
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atParam, tree]);

  /* one-shot reveal from record success: pop the detail sheet */
  const [revealDone, setRevealDone] = useState(false);
  useEffect(() => {
    if (reveal && !revealDone) {
      setRevealDone(true);
      if (items.some((i) => i.slug === reveal)) setItemSlug(reveal);
      setReveal(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, revealDone]);

  const goDir = (id: string | null) => {
    if (id === cur) return;
    setMergeOn(false);
    setKeepSlug(null);
    setFold(new Set());
    navigate('/browse' + (id ? `?at=${id}` : ''));
  };

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const curQS = cur ? `?at=${cur}` : '';
  const itemOf = (slug: string) => items.find((i) => i.slug === slug) ?? null;
  const curNode = cur ? dirById(tree, cur) : null;
  const direct = cur ? directItemsIn(items, cur) : [];
  const globalSlug = useOverlay((s) => s.itemSlug);
  /* only the topmost detail shows: a search-opened (global) detail closes this
     page's local one; picking an item here closes any global detail under it */
  useEffect(() => {
    if (globalSlug) setItemSlug(null);
  }, [globalSlug]);
  const openItem = (slug: string) => {
    useOverlay.getState().closeItem();
    setItemSlug(slug);
  };
  const item = itemSlug ? itemOf(itemSlug) : null;

  const spaceId = cur ? (Number.isNaN(Number(cur)) ? null : Number(cur)) : null;
  const [spaceImgNonce, setSpaceImgNonce] = useState(0);
  const [spaceImgAct, setSpaceImgAct] = useState(false);
  const spimgInput = useRef<HTMLInputElement>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const toggleTreeAll = () => {
    const next = !treeOpen;
    setTreeOpen(next);
    setTreeExpanded(next);
  };
  const [npsOpen, setNpsOpen] = useState(false);
  const [npsBase, setNpsBase] = useState<string[]>([]);
  const openCreate = (base: string[]) => {
    setNpsBase(base);
    setNpsOpen(true);
  };

  const setTreeExpanded = (on: boolean) => {
    const ids: Record<string, boolean> = {};
    if (on) {
      const walk = (ns: DirNode[]) => {
        for (const n of ns) {
          if (n.kids.length) {
            ids[n.id] = true;
            walk(n.kids);
          }
        }
      };
      walk(tree);
    }
    setExpanded(ids);
  };

  const doDeleteSpace = async () => {
    if (!cur) return;
    if (!window.confirm(t('space.deleteQ'))) return;
    try {
      await api.deleteSpace(Number(cur));
      await useCatalog.getState().load();
      navigate('/browse');
    } catch {
      toast(t('item.deleteFail'));
    }
  };
  const { url: spaceImg, hasImage: spaceHasImage } = useMedia('space', spaceId, !!spaceId, spaceImgNonce);

  const pickSpaceImg = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || spaceId == null) return;
    try {
      await api.uploadMedia('space', spaceId, f);
      setSpaceImgNonce((n) => n + 1);
    } catch {
      toast(t('item.imgFail'));
    }
  };

  const pickRemoveSpaceImg = async () => {
    if (spaceId == null) return;
    await api.deleteMedia('space', spaceId);
    setSpaceImgNonce((n) => n + 1);
  };

  /* -------- inline batch merge (batch twin of item→item drag) ----------- */
  const keepItem = keepSlug ? itemOf(keepSlug) : null;
  const foldCount = [...fold].filter((s) => {
    const it = itemOf(s);
    return !!it && it.defId !== keepItem?.defId;
  }).length;
  const exitMerge = () => {
    setMergeOn(false);
    setKeepSlug(null);
    setFold(new Set());
  };
  const enterMerge = () => {
    setMergeOn(true);
    setKeepSlug(null);
    setFold(new Set());
  };
  const pickKeep = (slug: string) => {
    setKeepSlug(slug);
    setFold(new Set());
  };
  const toggleFold = (slug: string) => {
    if (slug === keepSlug) return;
    setFold((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };
  const runMerge = async () => {
    const keep = keepItem;
    if (!keep) return;
    const targets = new Set<number>();
    for (const s of fold) {
      const it = itemOf(s);
      if (it && it.defId !== keep.defId) targets.add(it.defId);
    }
    let ok = 0;
    for (const defId of targets) if (await mergeDefs(keep.defId, defId)) ok += 1;
    if (ok > 0) toast(fmt('browse.mergeToast', { n: ok, name: keep.name }));
    exitMerge();
  };

  /* -------- drag & drop ------------------------------------------------ */
  const canDrop = (id: string): boolean => {
    const d = dragRef.current;
    if (!d || !dirById(tree, id)) return false;
    if (d.kind === 'item') {
      const it = itemOf(d.id);
      return !!it && id !== it.spot;
    }
    const node = dirById(tree, d.id);
    if (!node || id === d.id) return false;
    if (dirById([node], id)) return false; // target inside own subtree
    if (chainOf(tree, d.id).some((x) => x.id === id)) return false; // target = own ancestor
    return true;
  };

  const dropH = (id: string) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (canDrop(id)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== id) setOver(id);
      }
    },
    onDragLeave: () => {
      if (over === id) setOver(null);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (d && canDrop(id)) {
        e.preventDefault();
        perform(d, id);
      }
      dragRef.current = null;
      setDragId(null);
      setOver(null);
      setOverItem(null);
    },
  });

  const dragSrc = (kind: Drag['kind'], id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `${kind}:${id}`);
      dragRef.current = { kind, id };
      setDragId({ kind, id });
    },
    onDragEnd: () => {
      dragRef.current = null;
      setDragId(null);
      setOver(null);
      setOverItem(null);
    },
  });

  const perform = (d: Drag, targetId: string) => {
    const tName = dirById(tree, targetId)?.name ?? targetId;
    if (d.kind === 'item') {
      const it = itemOf(d.id);
      if (!it || it.spot === targetId) return;
      moveItem(d.id, targetId);
      toast(fmt('browse.movedToast', { name: it.name, target: tName }));
      goDir(targetId);
    } else {
      const node = dirById(tree, d.id);
      if (!node) return;
      moveDir(d.id, targetId);
      toast(fmt('browse.dirMergedToast', { name: node.name, target: tName }));
      setExpanded((e) => ({ ...e, [targetId]: true }));
    }
  };

  /* drop an item row onto another row = merge the two defs (different defs only) */
  const mergeOk = (d: Drag | null, t: Item): d is Drag =>
    !!d && d.kind === 'item' && d.id !== t.slug && (() => {
      const src = itemOf(d.id);
      return !!src && src.defId !== t.defId;
    })();

  const mergeDropH = (t: Item) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (mergeOk(dragRef.current, t)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overItem !== t.slug) setOverItem(t.slug);
      }
    },
    onDragLeave: () => {
      if (overItem === t.slug) setOverItem(null);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const d = dragRef.current;
      const ok = mergeOk(d, t);
      if (ok) {
        e.preventDefault();
        const src = itemOf(d.id);
        if (src) {
          void (async () => {
            if (await mergeDefs(t.defId, src.defId)) {
              toast(fmt('browse.itemMergedToast', { src: src.name, dst: t.name }));
            }
          })();
        }
      }
      dragRef.current = null;
      setDragId(null);
      setOver(null);
      setOverItem(null);
    },
  });

  /* -------- small render helpers ---------------------------------------- */
  const stBadge = (it: Item) => <StatusBadge cls={it.status} label={t('status.' + it.status)} />;
  const catColor = (it: Item) => catMeta(it.cat).tint;
  const catLabel = (it: Item) => catMeta(it.cat).label;

  const relMono = (it: Item) => {
    const chain = chainOf(tree, it.spot);
    if (!cur) return '~/ ' + chain.map((n) => n.name).join(' / ');
    const idx = chain.findIndex((n) => n.id === cur);
    if (idx < 0) return '~/ ' + chain.map((n) => n.name).join(' / ');
    const rest = chain.slice(idx + 1);
    return rest.length ? '~/ ' + rest.map((n) => n.name).join(' / ') : t('browse.here');
  };

  const dirIcon = (n: DirNode) => <Icon name={TYPE_ICON[n.type]} />;

  /* -------- tree rail --------------------------------------------------- */
  const treeNode = (n: DirNode): ReactNode => {
    const cnt = countItemsIn(tree, items, n.id);
    const isOpen = !!expanded[n.id];
    const isCur = cur === n.id;
    const isDrag = dragId?.kind === 'folder' && dragId.id === n.id;
    return (
      <div className="tr-kid" key={n.id} role="treeitem">
        <div className="tr-row">
          {n.kids.length ? (
            <button
              type="button"
              className={`tr-chev${isOpen ? ' open' : ''}`}
              onClick={() => toggle(n.id)}
              aria-label={isOpen ? fmt('browse.collapse', { name: n.name }) : fmt('browse.expand', { name: n.name })}
            >
              <Icon name="chev" />
            </button>
          ) : (
            <span className="tr-ghost" />
          )}
          <button
            type="button"
            className={`tr-label${over === n.id ? ' drop' : ''}${isDrag ? ' dragging' : ''}`}
            aria-current={isCur ? 'true' : 'false'}
            onClick={() => goDir(n.id)}
            {...dropH(n.id)}
            style={V({ ['--tc']: TYPE_TINT[n.type] })}
          >
            {dirIcon(n)}
            <span className="ellip">{n.name}</span>
            <span className="tr-cnt">{cnt ? cnt : '·'}</span>
          </button>
          <button
            type="button"
            className="tr-add"
            onClick={(e) => {
              e.stopPropagation();
              openCreate(pathNames(tree, n.id));
            }}
            aria-label={t('new.create')}
          >
            ＋
          </button>
        </div>
        {n.kids.length && isOpen ? <div className="tr-kids">{n.kids.map(treeNode)}</div> : null}
      </div>
    );
  };

  /* -------- spine -------------------------------------------------------- */
  const crumbChain = cur ? chainOf(tree, cur) : [];
  const spine = (
    <nav className="spine" aria-label={t('browse.spineAria')}>
      <button type="button" className="sseg sseg--root" onClick={() => goDir(null)}>
        ~/
      </button>
      {crumbChain.map((n, i) => {
        const last = i === crumbChain.length - 1;
        return (
          <Fragment key={n.id}>
            <span className="sslash">/</span>
            <button
              type="button"
              className={`sseg${last ? ' sseg--current' : ''}${over === n.id ? ' sseg--drop' : ''}`}
              aria-current={last ? 'true' : undefined}
              onClick={() => goDir(n.id)}
              {...(last ? {} : dropH(n.id))}
            >
              {n.name}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );

  /* -------- content sections -------------------------------------------- */
  const sectionHead = (t: string, note: ReactNode) => (
    <div className="brw-section">
      <span className="st">{t}</span>
      <span className="n">{note}</span>
    </div>
  );

  const rootGrid = (
    <>
      <div className="brw-section">
        <span className="st">{t('browse.topScenes')}</span>
        <span className="n">{fmt('browse.topScenesNote', { n: tree.length })}</span>
        <button type="button" className="btn btn--soft btn--sm" style={{ marginLeft: 'auto' }} onClick={() => openCreate([])}>
          ＋ {t('new.create')}
        </button>
      </div>
      {tree.length === 0 ? (
        <div className="glass-card brw-empty">
          <Icon name="plus" />
          <b>{t('new.emptyTitle')}</b>
          <p>{t('new.emptyHint')}</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => openCreate([])}>{t('new.emptyCta')}</button>
        </div>
      ) : (
        <div className="grid-scenes">
        {tree.map((sc, i) => {
          const auto = sceneTint(i);
          const tint = {
            a: sc.layout?.tintA ?? auto.a,
            b: sc.layout?.tintB ?? auto.b,
          };
          const cnt = countItemsIn(tree, items, sc.id);
          return (
            <Link
              key={sc.id}
              className="scene-card brw-scene in d1"
              to={`/browse?at=${sc.id}`}
              style={V({ ['--tint-a']: tint.a, ['--tint-b']: tint.b })}
            >
              <span className="top">
                <span className="glyph">{dirIcon(sc)}</span>
                <span className="cnt">{fmt('browse.itemsCount', { n: cnt })}</span>
              </span>
              <span className="nm">{sc.name}</span>
              <span className="sub">
                {fmt('browse.subCount', { n: sc.kids.length })}{sc.layout?.group ? ` · ${sc.layout.group}` : ''}
              </span>
            </Link>
          );
        })}
        </div>
      )}
    </>
  );

  const containerHead = cur && curNode ? (
    <div className="brw-head">
      <button
        type="button"
        className="brw-cglyph brw-cglyph--btn brw-cglyph--hdr"
        style={V({ ['--tc']: TYPE_TINT[curNode.type] })}
        onClick={() => setSpaceImgAct(true)}
        aria-label={t('space.imgActions')}
      >
        {spaceHasImage && spaceImg ? <img className="brw-cglyph-img" src={spaceImg} alt="" /> : dirIcon(curNode)}
      </button>
      <span className="tt">
        <b>{curNode.name}</b>
        <span className="t-mono sub">
          {crumbChain.length > 1 ? '~/' + pathNames(tree, cur).join('/') : t('browse.topScenes')}
        </span>
      </span>
      <span className="spacer" />
      <span className="brw-counts hide-mobile">
        <span className="badge badge--count">{fmt('browse.subtreeCount', { n: countItemsIn(tree, items, cur) })}</span>
        {curNode.kids.length ? (
          <span className="badge badge--count">{fmt('browse.subspaces', { n: curNode.kids.length })}</span>
        ) : null}
      </span>
      <span className="rowline gap6" style={{ marginLeft: 10 }}>
        <button type="button" className="btn btn--soft btn--sm" onClick={() => openCreate(pathNames(tree, cur))}>
          ＋ {t('new.create')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" style={{ color: 'var(--danger)' }} onClick={() => void doDeleteSpace()}>
          {t('space.delete')}
        </button>
      </span>
    </div>
  ) : null;

  const emptyLeaf = (
    <div className="glass-card brw-empty">
      <Icon name="box" />
      <b>{t('browse.emptyTitle')}</b>
      <p>{t('browse.emptyHint')}</p>
      <Link className="btn btn--primary btn--sm" to={`/record${curQS}`}>
        <Icon name="plus" size={16} />
        {t('browse.place')}
      </Link>
    </div>
  );

  /* the name/tag/qty/spans shared by a normal row and its merge-mode twin */
  const rowBits = (it: Item) => (
    <>
      <span className="glyph">
        <Icon name={catMeta(it.cat).icon} />
      </span>
      <span className="ir-main">
        <span className="ir-name">
          <b>{it.name}</b>
          <span className="tag tag--type" style={V({ ['--tc']: catColor(it) })}>
            <i className="cdot" style={{ background: catColor(it) }} />
            {catLabel(it)}
          </span>
        </span>
        <span className="ir-sub">
          <span className="mono-path">{relMono(it)}</span>
          {it.alias && it.alias !== it.name ? (
            <span className="ellip t-xs t-muted">{fmt('browse.alias', { name: it.alias })}</span>
          ) : null}
        </span>
      </span>
      <span className="ir-right">
        <span className="qty-tag">
          ×{it.qty}
          <span className="times">{it.unit}</span>
        </span>
        {stBadge(it)}
      </span>
    </>
  );

  const itemsHead = (list: Item[]) => (
    <div className="brw-section">
      <span className="st">{t('browse.itemsTitle')}</span>
      {mergeOn ? (
        <span className="brw-secact">
          <span className="n">
            {keepItem
              ? foldCount > 0
                ? fmt('browse.mergeGuide', { n: foldCount, name: keepItem.name })
                : t('browse.markToMerge')
              : t('browse.pickKeep')}
          </span>
          <button
            type="button"
            className="secchip secchip--solid"
            disabled={!keepItem || foldCount === 0}
            onClick={() => void runMerge()}
          >
            <Icon name="merge" size={13} />
            {foldCount > 0 ? fmt('browse.mergeNow', { n: foldCount }) : t('browse.merge')}
          </button>
          <button type="button" className="secchip secchip--ghost" onClick={exitMerge}>
            <Icon name="x" size={13} />
            {t('app.cancel')}
          </button>
        </span>
      ) : (
        <span className="brw-secact">
          <span className="n">{fmt('browse.itemsCount', { n: list.length })}</span>
          {list.length > 1 ? (
            <button
              type="button"
              className="secchip"
              onClick={enterMerge}
              title={t('browse.mergeTip')}
            >
              <Icon name="merge" size={13} />
              {t('browse.merge')}
            </button>
          ) : null}
        </span>
      )}
    </div>
  );

  const itemsSection = (list: Item[]) => (
    <Fragment key="items">
      {itemsHead(list)}
      {list.length === 0 ? (
        emptyLeaf
      ) : (
        <div className="stack">
          {list.map((it) =>
            mergeOn ? (
              <div
                key={it.slug}
                className={`glass-card item-row grow mrg-row${it.slug === keepSlug ? ' is-keep' : ''}`}
                onClick={() => pickKeep(it.slug)}
                style={V({ ['--tc']: catColor(it) })}
              >
                <span className="mrg-ring">
                  {it.slug === keepSlug ? <Icon name="check" size={13} /> : null}
                </span>
                {rowBits(it)}
                <button
                  type="button"
                  className={`btn btn--sm mrg-fold${fold.has(it.slug) ? ' btn--primary' : ' btn--soft'}`}
                  disabled={!keepItem || it.slug === keepSlug || it.defId === keepItem?.defId}
                  aria-pressed={fold.has(it.slug)}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFold(it.slug);
                  }}
                >
                  {fold.has(it.slug) ? t('browse.selected') : t('browse.mergeIn')}
                </button>
              </div>
            ) : (
              <div className="rowline brw-itemrow" key={it.slug}>
                <button
                  type="button"
                  className={`glass-card item-row grow${dragId?.kind === 'item' && dragId.id === it.slug ? ' dragging' : ''}${overItem === it.slug ? ' drop' : ''}`}
                  {...dragSrc('item', it.slug)}
                  {...mergeDropH(it)}
                  onClick={() => openItem(it.slug)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openItem(it.slug);
                    }
                  }}
                  style={V({ ['--tc']: catColor(it) })}
                >
                  {rowBits(it)}
                </button>
                <Link className="ibtn" to={`/record?move=${it.slug}`} aria-label={fmt('browse.move', { name: it.name })} title={t('item.chgMove')}>
                  <Icon name="move" />
                </Link>
              </div>
            ),
          )}
        </div>
      )}
    </Fragment>
  );

  const foldersSection = (kids: DirNode[]) => (
    <Fragment key="folders">
      {sectionHead(t('browse.subTitle'), fmt('browse.subNote', { n: kids.length }))}
      <div className="grid-folders">
        {kids.map((k) => {
          const cnt = countItemsIn(tree, items, k.id);
          const leafEmpty = k.kids.length === 0 && cnt === 0;
          const grand = k.kids.slice(0, 3).map((g) => g.name);
          const isDrag = dragId?.kind === 'folder' && dragId.id === k.id;
          return (
            <button
              key={k.id}
              type="button"
              className={`glass-card folder-tile${over === k.id ? ' droppable' : ''}${isDrag ? ' dragging' : ''}`}
              {...dragSrc('folder', k.id)}
              {...dropH(k.id)}
              onClick={() => goDir(k.id)}
              style={V({ ['--tc']: TYPE_TINT[k.type] })}
            >
              <span className="ft-top">
                <span className="glyph">{dirIcon(k)}</span>
                <span className="ft-count">{leafEmpty ? t('browse.empty') : fmt('browse.itemsCount', { n: cnt })}</span>
                <span
                  className="ft-add"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    openCreate(pathNames(tree, k.id));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      openCreate(pathNames(tree, k.id));
                    }
                  }}
                >
                  ＋
                </span>
              </span>
              <span className="ft-name">{k.name}</span>
              {grand.length ? (
                <span className="ft-sub">
                  <span className="t-xs t-muted">
                    {grand.join(' / ')}
                    {k.kids.length > 3 ? ' …' : ''}
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </Fragment>
  );

  const noFolders = (
    <Fragment key="nofolders">
      {sectionHead(t('browse.subTitle'), '0')}
      <div className="glass-card brw-empty">
        <Icon name="dir" />
        <b>{direct.length ? t('browse.noSubContainer') : t('browse.pathEnd')}</b>
        <p>
          {direct.length
            ? fmt('browse.hasDirectHint', { n: direct.length })
            : t('browse.leafHint')}
        </p>
        {direct.length ? null : (
          <Link className="btn btn--primary btn--sm" to={`/record${curQS}`}>
            <Icon name="plus" size={16} />
            {t('browse.place')}
          </Link>
        )}
      </div>
    </Fragment>
  );

  let content: ReactNode;
  if (!cur || !curNode) {
    content = rootGrid;
  } else {
    const kids = curNode.kids;
    if (view === 'folders') {
      content = kids.length ? foldersSection(kids) : noFolders;
    } else if (view === 'items') {
      content = itemsSection(direct);
    } else if (kids.length && direct.length) {
      content = (
        <Fragment>
          {foldersSection(kids)}
          {itemsSection(direct)}
        </Fragment>
      );
    } else if (kids.length) {
      content = foldersSection(kids);
    } else {
      content = itemsSection(direct);
    }
  }

  return (
    <div className="tone-browse">
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
              <Link className="chip chip--glass hide-mobile" to="/">
                <Icon name="search" size={14} />
                {t('browse.goHub')}
              </Link>
              <Link className="btn btn--primary btn--sm" to="/record">
                <Icon name="plus" size={16} />
                {t('nav.record')}
              </Link>
            </div>
          </header>

          <main>
            <section className="page-lead in d1">
              <p className="section-kicker">{t('browse.kicker')}</p>
              <h1 className="lead-title">{t('browse.title')}</h1>
              <p className="lead-sub">{t('browse.sub')}</p>
            </section>

            <div className="brw-cols in d2">
              <aside className="glass-panel brw-rail hide-mobile" aria-label={t('browse.treeAria')}>
                <div className="panel-head">
                  <span className="section-kicker">{t('browse.tree')}</span>
                  <span className="t-xs t-muted t-mono">{t('browse.treeSub')}</span>
                  <span className="grow" />
                  <button
                    type="button"
                    className="rail-ic"
                    data-tip={treeOpen ? t('browse.treeCollapse') : t('browse.treeExpand')}
                    aria-label={treeOpen ? t('browse.treeCollapse') : t('browse.treeExpand')}
                    onClick={toggleTreeAll}
                  >
                    {treeOpen ? (
                      // heads together → collapse all
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 6l3 4 3-4M9 18l3-4 3 4" />
                      </svg>
                    ) : (
                      // tails together → expand all
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 8l3-4 3 4M9 16l3 4 3-4" />
                      </svg>
                    )}
                  </button>
                </div>
                <nav className="brw-tree">{tree.map(treeNode)}</nav>
              </aside>

              <section className="brw-main">
                {spine}
                {containerHead}
                {cur ? (
                  <div style={{ marginTop: 14 }}>
                    <Seg
                      value={view}
                      onChange={(v) => setView(v as View)}
                      options={[
                        { value: 'all', label: t('common.all') },
                        { value: 'folders', label: t('browse.viewFolders') },
                        { value: 'items', label: t('browse.viewItems') },
                      ]}
                    />
                  </div>
                ) : null}
                <div style={{ marginTop: 14 }}>{content}</div>
              </section>
            </div>
          </main>
        </div>

        <TabBar>
          <TabLink to="/" icon="home" label={t('nav.hub')} />
          <TabLink to="/record" icon="plus" label={t('nav.recordPill')} pill />
          <TabLink to="/browse" icon="dir" label={t('nav.browse')} current />
        </TabBar>
      </div>

      <NewPathSheet
        open={npsOpen}
        onClose={() => setNpsOpen(false)}
        basePathNames={npsBase}
        onCreated={(id) => {
          setNpsOpen(false);
          navigate(`/browse?at=${id}`);
        }}
      />
      <ItemSheet item={item} open={item !== null} onClose={() => setItemSlug(null)} />

      {spaceImgAct && spaceId != null ? (
        <Sheet open={spaceImgAct} onClose={() => setSpaceImgAct(false)} side="bottom" title={t('space.imgActions')} grab>
          <div className="col gap6">
            <button
              type="button"
              className="btn btn--soft btn--lg"
              style={{ width: '100%' }}
              onClick={() => {
                setSpaceImgAct(false);
                spimgInput.current?.click();
              }}
            >
              {spaceHasImage ? t('space.imgChange') : t('space.imgUpload')}
            </button>
            {spaceHasImage ? (
              <button
                type="button"
                className="btn btn--ghost btn--lg"
                style={{ width: '100%', color: 'var(--danger)' }}
                onClick={() => {
                  setSpaceImgAct(false);
                  void pickRemoveSpaceImg();
                }}
              >
                {t('space.imgRemove')}
              </button>
            ) : null}
            </div>
        </Sheet>
      ) : null}
      <input ref={spimgInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void pickSpaceImg(e)} />

      <ToastsHost />
    </div>
  );
}
