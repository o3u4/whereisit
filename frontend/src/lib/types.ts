/* whereisit · UI-side domain types. These mirror the backend DTOs (see src/api/types.ts)
 * but shaped for the render layer: ids are strings, type_tags/status are the DB vocabulary. */

/** DB status vocabulary (display labels live in lib/meta.ts STATUS). */
export type ItemStatus = 'present' | 'lent' | 'consumed';

/** container type; unknown space type_tags map to 'generic' */
export type DirType = 'room' | 'wardrobe' | 'desk' | 'drawer' | 'shelf' | 'box' | 'generic';

/** display metadata stored per root scene in spaces.layout_json (JSON string) */
export interface SceneLayout {
  group: string;
  tintA: string;
  tintB: string;
}

export interface DirNode {
  /** String(space id) */
  id: string;
  name: string;
  type: DirType;
  kids: DirNode[];
  /** parsed from layout_json; present on root scenes the seed decorated */
  layout?: SceneLayout;
}

/** a root container rendered as a scene card on the hub */
export interface Scene {
  slug: string;
  name: string;
  /** 家 / 公司 (layout.group) */
  parent: string;
  type: DirType;
  tintA: string;
  tintB: string;
  /** direct-child containers (names/chips on the card) */
  kids: DirNode[];
}

export interface Item {
  /** String(lot id) — a presence row, not a def */
  slug: string;
  name: string;
  alias: string;
  qty: number;
  unit: string;
  /** category display label ('' if none); icon/tint via lib/meta catMeta */
  cat: string;
  status: ItemStatus;
  attrs: [string, string][];
  /** String(space id) this lot currently sits in */
  spot: string;
}

export interface RecentEntry {
  id: string;
  verb: string;
  tone: ItemStatus | 'accent';
  icon: string;
  name: string;
  /** breadcrumb-ish path text, e.g. 书房 / 书桌 / 左侧抽屉 */
  sub: string;
  time: string;
}
