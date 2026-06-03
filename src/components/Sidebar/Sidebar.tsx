import { Link, useLocation } from 'react-router-dom'
import { useLayout } from '../Layout/Layout'

/* ─── Inline SVG Icons ─── */
const icons = {
  dashboard: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="2" />
      <rect x="14" y="3" width="7" height="5" rx="2" />
      <rect x="14" y="12" width="7" height="9" rx="2" />
      <rect x="3" y="16" width="7" height="5" rx="2" />
    </svg>
  ),
  patients: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  calendar: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  ),
  documents: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  ),
  prescription: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2h6v4H9z" />
      <path d="M7 4h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </svg>
  ),
  stats: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  chevronLeft: (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
}

/* ─── Navigation Config ─── */
interface NavItem {
  id: string
  label: string
  icon: JSX.Element
  path: string
  badge?: number
  section: 'main' | 'manage' | 'system'
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: icons.dashboard, path: '/', section: 'main' },
  { id: 'patients', label: 'Patients', icon: icons.patients, path: '/patients', section: 'main', badge: 12 },
  { id: 'appointments', label: 'Rendez-vous', icon: icons.calendar, path: '/appointments', section: 'main', badge: 3 },
  { id: 'documents', label: 'Documents', icon: icons.documents, path: '/documents', section: 'manage' },
  { id: 'prescriptions', label: 'Ordonnances', icon: icons.prescription, path: '/prescriptions', section: 'manage' },
  { id: 'statistics', label: 'Statistiques', icon: icons.stats, path: '/statistics', section: 'manage' },
  { id: 'settings', label: 'Paramètres', icon: icons.settings, path: '/settings', section: 'system' },
]

const sectionLabels: Record<string, string> = {
  main: 'Principal',
  manage: 'Gestion',
  system: 'Système',
}

/* ─── NavItem Component ─── */
function SidebarNavItem({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  return (
    <Link
      to={item.path}
      id={`nav-${item.id}`}
      className={`
        relative flex items-center rounded-xl transition-all duration-200 group cursor-pointer no-underline
        ${collapsed ? 'w-11 h-11 justify-center' : 'gap-3.5 px-3.5 py-2.5'}
        ${active
          ? 'bg-pink/10 text-white'
          : 'text-white/50 hover:text-white/90 hover:bg-white/[0.07]'
        }
      `}
    >
      {/* Active left-bar indicator */}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-gradient-to-b from-pink to-pink-light rounded-r" />
      )}

      {/* Icon */}
      <span className={`flex-shrink-0 flex items-center justify-center transition-transform duration-200 group-hover:scale-110 ${active ? 'text-pink drop-shadow-[0_0_6px_rgba(233,30,140,0.4)]' : ''}`}>
        {item.icon}
      </span>

      {/* Label */}
      {!collapsed && (
        <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
          {item.label}
        </span>
      )}

      {/* Badge (expanded) */}
      {!collapsed && item.badge && (
        <span className="ml-auto bg-gradient-to-r from-pink to-pink-light text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center shadow-[0_2px_8px_rgba(233,30,140,0.3)]">
          {item.badge}
        </span>
      )}

      {/* Badge dot (collapsed) */}
      {collapsed && item.badge && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-pink rounded-full shadow-[0_0_6px_rgba(233,30,140,0.5)]" />
      )}

      {/* Tooltip (collapsed) */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap bg-navy text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[60]">
          {item.label}
          {item.badge && (
            <span className="ml-1.5 bg-pink/20 text-pink-light text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {item.badge}
            </span>
          )}
        </span>
      )}
    </Link>
  )
}

/* ─── Main Sidebar ─── */
export default function Sidebar() {
  const { collapsed, setCollapsed } = useLayout()
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  const sections = ['main', 'manage', 'system'] as const
  const grouped = sections.map(s => ({
    key: s,
    label: sectionLabels[s],
    items: navItems.filter(i => i.section === s),
  }))

  return (
    <nav
      id="sidebar"
      className={`
        fixed left-0 top-0 h-screen z-50
        bg-gradient-to-b from-navy to-navy-dark
        flex flex-col
        shadow-[4px_0_24px_rgba(20,29,61,0.18)]
        transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${collapsed ? 'w-[62px]' : 'w-[250px]'}
      `}
    >
      {/* ── Header / Logo ── */}
      <div className={`flex items-center gap-3 border-b border-white/[0.07] flex-shrink-0 ${collapsed ? 'px-3 py-5 justify-center' : 'px-5 py-5'}`}>
        <div className="flex items-center justify-center flex-shrink-0 hover:scale-105 transition-transform duration-200">
          <img src="/logo.png" alt="Logo" className="w-9 h-9 object-contain" />
        </div>
        {!collapsed && (
          <div className="flex flex-col overflow-hidden whitespace-nowrap">
            <div className="inline-flex">
              <span className="text-[1.4rem] tracking-tight text-white">
                Ausc
              </span>
              <span className="text-[1.4rem] tracking-tight text-pink">
                ulta
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation Items ── */}
      <div className={`flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 py-4 ${collapsed ? 'px-2 items-center' : 'px-3'}`}>
        {grouped.map(section => (
          <div key={section.key} className="mb-1">
            {/* Section label (expanded) */}
            {!collapsed && (
              <div className="text-[10px] font-semibold uppercase tracking-[1.2px] text-white/25 px-3.5 pt-3 pb-2">
                {section.label}
              </div>
            )}
            {/* Section divider (collapsed) */}
            {collapsed && section.key !== 'main' && (
              <div className="w-6 h-px bg-white/10 mx-auto my-2" />
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map(item => (
                <SidebarNavItem
                  key={item.id}
                  item={item}
                  active={isActive(item.path)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div className={`border-t border-white/[0.07] flex-shrink-0 ${collapsed ? 'px-2 py-4' : 'px-3 py-4'}`}>
        {/* User card */}
        <div className={`flex items-center rounded-xl bg-white/[0.04] overflow-hidden mb-2.5 ${collapsed ? 'w-11 h-11 justify-center' : 'gap-3 px-3.5 py-2.5'}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-navy-light to-navy flex items-center justify-center flex-shrink-0 text-sm font-bold text-pink-light border-2 border-pink/20">
            DR
          </div>
          {!collapsed && (
            <div className="overflow-hidden whitespace-nowrap">
              <div className="text-[13px] font-semibold text-white leading-tight">Dr. Martin</div>
              <div className="text-[11px] text-white/35">Médecin Généraliste</div>
            </div>
          )}
        </div>

        {/* Toggle button */}
        <button
          id="sidebar-toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Étendre le menu' : 'Réduire le menu'}
          className={`
            group relative flex items-center justify-center w-full rounded-xl
            bg-white/5 text-white/45
            hover:bg-white/10 hover:text-white/80
            transition-all duration-200 cursor-pointer
            ${collapsed ? 'h-11' : 'gap-2.5 px-3.5 py-2.5'}
          `}
        >
          <span className={`flex-shrink-0 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}>
            {icons.chevronLeft}
          </span>
          {!collapsed && (
            <span className="text-[13px] font-medium whitespace-nowrap">Réduire</span>
          )}
          {collapsed && (
            <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap bg-navy text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[60]">
              Étendre le menu
            </span>
          )}
        </button>
      </div>
    </nav>
  )
}

export { type NavItem, navItems }
