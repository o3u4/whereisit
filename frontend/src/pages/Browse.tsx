/*
 * whereisit · 空间目录 (browse) — the tree path walker.
 * Ports screens/browse.html: sticky space-tree rail, path spine crumbs, and a
 * content pane that shows either the top scene grid or the current container's
 * folders / items. Drag a folder tile or an item row onto any container
 * (rail node, folder tile, ancestor crumb) to "move" it. URL ?at=<dirId> opens
 * a container; store.reveal auto-opens an item's detail after record success.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, CAT_ICON, TYPE_ICON } from '../components/icons';
import { Wordmark, Seg, StatusBadge, ToastsHost } from '../components/ui';
import { TabBar, TabLink } from '../components/TabBar';
import { ItemSheet } from '../components/ItemSheet';
import {
  CATS,
  TYPE_TINT,
  STATUS,
  dirById,
  chainOf,
  pathNames,
  countItemsIn,
  directItemsIn,
  type DirNode,
  type Item,
} from '../mock/data';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

const ROOT_TINT: Record<string, { a: string; b: string }> = {
  bedroom: { a: 'oklch(54% .07 176)', b: 'oklch(44% .06 190)' },
  study: { a: 'oklch(50% .08 205)', b: 'oklch(42% .07 216)' },
  office: { a: 'oklch(50% .06 236)', b: 'oklch(41% .06 248)' },
  storage: { a: 'oklch(52% .09 76)', b: 'oklch(44% .09 92)' },
};
const SCENE_LABEL: Record<string, string> = {
  bedroom: '家 · 卧室',
  study: '书房',
  office: '工作',
  storage: '储物间',
};

type View = 'all' | 'folders' | 'items';
type Drag = { kind: 'folder' | 'item'; id: string };

export default function Browse() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const toast = useToast((s) => s.push);

  const items = useCatalog((s) => s.items);
  const tree = useCatalog((s) => s.tree);
  const reveal = useCatalog((s) => s.reveal);
  const setReveal = useCatalog((s) => s.setReveal);
  const moveItem = useCatalog((s) => s.moveItem);
  const moveDir = useCatalog((s) => s.moveDir);

  const atParam = search.get('at');
  const [cur, setCur] = useState<string | null>(() =>
    atParam && dirById(tree, atParam) ? atParam : null,
  );
  const [view, setView] = useState<View>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [itemSlug, setItemSlug] = useState<string | null>(null);
  const [dragId, setDragId] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
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
    navigate('/browse' + (id ? `?at=${id}` : ''));
  };

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const curQS = cur ? `?at=${cur}` : '';
  const itemOf = (slug: string) => items.find((i) => i.slug === slug) ?? null;
  const curNode = cur ? dirById(tree, cur) : null;
  const direct = cur ? directItemsIn(items, cur) : [];
  const openItem = (slug: string) => setItemSlug(slug);
  const item = itemSlug ? itemOf(itemSlug) : null;

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
    },
  });

  const perform = (d: Drag, targetId: string) => {
    const tName = dirById(tree, targetId)?.name ?? targetId;
    if (d.kind === 'item') {
      const it = itemOf(d.id);
      if (!it || it.spot === targetId) return;
      moveItem(d.id, targetId);
      toast(`已把「${it.name}」挪到 ~/…/${tName}`);
      goDir(targetId);
    } else {
      const node = dirById(tree, d.id);
      if (!node) return;
      moveDir(d.id, targetId);
      toast(`已把「${node.name}」并入 ~/…/${tName}`);
      setExpanded((e) => ({ ...e, [targetId]: true }));
    }
  };

  /* -------- small render helpers ---------------------------------------- */
  const stBadge = (it: Item) => <StatusBadge cls={it.status} label={STATUS[it.status].label} />;
  const catColor = (it: Item) => CATS[it.cat]?.tint ?? 'var(--accent)';
  const catLabel = (it: Item) => CATS[it.cat]?.label ?? it.cat;

  const relMono = (it: Item) => {
    const chain = chainOf(tree, it.spot);
    if (!cur) return '~/ ' + chain.map((n) => n.name).join(' / ');
    const idx = chain.findIndex((n) => n.id === cur);
    if (idx < 0) return '~/ ' + chain.map((n) => n.name).join(' / ');
    const rest = chain.slice(idx + 1);
    return rest.length ? '~/ ' + rest.map((n) => n.name).join(' / ') : '就在这里';
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
              aria-label={isOpen ? `收起 ${n.name}` : `展开 ${n.name}`}
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
        </div>
        {n.kids.length && isOpen ? <div className="tr-kids">{n.kids.map(treeNode)}</div> : null}
      </div>
    );
  };

  /* -------- spine -------------------------------------------------------- */
  const crumbChain = cur ? chainOf(tree, cur) : [];
  const spine = (
    <nav className="spine" aria-label="当前位置">
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
      {sectionHead('顶层场景', `${tree.length} 个 · 每个都是一条路径的开头`)}
      <div className="grid-scenes">
        {tree.map((sc) => {
          const tint = ROOT_TINT[sc.id] ?? { a: 'var(--accent)', b: 'var(--accent-deep)' };
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
                <span className="cnt">{cnt} 件</span>
              </span>
              <span className="nm">{sc.name}</span>
              <span className="sub">
                {sc.kids.length} 个子容器 · {SCENE_LABEL[sc.id] ?? ''}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );

  const containerHead = cur && curNode ? (
    <div className="brw-head">
      <span className="brw-cglyph" style={V({ ['--tc']: TYPE_TINT[curNode.type] })} aria-hidden="true">
        {dirIcon(curNode)}
      </span>
      <span className="tt">
        <b>{curNode.name}</b>
        <span className="t-mono sub">
          {crumbChain.length > 1 ? '~/' + pathNames(tree, cur).join('/') : '顶层场景'}
        </span>
      </span>
      <span className="spacer" />
      <span className="brw-counts hide-mobile">
        <span className="badge badge--count">整棵 {countItemsIn(tree, items, cur)} 件</span>
        {curNode.kids.length ? (
          <span className="badge badge--count">{curNode.kids.length} 个子空间</span>
        ) : null}
      </span>
    </div>
  ) : null;

  const emptyLeaf = (
    <div className="glass-card brw-empty">
      <Icon name="box" />
      <b>这里还空着</b>
      <p>这是路径的末端。东西还没登记？把它放到这层，路径就记下了。</p>
      <Link className="btn btn--primary btn--sm" to={`/record${curQS}`}>
        <Icon name="plus" size={16} />
        放个东西
      </Link>
    </div>
  );

  const itemsSection = (list: Item[]) => (
    <Fragment key="items">
      {sectionHead('此处物品', `${list.length} 件`)}
      {list.length === 0 ? (
        emptyLeaf
      ) : (
        <div className="stack">
          {list.map((it) => (
            <div className="rowline brw-itemrow" key={it.slug}>
              <button
                type="button"
                className={`glass-card item-row grow${dragId?.kind === 'item' && dragId.id === it.slug ? ' dragging' : ''}`}
                {...dragSrc('item', it.slug)}
                onClick={() => openItem(it.slug)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openItem(it.slug);
                  }
                }}
                style={V({ ['--tc']: catColor(it) })}
              >
                <span className="glyph">
                  <Icon name={CAT_ICON[it.cat]} />
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
                      <span className="ellip t-xs t-muted">别名 · {it.alias}</span>
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
              </button>
              <Link className="ibtn" to={`/record?move=${it.slug}`} aria-label={`挪动 ${it.name}`} title="挪动">
                <Icon name="move" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </Fragment>
  );

  const foldersSection = (kids: DirNode[]) => (
    <Fragment key="folders">
      {sectionHead('子空间', `${kids.length} 个 · 拖到另一个文件夹 = 挪动`)}
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
                <span className="ft-count">{leafEmpty ? '空' : `${cnt} 件`}</span>
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
      {sectionHead('子空间', '0 个')}
      <div className="glass-card brw-empty">
        <Icon name="dir" />
        <b>{direct.length ? '这一层没有子容器' : '这是路径的末端'}</b>
        <p>
          {direct.length
            ? `它直接装着 ${direct.length} 件物品 —— 切到「物品」查看。`
            : '一个装东西的具体容器，不再往下分。'}
        </p>
        {direct.length ? null : (
          <Link className="btn btn--primary btn--sm" to={`/record${curQS}`}>
            <Icon name="plus" size={16} />
            放个东西
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
                去中枢搜
              </Link>
              <Link className="btn btn--primary btn--sm" to="/record">
                <Icon name="plus" size={16} />
                登记
              </Link>
            </div>
          </header>

          <main>
            <section className="page-lead in d1">
              <p className="section-kicker">空间目录 · BROWSE</p>
              <h1 className="lead-title">容器即路径。点进去，一路下钻。</h1>
              <p className="lead-sub">等宽路径随时回跳；把一张卡片拖进另一个容器，就是「挪动」。</p>
            </section>

            <div className="brw-cols in d2">
              <aside className="glass-panel brw-rail hide-mobile" aria-label="空间树">
                <div className="panel-head">
                  <span className="section-kicker">空间树</span>
                  <span className="t-xs t-muted t-mono">容器 = 路径</span>
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
                        { value: 'all', label: '全部' },
                        { value: 'folders', label: '子空间' },
                        { value: 'items', label: '物品' },
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
          <TabLink to="/" icon="home" label="中枢" />
          <TabLink to="/record" icon="plus" label="登记" pill />
          <TabLink to="/browse" icon="dir" label="目录" current />
        </TabBar>
      </div>

      <ItemSheet item={item} open={item !== null} onClose={() => setItemSlug(null)} primary="move" />

      <ToastsHost />
    </div>
  );
}
