import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Hub from './pages/Hub'
import Browse from './pages/Browse'
import Record from './pages/Record'
import { useCatalog } from './stores/catalog'

/** whereisit · three-screen IA: 中枢 (/) → 目录 (/browse?at=) → 登记 (/record?at=|move=) */
export default function App() {
  const load = useCatalog((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/record" element={<Record />} />
        <Route path="*" element={<Hub />} />
      </Routes>
    </BrowserRouter>
  )
}
