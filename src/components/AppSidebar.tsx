import {
  BarChart3,
  Database,
  FlaskConical,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
  Star,
} from 'lucide-react'

export type WorkspaceView = 'Board' | 'Watchlist' | 'Model lab' | 'Data health'

interface AppSidebarProps {
  activeView: WorkspaceView
  collapsed: boolean
  watchlistCount: number
  onChangeView: (view: WorkspaceView) => void
  onToggleCollapsed: () => void
}

const navigation = [
  { label: 'Board' as const, icon: BarChart3 },
  { label: 'Watchlist' as const, icon: Star },
  { label: 'Model lab' as const, icon: FlaskConical },
  { label: 'Data health' as const, icon: Database },
]

export function AppSidebar({
  activeView,
  collapsed,
  watchlistCount,
  onChangeView,
  onToggleCollapsed,
}: AppSidebarProps) {
  return (
    <aside className={`app-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          <ScanSearch size={21} strokeWidth={2.2} />
        </span>
        <div className="brand-copy">
          <span>BASEBALL</span>
          <strong>ORACLE</strong>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Workspace">
        {navigation.map(({ label, icon: Icon }) => (
          <button
            className={activeView === label ? 'is-active' : ''}
            key={label}
            type="button"
            onClick={() => onChangeView(label)}
            title={label}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
            {label === 'Watchlist' && watchlistCount > 0 ? (
              <small>{watchlistCount}</small>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-status">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>Research build</strong>
          <span>Simulated forecasts</span>
        </div>
      </div>

      <button
        className="collapse-button"
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <PanelLeftOpen size={18} aria-hidden="true" />
        ) : (
          <PanelLeftClose size={18} aria-hidden="true" />
        )}
      </button>
    </aside>
  )
}
