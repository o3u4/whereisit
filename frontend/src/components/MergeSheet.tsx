/*
 * whereisit · merge duplicates sheet — shared by Browse (topbar「合并」button).
 * Pick one def to KEEP (○), then check any number of others to fold into it via
 * a single batch. Quantity addition on the same spot happens server-side inside
 * merge_defs (coalesce), so distinct places stay separate. Merges are final.
 */

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Sheet } from './ui';
import { Icon } from './icons';
import { catMeta } from '../lib/meta';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';

const V = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

type Def = { defId: number; name: string; cat: string; count: number; spots: number };

export function MergeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useCatalog((s) => s.items);
  const mergeDefs = useCatalog((s) => s.mergeDefs);
  const toast = useToast((s) => s.push);

  const [keepId, setKeepId] = useState<number | null>(null);
  const [sel, setSel] = useState<ReadonlySet<number>>(new Set());

  const defs = useMemo<Def[]>(() => {
    const map = new Map<number, Def>();
    const spotsOf = new Map<number, Set<string>>();
    for (const it of items) {
      let g = map.get(it.defId);
      if (g) g.count += 1;
      else map.set(it.defId, (g = { defId: it.defId, name: it.name, cat: it.cat, count: 1, spots: 1 }));
      let s = spotsOf.get(it.defId);
      if (!s) spotsOf.set(it.defId, (s = new Set()));
      s.add(it.spot);
    }
    for (const d of map.values()) d.spots = spotsOf.get(d.defId)?.size ?? 1;
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  }, [items]);

  const keep = keepId != null ? defs.find((d) => d.defId === keepId) : null;
  const multi = defs.length > 1;

  const pickKeep = (defId: number) => {
    setKeepId(defId);
    setSel(new Set()); // switching target clears staged merges
  };
  const toggle = (defId: number) => {
    if (keepId == null || defId === keepId) return;
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(defId)) next.delete(defId);
      else next.add(defId);
      return next;
    });
  };

  const run = async () => {
    if (keepId == null || sel.size === 0) return;
    let ok = 0;
    for (const fid of sel) if (await mergeDefs(keepId, fid)) ok += 1;
    if (ok > 0) toast(`已并入 ${ok} 个 →「${keep?.name ?? ''}」，同位置数量自动相加`);
    setSel(new Set());
    if (ok > 0) onClose();
  };

  const foot = multi ? (
    <div className="rec-sheet-foot">
      <span className="grow t-sm t-faint" style={V({ alignSelf: 'center' })}>
        {keepId == null
          ? '先点一个 ○ 设为「保留」'
          : sel.size > 0
            ? `把勾选的 ${sel.size} 个并入「${keep?.name ?? ''}」`
            : '勾选要并入的条目'}
      </span>
      <button
        type="button"
        className="btn btn--primary btn--lg"
        disabled={keepId == null || sel.size === 0}
        onClick={() => void run()}
      >
        并入 {sel.size > 0 ? sel.size : ''}
      </button>
    </div>
  ) : null;

  return (
    <Sheet open={open} onClose={onClose} side="bottom" title="合并重复物品" grab plain footer={foot}>
      <div className="mg-list">
        {multi ? (
          <p className="t-sm t-faint">
            「同名不同条目」在这里合成一个。○ 选保留目标，勾选其余并入它；不同位置的各自保留，同位置数量相加。合并不可撤销。
          </p>
        ) : (
          <p className="t-sm t-faint">还没有可合并的重复物品 —— 同名多条目会出现在这里。</p>
        )}

        <div className="col gap6">
          {defs.map((d) => {
            const isKeep = d.defId === keepId;
            const on = sel.has(d.defId);
            return (
              <div
                key={d.defId}
                className={`mg-row${isKeep ? ' is-keep' : ''}${on ? ' is-sel' : ''}`}
              >
                <button
                  type="button"
                  className={`mg-keep${isKeep ? ' on' : ''}`}
                  aria-pressed={isKeep}
                  aria-label={isKeep ? `保留「${d.name}」` : `把「${d.name}」设为保留目标`}
                  onClick={() => pickKeep(d.defId)}
                >
                  <Icon name="check" size={14} />
                </button>
                <span className="mg-glyph" style={V({ ['--tc']: catMeta(d.cat).tint })}>
                  <Icon name={catMeta(d.cat).icon} />
                </span>
                <span className="grow mg-body">
                  <span className="mg-name">{d.name}</span>
                  <span className="mg-sub">
                    {isKeep ? '保留 · 勾选项并入这里 · ' : ''}
                    {d.count} 件 · {d.spots} 处
                  </span>
                </span>
                <button
                  type="button"
                  className={`btn btn--sm mg-ck${on ? ' btn--primary' : ' btn--soft'}`}
                  disabled={isKeep || keepId == null}
                  aria-pressed={on}
                  onClick={() => toggle(d.defId)}
                >
                  {on ? '✓ 并入' : '并入'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
