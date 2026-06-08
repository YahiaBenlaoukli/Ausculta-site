import { createContext, useContext, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Sidebar from '../Sidebar/Sidebar'

interface LayoutContextType {
  collapsed: boolean
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>
}

const LayoutContext = createContext<LayoutContextType>({
  collapsed: false,
  setCollapsed: () => { },
})

export const useLayout = () => useContext(LayoutContext)

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { i18n } = useTranslation()
  const isRtl = i18n.dir() === 'rtl'

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
    document.documentElement.lang = i18n.language
  }, [i18n.language, isRtl])

  return (
    <LayoutContext.Provider value={{ collapsed, setCollapsed }}>
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
    </LayoutContext.Provider>
  )
}
