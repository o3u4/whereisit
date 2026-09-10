/* whereisit · LLM batch tree builder. Give a description and/or photo of a
 * place; the model returns a category tree (spaces + items) which the user can
 * edit (rename / delete / add, tweak item category & qty) before it is built
 * under the chosen root. Pure client edit; nothing is written until 确认加入. */

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { TreeNode, TreeItem } from '../api/client';
import { recognizeTree, buildTree } from '../api/client';
import { Sheet } from './ui';
import { useTr } from '../i18n';

function TreeItemRow({
  item,
  onChange,
  onRemove,
}: {
  item: TreeItem;
  onChange: (it: TreeItem) => void;
  onRemove: () => void;
}) {
  const { t } = useTr();
  return (
    <div className="rowline gap6" style={{ padding: '2px 0' }}>
      <span className="t-mono" style={{ color: 'var(--faint)' }}>·</span>
      <input
        className="field"
        value={item.name}
        placeholder={t('llm.itemName')}
        onChange={(e) => onChange({ ...item, name: e.target.value })}
        style={{ minWidth: 0, flex: '1', minHeight: 32 }}
      />
      <input
        className="field"
        value={item.category ?? ''}
        placeholder={t('rec.kCat')}
        onChange={(e) => onChange({ ...item, category: e.target.value })}
        style={{ width: 96, minHeight: 32 }}
      />
      <input
        className="field"
        type="number"
        min={1}
        value={item.qty ?? 1}
        onChange={(e) => onChange({ ...item, qty: Math.max(1, Number(e.target.value) || 1) })}
        style={{ width: 60, minHeight: 32 }}
      />
      <button type="button" className="btn--text t-sm" style={{ color: 'var(--danger)' }} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

function NodeEditor({
  node,
  onChange,
  onRemove,
  depth,
}: {
  node: TreeNode;
  onChange: (n: TreeNode) => void;
  onRemove: () => void;
  depth: number;
}) {
  const { t } = useTr();
  const [renaming, setRenaming] = useState(false);
  const [subDraft, setSubDraft] = useState('');
  const [itemDraft, setItemDraft] = useState('');
  const kids = node.children ?? [];
  const items = node.items ?? [];

  const rename = (name: string) => onChange({ ...node, name });

  return (
    <div style={depth ? { marginLeft: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)' } : undefined}>
      <div className="rowline gap6">
        {renaming ? (
          <>
            <input
              className="field"
              value={node.name}
              onChange={(e) => rename(e.target.value)}
              autoFocus
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => { if (e.key === 'Enter') setRenaming(false); }}
              style={{ minWidth: 0, flex: '1', minHeight: 32 }}
            />
            <button type="button" className="btn btn--soft btn--sm" onClick={() => setRenaming(false)}>{t('app.save')}</button>
          </>
        ) : (
          <>
            <span className="t-mono" style={{ color: 'var(--faint)' }}>{'▸'.repeat(depth + 1)}</span>
            <b className="ellip" style={{ flex: '1', minWidth: 0 }}>{node.name}</b>
            <button type="button" className="btn--text t-sm" onClick={() => setRenaming(true)}>{t('cat.rename')}</button>
            <button type="button" className="btn--text t-sm" style={{ color: 'var(--danger)' }} onClick={onRemove}>{t('app.delete')}</button>
          </>
        )}
      </div>

      {kids.map((k, i) => (
        <NodeEditor
          key={i}
          node={k}
          onChange={(nk) => onChange({ ...node, children: kids.map((x, j) => (j === i ? nk : x)) })}
          onRemove={() => onChange({ ...node, children: kids.filter((_, j) => j !== i) })}
          depth={depth + 1}
        />
      ))}

      {items.map((it, i) => (
        <TreeItemRow
          key={i}
          item={it}
          onChange={(nit) => onChange({ ...node, items: items.map((x, j) => (j === i ? nit : x)) })}
          onRemove={() => onChange({ ...node, items: items.filter((_, j) => j !== i) })}
        />
      ))}

      <div className="rowline gap6" style={{ padding: '2px 0' }}>
        <input
          className="field"
          value={subDraft}
          placeholder={t('llm.addSpacePh')}
          onChange={(e) => setSubDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          style={{ minWidth: 0, flex: '1', minHeight: 32 }}
        />
        <button type="button" className="btn btn--soft btn--sm" disabled={!subDraft.trim()} onClick={add}>
          {t('llm.addSpace')}
        </button>
        <input
          className="field"
          value={itemDraft}
          placeholder={t('llm.addItemPh')}
          onChange={(e) => setItemDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
          style={{ width: 140, minHeight: 32 }}
        />
        <button type="button" className="btn btn--soft btn--sm" disabled={!itemDraft.trim()} onClick={addItem}>
          {t('llm.addItem')}
        </button>
      </div>
    </div>
  );

  function add() {
    const nm = subDraft.trim();
    if (!nm) return;
    onChange({ ...node, children: [...kids, { name: nm, children: [], items: [] }] });
    setSubDraft('');
  }
  function addItem() {
    const nm = itemDraft.trim();
    if (!nm) return;
    onChange({ ...node, items: [...items, { name: nm, qty: 1 }] });
    setItemDraft('');
  }
}

export function TreeBuilderSheet({
  open,
  onClose,
  targetId,
  targetName,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  targetId: number | null;
  targetName: string;
  onDone: () => void;
}) {
  const { t } = useTr();
  const [text, setText] = useState('');
  const [img, setImg] = useState<string | null>(null); // raw base64 for API
  const [imgUrl, setImgUrl] = useState<string | null>(null); // dataURL preview
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setImg(null);
      setImgUrl(null);
      setNodes([]);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickImg = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const data = String(rd.result);
      setImgUrl(data);
      setImg(data.slice(data.indexOf(',') + 1));
    };
    rd.readAsDataURL(f);
  };

  const doParse = async () => {
    if ((!text.trim() && !img) || busy) return;
    setBusy(true);
    try {
      const r = await recognizeTree(text.trim() || undefined, img || undefined);
      setNodes(r.nodes ?? []);
    } catch {
      /* error toast-less: caller sees nothing; keep simple */
    } finally {
      setBusy(false);
    }
  };

  const doBuild = async () => {
    if (!nodes.length || busy) return;
    setBusy(true);
    try {
      await buildTree(targetId, nodes);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} side="bottom" title={`${t('llm.title')} · ${targetName}`} grab>
      <div className="col gap8">
        <div className="col gap6">
          <span className="field-label">{t('llm.describe')}</span>
          <textarea
            className="field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('llm.describePh')}
            rows={2}
            style={{ resize: 'vertical', minHeight: 56, padding: '10px 14px' }}
          />
        </div>
        <div className="rowline gap8" style={{ alignItems: 'center' }}>
          {imgUrl ? (
            <img src={imgUrl} alt="" style={{ width: 60, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
          ) : null}
          <button type="button" className="btn btn--soft btn--sm" onClick={() => fileRef.current?.click()}>
            {t('llm.photo')}
          </button>
          {imgUrl ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setImg(null); setImgUrl(null); }}>
              {t('llm.photoRemove')}
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickImg} />
          <span className="grow" />
          <button type="button" className="btn btn--primary" disabled={(!text.trim() && !img) || busy} onClick={() => void doParse()}>
            {busy ? t('llm.parsing') : t('llm.parse')}
          </button>
        </div>

        {nodes.length ? (
          <>
            <div className="col gap4" style={{ maxHeight: '46vh', overflow: 'auto', padding: 2 }}>
              {nodes.map((n, i) => (
                <NodeEditor
                  key={i}
                  node={n}
                  onChange={(nn) => setNodes((p) => p.map((x, j) => (j === i ? nn : x)))}
                  onRemove={() => setNodes((p) => p.filter((_, j) => j !== i))}
                  depth={0}
                />
              ))}
            </div>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void doBuild()}>
              {t('llm.commit')}
            </button>
          </>
        ) : (
          <p className="t-sm t-faint">{t('llm.hint')}</p>
        )}
      </div>
    </Sheet>
  );
}