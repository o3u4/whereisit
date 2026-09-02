import { useUi } from './stores/ui'
import Board from './pages/Board'
import Browse from './pages/Browse'
import TopBar from './components/TopBar'
import BackToBoard from './components/BackToBoard'

export default function App() {
  const view = useUi((s) => s.view)

  // 独立全屏首页:只有看板,无顶栏/侧栏
  if (view === 'board') return <Board />

  // 浏览界面:顶栏 + 树侧栏 + 详情;右下角固定「回看板」
  return (
    <div className="relative h-dvh w-full overflow-hidden text-ink">
      <div className="aurora-canvas" aria-hidden>
        <i className="blob b-teal" />
        <i className="blob b-amber" />
        <i className="blob b-indigo" />
      </div>

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1500px] flex-col gap-3 p-3 sm:gap-4 sm:p-5">
        <TopBar />
        <main className="flex min-h-0 flex-1 gap-3 sm:gap-4">
          <Browse />
        </main>
      </div>

      <BackToBoard />
    </div>
  )
}
