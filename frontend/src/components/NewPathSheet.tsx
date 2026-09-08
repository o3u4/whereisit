/* whereisit · create a space / path. Two modes:
 *  - 详细 (detail, default): structured — space name + thumbnail + child spaces
 *    + items, all at once under the current location.
 *  - 快速 (quick): type a whole relative path (e.g. 衣柜/顶层 → the whole chain). */

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import * as api from '../api/client';
import { Sheet, Seg } from './ui';
import { Icon, TYPE_ICON } from './icons';
import { dirById } from '../lib/tree';
import { useCatalog } from '../stores/catalog';
import { useTr } from '../i18n';

type Mode = 'detail' | 'quick';
type ItemRow = { name: string; cat: string };
const SEP = /[/\\｜|,，]/;
const TYPES = ['room', 'wardrobe', 'desk', 'drawer', 'shelf', 'box', 'generic'] as const;
const TLABEL: Record<(typeof TYPES)[number], string> = {
  room: 'new.tRoom',
  wardrobe: 'new.tWardrobe',
  desk: 'new.tDesk',
  drawer: 'new.tDrawer',
  shelf: 'new.tShelf',
  box: 'new.tBox',
  generic: 'new.tOther',
};

export function NewPathSheet({
  open,
  onClose,
  basePathNames,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** names from the root down to (and including) the current location; [] = root */
  basePathNames: string[];
  onCreated: (spaceId: number) => void;
}) {
  const { t } = useTr();
  const [mode, setMode] = useState<Mode>('detail');
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [childNames, setChildNames] = useState<string[]>([]);
  const [childDraft, setChildDraft] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [itemDraft, setItemDraft] = useState('');
  const [itemCat, setItemCat] = useState('');
  const [thumb, setThumb] = useState<string | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [stype, setStype] = useState<string>('generic');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const thumbInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQ('');
      setName('');
      setChildNames([]);
      setChildDraft('');
      setItems([]);
      setItemDraft('');
      setItemCat('');
      setThumb(null);
      setThumbFile(null);
      setStype('generic');
      setGroup('');
      setBusy(false);
    }
  }, [open]);

  const addChild = () => {
    const v = childDraft.trim();
    if (!v) return;
    setChildNames((p) => [...p, v]);
    setChildDraft('');
  };
  const addItem = () => {
    const v = itemDraft.trim();
    if (!v) return;
    setItems((p) => [...p, { name: v, cat: itemCat.trim() }]);
    setItemDraft('');
    setItemCat('');
  };

  const pickThumb = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (thumb) URL.revokeObjectURL(thumb);
    setThumbFile(f);
    setThumb(URL.createObjectURL(f));
  };

  const splitPath = (s: string) => s.split(SEP).map((x) => x.trim()).filter(Boolean);

  const doQuick = async () => {
    const segs = splitPath(q);
    if (!segs.length || busy) return;
    setBusy(true);
    try {
      const id = await useCatalog.getState().ensurePath([...basePathNames, ...segs]);
      if (id != null) {
        onCreated(id);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const doDetail = async () => {
    const nm = name.trim();
    if (!nm || busy) return;
    setBusy(true);
    try {
      const st = useCatalog.getState();
      const id = await st.ensurePath([...basePathNames, nm], stype === 'generic' ? undefined : stype);
      if (id == null) return;
      // 归属标签 (家/公司) lives on layout_json.group of the top-level scene
      if (basePathNames.length === 0 && group.trim()) {
        const node = dirById(useCatalog.getState().tree, String(id));
        const prev = (node?.layout as { group?: string } | undefined) ?? {};
        await api.updateSpaceLayout(id, { ...prev, group: group.trim() });
        await useCatalog.getState().load();
      }
      // children are created with find-or-create semantics (mkdir -p) so adding
      // to an existing scene never duplicates a child that's already there
      for (const c of childNames) {
        const cname = c.trim();
        if (cname) await st.ensurePath([...basePathNames, nm, cname]);
      }
      for (const it of items) {
        const iname = it.name.trim();
        if (iname) {
          await st.addItem({ name: iname, qty: 1, unit: '', cat: it.cat, spot: String(id) });
        }
      }
      if (thumbFile) await api.uploadMedia('space', id, thumbFile);
      onCreated(id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} side="bottom" title={t('new.title')} grab>
      <Seg
        fluid
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        options={[
          { value: 'detail', label: t('new.detail') },
          { value: 'quick', label: t('new.quick') },
        ]}
      />

      {mode === 'quick' ? (
        <div className="col gap6">
          <span className="field-label">{t('new.path')}</span>
          <input className="field" value={q} placeholder={t('new.pathPh')} autoFocus onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doQuick(); }} />
          {basePathNames.length ? (
            <p className="t-sm t-muted" style={{ margin: 0 }}>
              ~/ {basePathNames.join(' / ')} /
            </p>
          ) : null}
          <button type="button" className="btn btn--primary" disabled={!q.trim() || busy} onClick={() => void doQuick()}>
            {busy ? t('new.busy') : t('new.create')}
          </button>
        </div>
      ) : (
        <div className="col gap10">
          {basePathNames.length ? (
            <p className="t-sm t-muted" style={{ margin: 0 }}>~/ {basePathNames.join(' / ')} /</p>
          ) : null}

          <div>
            <span className="field-label">{t('new.name')}</span>
            <input className="field" value={name} placeholder={t('new.namePh')} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          {basePathNames.length === 0 ? (
            <div>
              <span className="field-label">{t('new.group')}</span>
              <input className="field" value={group} placeholder={t('new.groupPh')} onChange={(e) => setGroup(e.target.value)} />
            </div>
          ) : null}

          <div>
            <span className="field-label">{t('new.type')}</span>
            <div className="wrap-t gap6">
              {TYPES.map((tp) => {
                const on = stype === tp;
                return (
                  <button
                    key={tp}
                    type="button"
                    className="chip chip--glass"
                    onClick={() => setStype(tp)}
                    style={on ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                  >
                    <Icon name={TYPE_ICON[tp]} size={13} />
                    {t(TLABEL[tp])}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="field-label">{t('new.thumb')}</span>
            {thumb ? (
              <div className="rowline gap8" style={{ alignItems: 'center' }}>
                <img src={thumb} alt="" style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 12 }} />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => thumbInput.current?.click()}>{t('new.thumbChange')}</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setThumb(null); setThumbFile(null); }}>{t('new.thumbRemove')}</button>
              </div>
            ) : (
              <button type="button" className="btn btn--soft btn--sm" onClick={() => thumbInput.current?.click()}>{t('new.thumbUpload')}</button>
            )}
            <input ref={thumbInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickThumb} />
          </div>

          <div>
            <span className="field-label">{t('new.children')}</span>
            {childNames.length ? (
              <div className="wrap-t gap6 mb8">
                {childNames.map((c, i) => (
                  <span key={i} className="chip chip--glass">
                    {c}
                    <button type="button" className="chip-x" onClick={() => setChildNames((p) => p.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="rowline gap8">
              <input className="field" value={childDraft} placeholder={t('new.childPh')} onChange={(e) => setChildDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addChild(); }} />
              <button type="button" className="btn btn--soft btn--sm" disabled={!childDraft.trim()} onClick={addChild}>{t('new.add')}</button>
            </div>
          </div>

          <div>
            <span className="field-label">{t('new.items')}</span>
            {items.length ? (
              <div className="wrap-t gap6 mb8">
                {items.map((it, i) => (
                  <span key={i} className="chip chip--glass">
                    {it.name}{it.cat ? ` · ${it.cat}` : ''}
                    <button type="button" className="chip-x" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="rowline gap8">
              <input className="field" value={itemDraft} placeholder={t('new.itemPh')} onChange={(e) => setItemDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} />
              <input className="field" value={itemCat} placeholder={t('new.itemCatPh')} onChange={(e) => setItemCat(e.target.value)} style={{ maxWidth: 120 }} />
              <button type="button" className="btn btn--soft btn--sm" disabled={!itemDraft.trim()} onClick={addItem}>{t('new.add')}</button>
            </div>
          </div>

          <button type="button" className="btn btn--primary" disabled={!name.trim() || busy} onClick={() => void doDetail()}>
            {busy ? t('new.busy') : t('new.create')}
          </button>
        </div>
      )}
    </Sheet>
  );
}