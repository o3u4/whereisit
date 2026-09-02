const PATHS: Record<string, string> = {
  room: 'M4 10.8 12 5l8 5.8M6 9.6V19h12V9.6M9 19v-5h6v5',
  wardrobe: 'M6 4h12v16H6zM10 4v16M14 4v16',
  desk: 'M3 14h18M5 14V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5M7 18h10',
  drawer: 'M6 6h12v12H6zM6 12h12M10 12v6',
  shelf: 'M4 6h16M4 12h11M4 18h16',
  box: 'M12 3l8 4v10l-8 4-8-4V7zM12 3v10M4 7l8 4 8-4',
}

export default function TypeIcon({ tag }: { tag: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[tag] ?? PATHS.box} />
    </svg>
  )
}
