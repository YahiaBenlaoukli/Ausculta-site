import { createContext, useContext, useState } from 'react'
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

  return (
    <LayoutContext.Provider value={{ collapsed, setCollapsed }}>
      <div className="flex min-h-screen">
        <Sidebar />
        <main
          id="layout-content"
          className={`
            flex-1 min-h-screen
            transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
            ${collapsed ? 'ml-[62px]' : 'ml-[250px]'}
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
