import TopBar from './components/TopBar'
import Browse from './pages/Browse'

export default function App() {
  return (
    <div className="relative h-dvh w-full overflow-hidden text-ink">
      {/* 固定背景光晕层(玻璃背后的颜色) */}
      <div className="aurora-canvas" aria-hidden>
        <i className="blob b-teal" />
        <i className="blob b-amber" />
        <i className="blob b-indigo" />
      </div>

      {/* 悬浮玻璃世界:胶囊顶栏 + 玻璃侧栏 + 漂浮卡片 */}
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1500px] flex-col gap-3 p-3 sm:gap-4 sm:p-5">
        <TopBar />
        <main className="flex min-h-0 flex-1 gap-3 sm:gap-4">
          <Browse />
        </main>
      </div>
    </div>
  )
}
