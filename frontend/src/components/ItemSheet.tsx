/*
 * whereisit · item detail sheet (right drawer). Shared by hub spotlight results
 * and the browse page. Footer actions:
 *   - primary variant decides the emphasized action (move vs locate)
 *   - a lend/borrow toggle row keeps present<->lent status reachable
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, StatusBadge } from './ui';
import { Icon } from './icons';
import { catMeta } from '../lib/meta';
import { pathNames } from '../lib/tree';
import type { Item } from '../lib/types';
import { useCatalog } from '../stores/catalog';
import { useToast } from '../stores/toast';

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
  const tree = useCatalog((s) => s.tree);
  const deleteItem = useCatalog((s) => s.deleteItem);
  const undo = useCatalog((s) => s.undo);
  const toast = useToast((s) => s.push);
  const [armed, setArmed] = useState(false);

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
              {item.qty} {item.unit}
            </span>
          </div>
          <div className="kv">
            <span className="k">类别</span>
            <span className="v">
              <span className="tag tag--type" style={{ ['--tc']: cat.tint } as CSSProperties}>
                <i className="cdot" style={{ background: cat.tint }} />
                {cat.label}
              </span>
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
  );
}
