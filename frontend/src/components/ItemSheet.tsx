/*
 * whereisit · item detail sheet (right drawer). Everything is edited in place:
 * position (click → location picker), status (click → status sheet), quantity
 * (−/＋), category (button → picker), custom attributes (add + inline value) and
 * the note, which sits at the very bottom. Delete is the only footer action.
 *
 * Notes are lot-level; category + custom attributes are def-level (they belong to
 * the item type, shared across every presence of it). Attribute value edits upsert
 * a def attr; insert order = display order, so new attributes append at the end.
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Sheet, Stepper, StatusBadge } from './ui';
import { Icon } from './icons';
import { catMeta, STATUS } from '../lib/meta';
import { pathNames } from '../lib/tree';
import type { Item, ItemStatus } from '../lib/types';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';
import { LocationPicker } from './LocationPicker';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

const STATUS_ORDER: ItemStatus[] = ['present', 'lent', 'consumed'];
const ST_TINT: Record<ItemStatus, string> = {
  present: 'var(--present)',
  lent: 'var(--lent)',
  consumed: 'var(--gone)',
};

export function ItemSheet({ item, open, onClose }: { item: Item | null; open: boolean; onClose: () => void }) {
  const setStatus = useCatalog((s) => s.setStatus);
  const setQty = useCatalog((s) => s.setQty);
  const setNotes = useCatalog((s) => s.setNotes);
  const changeCategory = useCatalog((s) => s.changeCategory);
  const addCategory = useCatalog((s) => s.addCategory);
  const setDefAttr = useCatalog((s) => s.setDefAttr);
  const removeDefAttr = useCatalog((s) => s.removeDefAttr);
  const commit = useCatalog((s) => s.commit);
  const categories = useCatalog((s) => s.categories);
  const tree = useCatalog((s) => s.tree);
  const deleteItem = useCatalog((s) => s.deleteItem);
  const undo = useCatalog((s) => s.undo);
  const toast = useToast((s) => s.push);

  const [armed, setArmed] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [stOpen, setStOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [attrEditKey, setAttrEditKey] = useState<string | null>(null);
  const [attrDraft, setAttrDraft] = useState('');
  const [attrRemoveKey, setAttrRemoveKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [qty, setQtyLocal] = useState(item ? item.qty : 1);
  useEffect(() => {
    if (item) setQtyLocal(item.qty);
  }, [item?.qty]);

  if (!item) return null;
  const cat = catMeta(item.cat);
  const tintVar = { ['--tc']: cat.tint } as CSSProperties;
  const path = '~/ ' + pathNames(tree, item.spot).join(' / ');

  const closeEditors = () => {
    setNotesOpen(false);
    setAttrEditKey(null);
    setAttrRemoveKey(null);
    setAddOpen(false);
  };

  const openNotes = () => {
    closeEditors();
    setNotesText(item.notes ?? '');
    setNotesOpen(true);
  };

  const saveNotes = async () => {
    await setNotes(item.slug, notesText);
    toast('备注已保存');
    setNotesOpen(false);
  };

  const onQty = (v: number) => {
    if (v < 1) return;
    setQtyLocal(v);
    setQty(item.slug, v);
  };

  const pickStatus = async (s: ItemStatus) => {
    await setStatus(item.slug, s);
    const verb = s === 'present' ? '在' : s === 'lent' ? '借出' : '用完';
    toast(`已标记「${item.name}」${verb}`);
    setStOpen(false);
  };

  const onMove = async (nodeId: string) => {
    const r = await commit(item.slug, { spot: nodeId });
    if (r) {
      const leaf = pathNames(tree, nodeId).join(' / ');
      toast(`已把「${item.name}」移到 ~/ ${leaf}`);
    }
    setMoveOpen(false);
  };

  const pickCat = async (catId: number, name: string) => {
    if (await changeCategory(item.defId, catId)) toast(`已改到「${name}」，同类一起生效`);
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

  const openAttrEdit = (key: string, value: string) => {
    closeEditors();
    setAttrEditKey(key);
    setAttrDraft(value);
  };

  const saveAttr = async () => {
    if (attrEditKey == null) return;
    if (await setDefAttr(item.defId, attrEditKey, attrDraft)) {
      toast(`已保存「${attrEditKey}」`);
      setAttrEditKey(null);
      setAttrDraft('');
    }
  };

  const removeAttr = async () => {
    if (attrRemoveKey == null) return;
    if (await removeDefAttr(item.defId, attrRemoveKey)) {
      toast(`已移除「${attrRemoveKey}」`);
      setAttrRemoveKey(null);
      setAttrEditKey(null);
    }
  };

  const addAttr = async () => {
    const k = newKey.trim();
    if (!k) return;
    if (await setDefAttr(item.defId, k, newVal)) {
      toast(`已添加「${k}」`);
      setAddOpen(false);
      setNewKey('');
      setNewVal('');
    }
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
      <button type="button" className="btn btn--danger btn--lg" style={{ flex: 1 }} onClick={() => void onDelete()}>
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

  /* attribute rows (def-level) */
  const attrRows = item.attrs.map(([k, v]) =>
    attrEditKey === k ? (
      <div className="kv" key={k}>
        <span className="k">{k}</span>
        <span className="v">
          <span className="rowline gap8" style={{ width: '100%' }}>
            <input
              className="field"
              value={attrDraft}
              onChange={(e) => setAttrDraft(e.target.value)}
              autoFocus
              style={{ minWidth: 0, flex: '1' }}
            />
            <button type="button" className="btn btn--soft btn--sm" onClick={() => void saveAttr()}>
              保存
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAttrEditKey(null)}>
              取消
            </button>
            {attrRemoveKey === k ? (
              <button type="button" className="btn btn--danger btn--sm" onClick={() => void removeAttr()}>
                移除
              </button>
            ) : (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAttrRemoveKey(k)}>
                移除…
              </button>
            )}
          </span>
        </span>
      </div>
    ) : (
      <div className="kv" key={k}>
        <span className="k">{k}</span>
        <span className="v">
          <button type="button" className={`attr-val${v === '' ? ' t-muted' : ''}`} onClick={() => openAttrEdit(k, v)}>
            {v !== '' ? v : '＋ 填写'}
          </button>
        </span>
      </div>
    ),
  );

  const addRow = addOpen ? (
    <div className="row gap8" style={{ alignItems: 'center' }}>
      <input
        className="field"
        placeholder="属性名，如 颜色 / 型号"
        value={newKey}
        onChange={(e) => setNewKey(e.target.value)}
        autoFocus
        maxLength={40}
        style={{ minWidth: 0, flex: '1.4' }}
      />
      <input
        className="field"
        placeholder="值（可留空稍后填）"
        value={newVal}
        onChange={(e) => setNewVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void addAttr();
        }}
        maxLength={120}
        style={{ minWidth: 0, flex: '2' }}
      />
      <button type="button" className="btn btn--soft btn--sm" disabled={!newKey.trim()} onClick={() => void addAttr()}>
        添加
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setAddOpen(false); setNewKey(''); setNewVal(''); }}>
        取消
      </button>
    </div>
  ) : (
    <button type="button" className="addattr-btn" onClick={() => { closeEditors(); setAddOpen(true); }}>
      <Icon name="plus" size={14} />
      添加属性
    </button>
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
                <button type="button" className="kv-edit" onClick={() => { closeEditors(); setMoveOpen(true); }}>
                  <span className="mono-path">{path}</span>
                  <Icon name="chev" size={14} style={V({ flex: 'none', color: 'var(--faint)' })} />
                </button>
              </span>
            </div>
            <div className="kv">
              <span className="k">状态</span>
              <span className="v">
                <button type="button" className="kv-edit" onClick={() => { closeEditors(); setStOpen(true); }}>
                  <StatusBadge cls={item.status} label={STATUS[item.status].label} />
                  <Icon name="chev" size={14} style={V({ flex: 'none', color: 'var(--faint)' })} />
                </button>
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
                  onClick={() => { closeEditors(); setCatOpen(true); }}
                >
                  <i className="cdot" style={{ background: cat.tint }} />
                  {cat.label}
                  <Icon name="chev" size={12} style={V({ flex: 'none', color: 'var(--faint)' })} />
                </button>
                <span className="t-xs t-muted" style={{ marginLeft: 8 }}>
                  同类一起生效
                </span>
              </span>
            </div>

            {attrRows}

            <div className="kv">
              <span className="k" />
              <span className="v">{addRow}</span>
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
                  <button type="button" className="kv-edit" onClick={openNotes}>
                    <span className={item.notes ? 'note-txt' : 't-muted'}>
                      {item.notes ? item.notes : '＋ 添加备注'}
                    </span>
                    <Icon name="chev" size={14} style={V({ flex: 'none', color: 'var(--faint)' })} />
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
      </Sheet>

      {stOpen ? (
        <Sheet open={stOpen} onClose={() => setStOpen(false)} side="bottom" title="更改状态" grab>
          <div className="col gap6">
            {STATUS_ORDER.map((s) => {
              const on = item.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  className={`result-row${on ? ' sel' : ''}`}
                  style={{ width: '100%' }}
                  onClick={() => void pickStatus(s)}
                >
                  <span className="rr-glyph" style={V({ ['--tc']: ST_TINT[s] })}>
                    <i className="cdot" style={{ background: ST_TINT[s], width: 10, height: 10 }} />
                  </span>
                  <span className="rr-main">
                    <span className="rr-name">{STATUS[s].label}</span>
                  </span>
                  <span className="t-xs t-faint">
                    {s === 'present' ? '在记录处' : s === 'lent' ? '借出后仍可搜索' : '用完 · 记为消耗'}
                  </span>
                </button>
              );
            })}
          </div>
        </Sheet>
      ) : null}

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

      <LocationPicker
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="挪到哪儿？"
        value={item.spot}
        confirmLabel="挪到这里"
        onCommit={(id) => void onMove(id)}
      />
    </>
  );
}
