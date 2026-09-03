/*
 * whereisit · location picker bottom sheet (choose a tree node to place an item).
 * Rendered from the record wizard; search filters the whole container tree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Sheet } from './ui';
import { Icon, TYPE_ICON } from './icons';
import { chainOf, pathNames, type DirNode } from '../mock/data';
import { useCatalog } from '../stores/catalog';

function flattenNodes(nodes: DirNode[]): DirNode[] {
  const out: DirNode[] = [];
  const walk = (ns: DirNode[]): void => {
    for (const n of ns) {
      out.push(n);
      walk(n.kids);
    }
  };
  walk(nodes);
  return out;
}

export function LocationPicker({
  open,
  onClose,
  title,
  value,
  confirmLabel = '就放这里',
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string | null;
  confirmLabel?: string;
  onCommit: (nodeId: string) => void;
}) {
  const tree = useCatalog((s) => s.tree);
  const [sel, setSel] = useState<string | null>(value);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => flattenNodes(tree), [tree]);

  useEffect(() => {
    if (!open) return;
    setSel(value);
    setQ('');
    const exp: Record<string, boolean> = {};
    tree.forEach((n) => (exp[n.id] = true));
    if (value) {
      for (const n of chainOf(tree, value)) exp[n.id] = true;
    }
    setExpanded(exp);
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 160);
    return () => window.clearTimeout(t);
  }, [open, value, tree]);

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const commit = () => {
    if (sel) {
      onCommit(sel);
      onClose();
    }
  };

  const query = q.trim().toLowerCase();
  const filtered = query ? all.filter((n) => n.name.toLowerCase().includes(query)) : null;

  const tint = { ['--tc']: 'var(--accent)' } as CSSProperties;

  const nodeRow = (n: DirNode, depth: number, showPath?: boolean) => {
    const hasKids = n.kids.length > 0;
    const isOpen = !!expanded[n.id];
    const isSel = n.id === sel;
    return (
      <div key={n.id}>
        <button
          type="button"
          className={`rec-tnode${isSel ? ' rec-tnode--sel' : ''}`}
          onClick={() => setSel(n.id)}
          style={{ paddingLeft: 10 + depth * 20 }}
        >
          {hasKids ? (
            <span
              className={`rec-tchev${isOpen ? ' rec-tchev--open' : ''}`}
              role="button"
              aria-label={isOpen ? '收起' : '展开'}
              onClick={(e) => {
                e.stopPropagation();
                toggle(n.id);
              }}
            >
              <Icon name="chev" />
            </span>
          ) : (
            <span className="rec-tchev rec-tchev--leaf">
              <Icon name="chev" />
            </span>
          )}
          <span className="rec-tico" style={tint}>
            <Icon name={TYPE_ICON[n.type]} />
          </span>
          <span className="rec-tname">{n.name}</span>
          <span className="rec-tcheck">
            <Icon name="check" size={14} />
          </span>
        </button>
        {showPath ? (
          <div className="rec-tpath">~/ {pathNames(tree, n.id).join(' / ')}</div>
        ) : null}
        {hasKids && isOpen && !filtered ? n.kids.map((k) => nodeRow(k, depth + 1)) : null}
      </div>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="bottom"
      title={title}
      grab
      className="rec-sheet"
      plain
      footer={
        <div className="rec-sheet-foot">
          <button type="button" className="btn btn--primary btn--lg" onClick={commit} disabled={!sel}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="rec-sheet-body">
        <div className="rec-pick-filter">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="field"
            placeholder="搜房间 / 柜子 / 层格…"
            autoComplete="off"
            aria-label="筛选位置"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
          />
        </div>
        <div className="rec-pick-tree">
          {filtered
            ? filtered.map((n) => nodeRow(n, 0, true))
            : tree.map((n) => nodeRow(n, 0))}
          {filtered && filtered.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 6 }}>
              <b>没有「{query}」</b>
              <span>换个词试试</span>
            </div>
          ) : null}
          {!filtered && all.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 6 }}>
              <b>还没有任何位置</b>
              <span>先在目录里建一个容器</span>
            </div>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
