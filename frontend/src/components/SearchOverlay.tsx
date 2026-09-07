/* whereisit · mounts the global ⌘K spotlight + the cross-page item detail sheet
 * exactly once, above the routes, so search is reachable from any page. Also
 * owns the global hotkeys (⌘K / Ctrl-K / "/"). */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCatalog } from '../stores/catalog';
import { useOverlay } from '../stores/overlay';
import type { Item } from '../lib/types';
import { Spotlight } from './Spotlight';
import { ItemSheet } from './ItemSheet';

export function SearchOverlay() {
  const navigate = useNavigate();
  const itemSlug = useOverlay((s) => s.itemSlug);
  const closeItem = useOverlay((s) => s.closeItem);
  const openSpot = useOverlay((s) => s.openSpot);
  const items = useCatalog((s) => s.items);
  const item = itemSlug ? (items.find((i) => i.slug === itemSlug) ?? null) : null;

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSpot();
        return;
      }
      if (e.key === '/' && !typing) {
        e.preventDefault();
        openSpot();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSpot]);

  const locate = (it: Item) => {
    useOverlay.setState({ itemSlug: null });
    useCatalog.getState().setReveal(it.slug);
    navigate(`/browse?at=${it.spot}`);
  };

  return (
    <>
      <Spotlight />
      <ItemSheet item={item} open={!!item && !!itemSlug} onClose={closeItem} onLocate={locate} />
    </>
  );
}