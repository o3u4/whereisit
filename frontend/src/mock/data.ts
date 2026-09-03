/*
 * whereisit · mock demo data (single source of truth for the front-end port)
 * Mirrors the OpenDesign prototype's seed: 4 categories · 9 items · 4 scenes · nested tree.
 * Milestone M2 will swap these mocks for the real backend API.
 */

export type ItemStatus = 'present' | 'lent' | 'gone';

export type DirType = 'room' | 'wardrobe' | 'desk' | 'drawer' | 'shelf' | 'box';

export interface Category {
  key: string;
  label: string;
  tint: string;
}

export interface DirNode {
  id: string;
  name: string;
  type: DirType;
  kids: DirNode[];
}

export interface Scene {
  /** root container id (== dir node id under TREE) */
  slug: string;
  name: string;
  /** 家 / 公司 — displayed above the scene name */
  parent: string;
  type: DirType;
  tintA: string;
  tintB: string;
  /** direct-child names shown as chips on the card */
  kids: string[];
}

export interface Item {
  slug: string;
  name: string;
  alias: string;
  qty: number;
  unit: string;
  cat: string; // category key -> CATS
  status: ItemStatus;
  attrs: [string, string][];
  /** dir node id this item currently sits in */
  spot: string;
}

export interface RecentEntry {
  id: string;
  verb: string;
  tone: 'present' | 'lent' | 'gone' | 'accent';
  icon: string;
  name: string;
  /** breadcrumb-ish path text, e.g. 书房 / 书桌 / 左侧抽屉 */
  sub: string;
  time: string;
}

export const CATS: Record<string, Category> = {
  elec: { key: 'elec', label: '电子配件', tint: 'oklch(60% .11 252)' },
  doc: { key: 'doc', label: '证照文档', tint: 'oklch(66% .12 72)' },
  tool: { key: 'tool', label: '工具', tint: 'oklch(60% .13 28)' },
  daily: { key: 'daily', label: '日用', tint: 'oklch(56% .09 158)' },
};

export const STATUS: Record<ItemStatus, { label: string; cls: string }> = {
  present: { label: '在', cls: 'present' },
  lent: { label: '借出', cls: 'lent' },
  gone: { label: '用完', cls: 'gone' },
};

/** tint per container type (tree glyph / type chips) */
export const TYPE_TINT: Record<DirType, string> = {
  room: 'oklch(49.5% .066 187)',
  wardrobe: 'oklch(52% .05 208)',
  desk: 'oklch(49% .05 162)',
  drawer: 'oklch(50% .06 232)',
  shelf: 'oklch(50% .045 196)',
  box: 'oklch(50% .07 82)',
};

/** nested container tree. Root nodes (bedroom/study/office/storage) double as scene cards. */
export const TREE: DirNode[] = [
  {
    id: 'bedroom', name: '卧室', type: 'room',
    kids: [
      {
        id: 'bd-ward', name: '衣柜', type: 'wardrobe',
        kids: [{ id: 'bd-ward-mid', name: '中层隔板', type: 'shelf', kids: [] }],
      },
      {
        id: 'bd-night', name: '床头柜', type: 'drawer',
        kids: [{ id: 'bd-night-top', name: '上层抽屉', type: 'drawer', kids: [] }],
      },
      { id: 'bd-win', name: '飘窗收纳', type: 'box', kids: [] },
    ],
  },
  {
    id: 'study', name: '书房', type: 'room',
    kids: [
      {
        id: 'st-desk', name: '书桌', type: 'desk',
        kids: [
          { id: 'st-desk-left', name: '左侧抽屉', type: 'drawer', kids: [] },
          { id: 'st-desk-top', name: '桌面', type: 'desk', kids: [] },
        ],
      },
      { id: 'st-file', name: '文件柜', type: 'wardrobe', kids: [] },
    ],
  },
  {
    id: 'office', name: '办公室 · 工位', type: 'desk',
    kids: [
      { id: 'of-top', name: '桌面', type: 'desk', kids: [] },
      { id: 'of-a2', name: '抽屉 A2', type: 'drawer', kids: [] },
      { id: 'of-rack', name: '文件架', type: 'shelf', kids: [] },
    ],
  },
  {
    id: 'storage', name: '储物间', type: 'room',
    kids: [
      {
        id: 'stg-tool', name: '工具柜', type: 'wardrobe',
        kids: [{ id: 'stg-toolbox', name: '工具箱', type: 'box', kids: [] }],
      },
      {
        id: 'stg-shelf', name: '货架', type: 'shelf',
        kids: [{ id: 'stg-up', name: '上层', type: 'shelf', kids: [] }],
      },
      { id: 'stg-box', name: '收纳箱 A', type: 'box', kids: [] },
    ],
  },
];

export const SCENES: Scene[] = [
  { slug: 'bedroom', name: '卧室', parent: '家', type: 'room', tintA: 'oklch(52% .09 178)', tintB: 'oklch(82% .08 165)', kids: ['衣柜', '床头柜', '飘窗收纳'] },
  { slug: 'study', name: '书房', parent: '家', type: 'room', tintA: 'oklch(50% .10 235)', tintB: 'oklch(80% .07 205)', kids: ['书桌', '文件柜'] },
  { slug: 'office', name: '办公室 · 工位', parent: '公司', type: 'desk', tintA: 'oklch(55% .12 60)', tintB: 'oklch(84% .09 70)', kids: ['桌面', '抽屉 A2', '文件架'] },
  { slug: 'storage', name: '储物间', parent: '家', type: 'room', tintA: 'oklch(52% .06 230)', tintB: 'oklch(78% .06 170)', kids: ['工具柜', '货架', '收纳箱 A'] },
];

const RAW_ITEMS: Array<Omit<Item, 'spot'> & { spot: string }> = [
  { slug: 'hdmi', name: 'HDMI 线', alias: 'hdmi,高清线,视频线', qty: 3, unit: '条', cat: 'elec', status: 'present', spot: 'st-desk-left', attrs: [['长度', '2 m'], ['标记', '客厅备用']] },
  { slug: 'usbc', name: 'USB-C 快充线', alias: 'usb-c,type-c,充电线', qty: 2, unit: '条', cat: 'elec', status: 'present', spot: 'of-a2', attrs: [['长度', '1 m'], ['接口', 'C → C']] },
  { slug: 'earbuds', name: '蓝牙耳机', alias: '耳机,buds,earbuds', qty: 1, unit: '副', cat: 'elec', status: 'lent', spot: 'bd-night-top', attrs: [['颜色', '白色']] },
  { slug: 'power', name: '充电宝', alias: '移动电源,power bank', qty: 1, unit: '个', cat: 'elec', status: 'present', spot: 'of-top', attrs: [['容量', '10 000 mAh']] },
  { slug: 'passport', name: '护照', alias: 'passport,证件', qty: 1, unit: '本', cat: 'doc', status: 'present', spot: 'bd-ward-mid', attrs: [['姓名', 'J · T'], ['有效期', '2031-04']] },
  { slug: 'scissor', name: '剪刀', alias: '剪子,拆快递', qty: 1, unit: '把', cat: 'tool', status: 'present', spot: 'st-desk-top', attrs: [['用途', '拆快递']] },
  { slug: 'screw', name: '螺丝刀套装', alias: '螺丝刀,screwdriver,工具', qty: 1, unit: '套', cat: 'tool', status: 'present', spot: 'stg-toolbox', attrs: [['件数', '24 件']] },
  { slug: 'keys', name: '备用钥匙', alias: '钥匙,key', qty: 1, unit: '串', cat: 'daily', status: 'present', spot: 'stg-box', attrs: [['备注', '楼下信箱']] },
  { slug: 'bandaid', name: '创可贴', alias: 'ok 绷,邦迪', qty: 1, unit: '盒', cat: 'daily', status: 'present', spot: 'stg-up', attrs: [['规格', '100 片']] },
];

export const INITIAL_ITEMS: Item[] = RAW_ITEMS.map(({ spot, ...rest }) => ({ ...rest, spot }));

export const INITIAL_RECENT: RecentEntry[] = [
  { id: 'r1', verb: '放好', tone: 'present', icon: 'plus', name: 'HDMI 线', sub: '书房 / 书桌 / 左侧抽屉', time: '12 分钟前' },
  { id: 'r2', verb: '借出', tone: 'lent', icon: 'arrow-l', name: '蓝牙耳机', sub: '卧室 / 床头柜 / 上层抽屉', time: '昨天' },
  { id: 'r3', verb: '挪动', tone: 'present', icon: 'move', name: '螺丝刀套装', sub: '储物间 / 工具柜 / 工具箱', time: '周三' },
];

export const catOf = (item: Item): Category => CATS[item.cat];

/* ---------------- pure tree helpers (take nodes as param, no mutation) ----- */

export function dirById(nodes: DirNode[], id: string): DirNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kids.length) {
      const hit = dirById(n.kids, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** ancestors incl. self, root first */
export function chainOf(nodes: DirNode[], id: string): DirNode[] {
  const n = dirById(nodes, id);
  if (!n) return [];
  const out: DirNode[] = [];
  const walk = (list: DirNode[], node: DirNode): boolean => {
    for (const c of list) {
      if (c === node) {
        out.push(c);
        return true;
      }
      if (c.kids.length) {
        out.push(c);
        if (walk(c.kids, node)) return true;
        out.pop();
      }
    }
    return false;
  };
  walk(nodes, n);
  return out;
}

/** item-less ancestor names, root first: e.g. 书房 / 书桌 / 左侧抽屉 */
export function pathNames(nodes: DirNode[], id: string): string[] {
  return chainOf(nodes, id).map((n) => n.name);
}

/** breadcrumb string for a directory id, e.g. ~/书房/书桌 */
export function dirPathLabel(nodes: DirNode[], id: string): string {
  return '~/' + pathNames(nodes, id).join('/');
}

export function descIdsOf(nodes: DirNode[], id: string): string[] {
  const n = dirById(nodes, id);
  if (!n) return [];
  const out: string[] = [];
  const walk = (node: DirNode): void => {
    out.push(node.id);
    for (const k of node.kids) walk(k);
  };
  walk(n);
  return out;
}

/** remove a dir node from an immutable copy; returns new nodes + the cut subtree */
export function cutDir(nodes: DirNode[], id: string): { nodes: DirNode[]; node: DirNode | null } {
  if (!dirById(nodes, id)) return { nodes, node: null };
  const cut: DirNode[] = [];
  const walk = (ns: DirNode[]): DirNode[] => {
    const out: DirNode[] = [];
    for (const n of ns) {
      if (n.id === id) {
        cut.push(n);
        continue;
      }
      if (n.kids.length) {
        const kids = walk(n.kids);
        out.push(kids === n.kids ? n : { ...n, kids });
      } else {
        out.push(n);
      }
    }
    return out;
  };
  return { nodes: walk(nodes), node: cut[0] ?? null };
}

/** attach a subtree as the last kid of `intoId` (immutable copy down that path) */
export function attachDir(nodes: DirNode[], intoId: string, node: DirNode): DirNode[] {
  const walk = (ns: DirNode[]): DirNode[] =>
    ns.map((n) => {
      if (n.id === intoId) return { ...n, kids: [...n.kids, node] };
      if (n.kids.length) {
        const kids = walk(n.kids);
        return kids === n.kids ? n : { ...n, kids };
      }
      return n;
    });
  return walk(nodes);
}

/** how many items (by .spot) sit inside the container incl. sub-containers */
export function countItemsIn(nodes: DirNode[], items: Item[], id: string): number {
  const ids = descIdsOf(nodes, id);
  return items.filter((it) => ids.includes(it.spot)).length;
}

/** items directly inside a container (their .spot === id) */
export function directItemsIn(items: Item[], id: string): Item[] {
  return items.filter((it) => it.spot === id);
}

/** ancestor path for an item's current spot: 书房 / 书桌 / 左侧抽屉 */
export function itemPathNames(nodes: DirNode[], items: Item[], slug: string): string[] {
  const it = items.find((x) => x.slug === slug);
  return it ? pathNames(nodes, it.spot) : [];
}
