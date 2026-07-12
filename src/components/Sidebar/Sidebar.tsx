import { Link, useLocation } from 'react-router-dom'
import { useLayout } from '../Layout/Layout'
import { useTranslation } from 'react-i18next'

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
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
  { id: 'patients', label: 'Patients', icon: icons.patients, path: '/patients', section: 'main' },
  { id: 'appointments', label: 'Rendez-vous', icon: icons.calendar, path: '/appointments', section: 'main' },
  { id: 'documents', label: 'Documents', icon: icons.documents, path: '/documents', section: 'manage' },
  { id: 'prescriptions', label: 'Ordonnances', icon: icons.prescription, path: '/prescriptions', section: 'manage' },
  { id: 'statistics', label: 'Statistiques', icon: icons.stats, path: '/statistics', section: 'manage' },
  { id: 'settings', label: 'Paramètres', icon: icons.settings, path: '/settings', section: 'system' },
]

/* ─── Language options ─── */
const languages = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'عر' },
]

/* ─── NavItem Component ─── */
function SidebarNavItem({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const { t, i18n } = useTranslation()
  const isRtl = i18n.dir() === 'rtl'
  const translatedLabel = t(`sidebar.nav.${item.id}`)

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
      {/* Active side-bar indicator */}
      {active && (
        <span className={`absolute ${isRtl ? 'right-0 rounded-l' : 'left-0 rounded-r'} top-1/2 -translate-y-1/2 w-[3px] h-5 bg-gradient-to-b from-pink to-pink-light`} />
      )}

      {/* Icon */}
      <span className={`flex-shrink-0 flex items-center justify-center transition-transform duration-200 group-hover:scale-110 ${active ? 'text-pink drop-shadow-[0_0_6px_rgba(233,30,140,0.4)]' : ''}`}>
        {item.icon}
      </span>

      {/* Label */}
      {!collapsed && (
        <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
          {translatedLabel}
        </span>
      )}

      {/* Badge (expanded) */}
      {!collapsed && item.badge && (
        <span className={`${isRtl ? 'mr-auto ml-0' : 'ml-auto mr-0'} bg-gradient-to-r from-pink to-pink-light text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center shadow-[0_2px_8px_rgba(233,30,140,0.3)]`}>
          {item.badge}
        </span>
      )}

      {/* Badge dot (collapsed) */}
      {collapsed && item.badge && (
        <span className={`absolute top-1.5 ${isRtl ? 'left-1.5' : 'right-1.5'} w-2 h-2 bg-pink rounded-full shadow-[0_0_6px_rgba(233,30,140,0.5)]`} />
      )}

      {/* Tooltip (collapsed) */}
      {collapsed && (
        <span className={`pointer-events-none absolute ${isRtl ? 'right-full mr-3' : 'left-full ml-3'} whitespace-nowrap bg-navy text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[60]`}>
          {translatedLabel}
          {item.badge && (
            <span className={`${isRtl ? 'mr-1.5 ml-0' : 'ml-1.5 mr-0'} bg-pink/20 text-pink-light text-[10px] font-bold px-1.5 py-0.5 rounded-full`}>
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
  const { t, i18n } = useTranslation()
  const isRtl = i18n.dir() === 'rtl'
  const activeLang = i18n.language?.startsWith('ar') ? 'ar' : i18n.language?.startsWith('en') ? 'en' : 'fr';

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  const sections = ['main', 'manage', 'system'] as const
  const grouped = sections.map(s => ({
    key: s,
    label: t(`sidebar.sections.${s}`),
    items: navItems.filter(i => i.section === s),
  }))

  return (
    <nav
      id="sidebar"
      className={`
        fixed ${isRtl ? 'right-0' : 'left-0'} top-0 h-screen z-50
        bg-gradient-to-b from-navy to-navy-dark
        flex flex-col
        shadow-[4px_0_24px_rgba(20,29,61,0.18)]
        transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${collapsed ? 'w-[62px]' : 'w-[250px]'}
      `}
    >
      {/* ── Header / Logo + Collapse Arrow ── */}
      <div className={`flex border-b border-white/[0.07] flex-shrink-0 ${collapsed ? 'flex-col items-center px-3 py-4 gap-3' : 'flex-row items-center px-5 py-5 justify-between'}`}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center flex-shrink-0 hover:scale-105 transition-transform duration-200">
            <img src="./logo.png" alt="Logo" className="w-9 h-9 object-contain" />
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

        {/* Collapse/Expand toggle arrow */}
        <button
          id="sidebar-toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? t('sidebar.actions.expand') : t('sidebar.actions.collapse')}
          className="flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all duration-200 cursor-pointer w-7 h-7 flex-shrink-0"
        >
          <span className={`transition-transform duration-300 ${collapsed ? (isRtl ? '' : 'rotate-180') : (isRtl ? 'rotate-180' : '')}`}>
            {icons.chevronLeft}
          </span>
        </button>
      </div>

      {/* ── Navigation Items ── */}
      <div className={`flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 py-4 ${collapsed ? 'px-2 items-center' : 'px-3'}`}>
        {grouped.map(section => (
          <div key={section.key} className="mb-1 w-full">
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
            <div className="flex flex-col gap-0.5 w-full">
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

      {/* ── Footer: Language Selector Only ── */}
      <div className={`border-t border-white/[0.07] flex-shrink-0 ${collapsed ? 'px-2 py-4' : 'px-3 py-4'}`}>
        {/* Language selector — native select */}
        {!collapsed ? (
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.07]">
            <span className="text-[11px] text-white/40 font-medium">Langue</span>
            <select
              value={activeLang}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="bg-transparent text-white/80 text-xs font-semibold focus:outline-none cursor-pointer appearance-none pr-1"
            >
              <option value="fr" className="bg-navy text-white">Français</option>
              <option value="en" className="bg-navy text-white">English</option>
              <option value="ar" className="bg-navy text-white">العربية</option>
            </select>
          </div>
        ) : (
          <div className="relative group flex justify-center">
            <button
              className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Language"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </button>
            <div className={`absolute bottom-0 ${isRtl ? 'right-full mr-3' : 'left-full ml-3'} bg-navy border border-white/10 rounded-xl shadow-lg p-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150 z-50 flex flex-col gap-0.5 min-w-[110px]`}>
              {languages.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => i18n.changeLanguage(lang.code)}
                  className={`
                    w-full text-left px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer
                    ${activeLang === lang.code
                      ? 'bg-pink/15 text-pink font-bold'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }
                  `}
                >
                  {lang.code === 'fr' ? 'Français' : lang.code === 'en' ? 'English' : 'العربية'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}

export { type NavItem, navItems }
