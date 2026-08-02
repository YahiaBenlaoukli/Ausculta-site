import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Sidebar from '../Sidebar/Sidebar'
import GlobalSearch from '../GlobalSearch/GlobalSearch'
import { LayoutContext } from './LayoutContext'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { i18n } = useTranslation()
  const isRtl = i18n.dir() === 'rtl'

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
    document.documentElement.lang = i18n.language
  }, [i18n.language, isRtl])

  // Ctrl+K / ⌘K from anywhere in the app. Registered on the window rather than
  // inside the palette so it also works while the palette is closed. Escape is
  // handled here too, not just on the palette's input, so the overlay still
  // closes if focus has moved onto one of the result rows.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(open => !open)
      } else if (e.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const contextValue = useMemo(
    () => ({ collapsed, setCollapsed, searchOpen, setSearchOpen }),
    [collapsed, searchOpen]
  )

  return (
    <LayoutContext.Provider value={contextValue}>
      <div className="flex min-h-screen">
        <Sidebar />
        <main
          id="layout-content"
          className={`
            flex-1 min-w-0 min-h-screen overflow-x-hidden
            transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
            ${isRtl
              ? (collapsed ? 'mr-[62px] ml-0' : 'mr-[250px] ml-0')
              : (collapsed ? 'ml-[62px] mr-0' : 'ml-[250px] mr-0')
            }
          `}
        >
          <div className="p-7">
            {children}
          </div>
        </main>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </LayoutContext.Provider>
  )
}
