import { createContext, useContext } from 'react'

interface LayoutContextType {
  collapsed: boolean
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  /** Global search palette. Owned here so the Sidebar trigger and the
   *  Ctrl+K shortcut drive the same overlay, which Layout renders. */
  searchOpen: boolean
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export const LayoutContext = createContext<LayoutContextType>({
  collapsed: false,
  setCollapsed: () => { },
  searchOpen: false,
  setSearchOpen: () => { },
})

export const useLayout = () => useContext(LayoutContext)
