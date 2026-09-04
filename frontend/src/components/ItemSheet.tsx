/*
 * whereisit · item detail sheet (right drawer). Shared by hub spotlight results
 * and the browse page. Everything here is editable in place: status (lend),
 * quantity (step), category (button → picker), notes (inline) and delete.
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, Stepper, StatusBadge } from './ui';
import { Icon } from './icons';
import { catMeta } from '../lib/meta';
import { pathNames } from '../lib/tree';
import type { Item } from '../lib/types';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

export function ItemSheet({
  item,
  open,
  onClose,
  primary = 'locate',
}: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  /** which footer action gets the accent fill: locate (打开位置) or move (挪动/改数量) */
  primary?: 'locate' | 'move';
}) {
  const setStatus = useCatalog((s) => s.setStatus);
  const setQty = useCatalog((s) => s.setQty);
  const setNotes = useCatalog((s) => s.setNotes);
  const changeCategory = useCatalog((s) => s.changeCategory);
  const addCategory = useCatalog((s) => s.addCategory);
  const categories = useCatalog((s) => s.categories);
  const tree = useCatalog((s) => s.tree);
  const deleteItem = useCatalog((s) => s.deleteItem);
  const undo = useCatalog((s) => s.undo);
  const toast = useToast((s) => s.push);

  const [armed, setArmed] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [qty, setQtyLocal] = useState(item ? item.qty : 1);
  useEffect(() => {
    if (item) setQtyLocal(item.qty);
  }, [item?.qty]);

  if (!item) return null;
  const cat = catMeta(item.cat);
  const tintVar = { ['--tc']: cat.tint } as CSSProperties;
  const path = '~/ ' + pathNames(tree, item.spot).join(' / ');
  const lent = item.status === 'lent';

  const locateHref = `/browse?at=${item.spot}`;
  const moveHref = `/record?move=${item.slug}`;

  const toggleLend = () => {
    const next = lent ? 'present' : 'lent';
    setStatus(item.slug, next);
    toast(next === 'lent' ? `已标记借出「${item.name}」` : `已收回「${item.name}」`, undefined, '撤销', () => void undo());
  };

  const onQty = (v: number) => {
    if (v < 1 || !item) return;
    setQtyLocal(v);
    setQty(item.slug, v);
  };

  const pickCat = async (catId: number, name: string) => {
    if (await changeCategory(item.defId, catId)) toast(`已改到「${name}」`);
    setCatOpen(false);
  };

  const addNewCat = async () => {
    const n = newCat.trim();
    if (!n) return;
    if (await addCategory(n)) {
      toast(`已新增「${n}」`);
      const fresh = useCatalog.getState().categories.find((c) => c.name === n);
      if (fresh) await changeCategory(item.defId, fresh.id);
      setCatOpen(false);
      setNewCat('');
    } else {
      toast('新增分类失败');
    }
  };

  const saveNotes = async () => {
    await setNotes(item.slug, notesText);
    toast('备注已保存');
    setNotesOpen(false);
  };

  const onDelete = async () => {
    if (await deleteItem(item.slug)) {
      toast(`已删除「${item.name}」`, undefined, '撤销', () => void undo());
      onClose();
    } else {
      toast('删除失败');
      setArmed(false);
    }
  };

  const deleteBtn = armed ? (
    <div className="row gap8" style={{ width: '100%' }}>
      <button type="button" className="btn btn--danger btn--lg" style={{ flex: 1 }} onClick={onDelete}>
        确认删除
      </button>
      <button type="button" className="btn btn--ghost btn--lg" style={{ flex: 1 }} onClick={() => setArmed(false)}>
        取消
      </button>
    </div>
  ) : (
    <button
      type="button"
      className="btn btn--ghost btn--lg"
      style={{ width: '100%', color: 'var(--danger)' }}
      onClick={() => setArmed(true)}
      onMouseLeave={() => setArmed(false)}
    >
      删除这件 {item.name}
    </button>
  );

  const footPrimary =
    primary === 'move' ? (
      <Link className="btn btn--primary btn--lg" style={{ width: '100%' }} to={moveHref}>
        <Icon name="move" size={16} />
        挪动 / 改数量
      </Link>
    ) : (
      <Link className="btn btn--primary btn--lg" style={{ width: '100%' }} to={locateHref}>
        <Icon name="locate" size={16} />
        打开位置
      </Link>
    );

  const footGhost =
    primary === 'move' ? (
      <Link className="btn btn--ghost btn--lg" style={{ width: '100%' }} to={locateHref}>
        <Icon name="locate" size={16} />
        就在这个容器里看
      </Link>
    ) : (
      <Link className="btn btn--ghost btn--lg" style={{ width: '100%' }} to={moveHref}>
        <Icon name="move" size={16} />
        挪到别处
      </Link>
    );

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        side="right"
        title={item.name}
        plain
        footer={
          <div className="brw-sheet-foot">
            {footPrimary}
            {footGhost}
            {deleteBtn}
          </div>
        }
      >
        <div className="sheet-body">
          <div className="item-img">
            <span className="item-img-ghost">
              <Icon name="image" size={28} />
              <span className="t-xs t-muted">图片预览 · 后续支持物品图片 / GIF</span>
            </span>
          </div>
          <div className="row gap10" style={{ alignItems: 'center' }}>
            <span className="brw-cglyph" style={tintVar}>
              <Icon name={cat.icon} />
            </span>
            <span className="col" style={{ minWidth: 0 }}>
              <b className="t-h3" style={{ fontWeight: 750 }}>
                {item.name}
              </b>
              {item.alias ? (
                <span className="t-xs t-muted ellip" style={{ maxWidth: '100%' }}>
                  {item.alias}
                </span>
              ) : null}
            </span>
            <span className="grow" />
            <StatusBadge cls={item.status} label={item.status === 'present' ? '在' : item.status === 'lent' ? '借出' : '用完'} />
          </div>

          <div className="brw-dl">
            <div className="kv">
              <span className="k">位置</span>
              <span className="v">
                <span className="mono-path">{path}</span>
              </span>
            </div>
            <div className="kv">
              <span className="k">数量</span>
              <span className="v">
                <span className="rowline gap8">
                  <Stepper value={qty} onChange={onQty} min={1} />
                  <span className="t-xs t-muted">{item.unit}</span>
                </span>
              </span>
            </div>
            <div className="kv">
              <span className="k">类别</span>
              <span className="v">
                <button
                  type="button"
                  className="tag tag--type"
                  style={{ ...(tintVar as object), cursor: 'pointer' }}
                  onClick={() => setCatOpen(true)}
                >
                  <i className="cdot" style={{ background: cat.tint }} />
                  {cat.label}
                  <Icon name="chev" size={12} style={V({ flex: 'none', color: 'var(--faint)' })} />
                </button>
              </span>
            </div>
            <div className="kv">
              <span className="k">备注</span>
              <span className="v">
                {notesOpen ? (
                  <span className="rowline gap8">
                    <input
                      className="field"
                      placeholder="给这条备注一下…"
                      value={notesText}
                      onChange={(e) => setNotesText(e.target.value)}
                      autoFocus
                      style={{ minWidth: 0, flex: '1' }}
                    />
                    <button type="button" className="btn btn--soft btn--sm" onClick={() => void saveNotes()}>
                      保存
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setNotesOpen(false)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="tag tag--type"
                    style={{ ...(tintVar as object), cursor: 'pointer' }}
                    onClick={() => {
                      setNotesText(item.notes ?? '');
                      setNotesOpen(true);
                    }}
                  >
                    {item.notes ? item.notes : '＋ 添加备注'}
                  </button>
                )}
              </span>
            </div>
            {item.attrs.map(([k, v]) => (
              <div className="kv" key={k}>
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
          </div>

          <div className="row gap8 mt8" style={{ alignItems: 'center' }}>
            <button type="button" className="btn btn--soft btn--sm" onClick={toggleLend} style={tintVar}>
              {lent ? '收回' : '借出'}
            </button>
            <span className="t-xs t-muted">借出后在中枢里仍找得到</span>
          </div>
        </div>
      </Sheet>

      {catOpen ? (
        <Sheet open={catOpen} onClose={() => setCatOpen(false)} side="bottom" title="更改类别" grab>
          <div className="rowline gap8">
            <input
              className="field"
              placeholder="新类别名称"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addNewCat();
              }}
            />
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void addNewCat()} disabled={!newCat.trim()}>
              ＋ 新增
            </button>
          </div>
          <div className="col gap6">
            {categories.map((c) => {
              const on = item.cat === c.name;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`result-row${on ? ' sel' : ''}`}
                  style={{ width: '100%' }}
                  onClick={() => void pickCat(c.id, c.name)}
                >
                  <span className="rr-glyph" style={V({ ['--tc']: catMeta(c.name).tint })}>
                    <Icon name={catMeta(c.name).icon} />
                  </span>
                  <span className="rr-main">
                    <span className="rr-name">{c.name}</span>
                  </span>
                  <span className="t-xs t-faint">{c.itemCount} 件</span>
                </button>
              );
            })}
            {categories.length === 0 ? <p className="t-sm t-faint">还没有分类，可在上方新增。</p> : null}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}