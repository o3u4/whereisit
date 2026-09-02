const zh = {
  app: {
    name: 'whereisit',
    tagline: '物品在哪',
  },
  nav: {
    langSwitch: 'EN',
    browse: '浏览',
    search: '搜索',
    settings: '设置',
  },
  status: {
    online: '已连接',
    offline: '未连接',
    schemaVersion: '数据版本',
    pending: '连接中…',
  },
  home: {
    emptyTitle: '还没有任何空间',
    emptyHint: '从登记第一个场景开始——比如卧室、衣柜或抽屉。空间浏览将在下一阶段启用。',
    health: '后端健康检查',
  },
} as const

export default zh
export type MessageSchema = typeof zh
