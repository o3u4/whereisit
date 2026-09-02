const en = {
  app: {
    name: 'whereisit',
    tagline: 'where things live',
  },
  nav: {
    langSwitch: '中',
    browse: 'Browse',
    search: 'Search',
    settings: 'Settings',
  },
  status: {
    online: 'Online',
    offline: 'Offline',
    schemaVersion: 'schema v',
    pending: 'Connecting…',
  },
  browse: {
    newSpace: 'New space',
    name: 'Name',
    namePlaceholder: 'e.g. top-left shelf',
    create: 'Create',
    cancel: 'Cancel',
    subSpaces: 'Sub-spaces',
    emptySpacesTitle: 'No spaces yet',
    emptySpacesHint: 'Register your first scene — e.g. a bedroom — then nest a wardrobe or a drawer inside it.',
    emptySelected: 'Select a space on the left to see its contents and path',
    noChildren: 'No sub-spaces here yet',
    selectedPathPrefix: '~/',
  },
  home: {
    health: 'Backend health check',
  },
  type: {
    room: 'Room',
    wardrobe: 'Wardrobe',
    desk: 'Desk',
    drawer: 'Drawer',
    shelf: 'Shelf',
    box: 'Box',
    generic: 'Space',
    other: 'Space',
  },
} as const

export default en
