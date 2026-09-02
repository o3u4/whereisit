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
  browse: {
    newSpace: '新增空间',
    name: '名称',
    namePlaceholder: '例如：上排左格',
    create: '创建',
    cancel: '取消',
    subSpaces: '子空间',
    emptySpacesTitle: '还没有任何空间',
    emptySpacesHint: '从登记第一个场景开始——比如“卧室”，再往里加衣柜、抽屉。',
    emptySelected: '选中左侧一个空间以查看其内容与路径',
    noChildren: '这里还没有子空间',
    selectedPathPrefix: '~/',
  },
  home: {
    health: '后端健康检查',
  },
  type: {
    room: '房间',
    wardrobe: '衣柜',
    desk: '书桌',
    drawer: '抽屉',
    shelf: '层板',
    box: '盒子',
    generic: '空间',
    other: '空间',
  },
} as const

export default zh
export type MessageSchema = typeof zh
