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
import { catMeta } from '../lib/meta';
import { pathNames } from '../lib/tree';
import type { Item, ItemStatus } from '../lib/types';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';
import { useTr } from '../i18n';
import { LocationPicker } from './LocationPicker';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

const STATUS_ORDER: ItemStatus[] = ['present', 'lent', 'consumed'];
const ST_TINT: Record<ItemStatus, string> = {
  present: 'var(--present)',
  lent: 'var(--lent)',
  consumed: 'var(--gone)',
};

export function ItemSheet({
  item,
  open,
  onClose,
  onLocate,
}: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  /** optional "jump to this item's path" action (shown when opened from search) */
  onLocate?: (item: Item) => void;
}) {
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
  const { t, fmt } = useTr();

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
    toast(t('item.notesSaved'));
    setNotesOpen(false);
  };

  const onQty = (v: number) => {
    if (v < 1) return;
    setQtyLocal(v);
    setQty(item.slug, v);
  };

  const pickStatus = async (s: ItemStatus) => {
    await setStatus(item.slug, s);
    toast(fmt('item.statusToast', { name: item.name, verb: t('status.' + s) }));
    setStOpen(false);
  };

  const onMove = async (nodeId: string) => {
    const r = await commit(item.slug, { spot: nodeId });
    if (r) {
      const leaf = pathNames(tree, nodeId).join(' / ');
      toast(fmt('item.moved', { name: item.name, leaf }));
    }
    setMoveOpen(false);
  };

  const pickCat = async (catId: number, name: string) => {
    if (await changeCategory(item.defId, catId)) toast(fmt('item.catChanged', { name }));
    setCatOpen(false);
  };

  const addNewCat = async () => {
    const n = newCat.trim();
    if (!n) return;
    if (await addCategory(n)) {
      toast(fmt('item.catAdded', { name: n }));
      const fresh = useCatalog.getState().categories.find((c) => c.name === n);
      if (fresh) await changeCategory(item.defId, fresh.id);
      setCatOpen(false);
      setNewCat('');
    } else {
      toast(t('item.catAddFail'));
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
      toast(fmt('item.attrSaved', { key: attrEditKey }));
      setAttrEditKey(null);
      setAttrDraft('');
    }
  };

  const removeAttr = async () => {
    if (attrRemoveKey == null) return;
    if (await removeDefAttr(item.defId, attrRemoveKey)) {
      toast(fmt('item.attrRemoved', { key: attrRemoveKey }));
      setAttrRemoveKey(null);
      setAttrEditKey(null);
    }
  };

  const addAttr = async () => {
    const k = newKey.trim();
    if (!k) return;
    if (await setDefAttr(item.defId, k, newVal)) {
      toast(fmt('item.attrAdded', { key: k }));
      setAddOpen(false);
      setNewKey('');
      setNewVal('');
    }
  };

  const onDelete = async () => {
    if (await deleteItem(item.slug)) {
      toast(fmt('item.deleted', { name: item.name }), undefined, t('undo'), () => void undo());
      onClose();
    } else {
      toast(t('item.deleteFail'));
      setArmed(false);
    }
  };

  const deleteBtn = armed ? (
    <div className="row gap8" style={{ width: '100%' }}>
      <button type="button" className="btn btn--danger btn--lg" style={{ flex: 1 }} onClick={() => void onDelete()}>
        {t('item.confirmDelete')}
      </button>
      <button type="button" className="btn btn--ghost btn--lg" style={{ flex: 1 }} onClick={() => setArmed(false)}>
        {t('app.cancel')}
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
      {fmt('item.deleteThis', { name: item.name })}
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
              {t('app.save')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAttrEditKey(null)}>
              {t('app.cancel')}
            </button>
            {attrRemoveKey === k ? (
              <button type="button" className="btn btn--danger btn--sm" onClick={() => void removeAttr()}>
                {t('item.remove')}
              </button>
            ) : (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAttrRemoveKey(k)}>
                {t('item.removeAsk')}
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
            {v !== '' ? v : t('item.attrFill')}
          </button>
        </span>
      </div>
    ),
  );

  const addRow = addOpen ? (
    <div className="row gap8" style={{ alignItems: 'center' }}>
      <input
        className="field"
        placeholder={t('item.attrNamePh')}
        value={newKey}
        onChange={(e) => setNewKey(e.target.value)}
        autoFocus
        maxLength={40}
        style={{ minWidth: 0, flex: '1.4' }}
      />
      <input
        className="field"
        placeholder={t('item.attrValPh')}
        value={newVal}
        onChange={(e) => setNewVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void addAttr();
        }}
        maxLength={120}
        style={{ minWidth: 0, flex: '2' }}
      />
      <button type="button" className="btn btn--soft btn--sm" disabled={!newKey.trim()} onClick={() => void addAttr()}>
        {t('item.add')}
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setAddOpen(false); setNewKey(''); setNewVal(''); }}>
        {t('app.cancel')}
      </button>
    </div>
  ) : (
    <button type="button" className="addattr-btn" onClick={() => { closeEditors(); setAddOpen(true); }}>
      <Icon name="plus" size={14} />
      {t('item.addAttr')}
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
              <span className="t-xs t-muted">{t('item.imgHint')}</span>
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
            {onLocate ? (
              <button type="button" className="btn btn--soft btn--sm" onClick={() => onLocate(item)}>
                <Icon name="locate" size={13} />
                {t('item.locate')}
              </button>
            ) : null}
            <span className="grow" />
            <button
              type="button"
              className="st-edit"
              onClick={() => { closeEditors(); setStOpen(true); }}
              aria-haspopup="dialog"
              aria-label={`${t('item.chgStatus')}（${t('status.' + item.status)}）`}
            >
              <StatusBadge cls={item.status} label={t('status.' + item.status)} />
              <Icon name="chev" size={13} style={V({ flex: 'none', color: 'var(--faint)' })} />
            </button>
          </div>

          <div className="brw-dl">
            <div className="kv">
              <span className="k">{t('item.pos')}</span>
              <span className="v">
                <button type="button" className="kv-edit" onClick={() => { closeEditors(); setMoveOpen(true); }}>
                  <span className="mono-path">{path}</span>
                  <Icon name="chev" size={14} style={V({ flex: 'none', color: 'var(--faint)' })} />
                </button>
              </span>
            </div>
            <div className="kv">
              <span className="k">{t('item.qty')}</span>
              <span className="v">
                <span className="rowline gap8">
                  <Stepper value={qty} onChange={onQty} min={1} />
                  <span className="t-xs t-muted">{item.unit}</span>
                </span>
              </span>
            </div>
            <div className="kv">
              <span className="k">{t('item.cat')}</span>
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
              </span>
            </div>

            {attrRows}

            <div className="kv">
              <span className="k" />
              <span className="v">{addRow}</span>
            </div>

            <div className="kv">
              <span className="k">{t('item.notes')}</span>
              <span className="v">
                {notesOpen ? (
                  <span className="rowline gap8">
                    <input
                      className="field"
                      placeholder={t('item.notePh')}
                      value={notesText}
                      onChange={(e) => setNotesText(e.target.value)}
                      autoFocus
                      style={{ minWidth: 0, flex: '1' }}
                    />
                    <button type="button" className="btn btn--soft btn--sm" onClick={() => void saveNotes()}>
                      {t('app.save')}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setNotesOpen(false)}>
                      {t('app.cancel')}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="kv-edit" onClick={openNotes}>
                    <span className={item.notes ? 'note-txt' : 't-muted'}>
                      {item.notes ? item.notes : t('item.addNote')}
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
        <Sheet open={stOpen} onClose={() => setStOpen(false)} side="bottom" title={t('item.chgStatus')} grab>
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
                    <span className="rr-name">{t('status.' + s)}</span>
                  </span>
                  <span className="t-xs t-faint">
                    {s === 'present' ? t('item.stPresentHint') : s === 'lent' ? t('item.stLentHint') : t('item.stConsumedHint')}
                  </span>
                </button>
              );
            })}
          </div>
        </Sheet>
      ) : null}

      {catOpen ? (
        <Sheet open={catOpen} onClose={() => setCatOpen(false)} side="bottom" title={t('item.chgCat')} grab>
          <div className="rowline gap8">
            <input
              className="field"
              placeholder={t('item.newCatPh')}
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addNewCat();
              }}
            />
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void addNewCat()} disabled={!newCat.trim()}>
              {t('item.addCat')}
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
                  <span className="t-xs t-faint">{fmt('item.catCount', { n: c.itemCount })}</span>
                </button>
              );
            })}
            {categories.length === 0 ? <p className="t-sm t-faint">{t('item.catEmpty')}</p> : null}
          </div>
        </Sheet>
      ) : null}

      <LocationPicker
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={t('item.chgMove')}
        value={item.spot}
        confirmLabel={t('item.moveConfirm')}
        onCommit={(id) => void onMove(id)}
      />
    </>
  );
}
