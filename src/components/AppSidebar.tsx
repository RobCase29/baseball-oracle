import {
  BarChart3,
  FlaskConical,
  Goal,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
} from 'lucide-react'
import './AppSidebarFootballLink.css'

export type WorkspaceView = 'Board' | 'Model lab'

interface AppSidebarProps {
  activeView: WorkspaceView
  collapsed: boolean
  onChangeView: (view: WorkspaceView) => void
  onToggleCollapsed: () => void
}

const navigation = [
  { label: 'Board' as const, displayLabel: 'Rankings', icon: BarChart3 },
  { label: 'Model lab' as const, displayLabel: 'Model review', icon: FlaskConical },
]

export function AppSidebar({
  activeView,
  collapsed,
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
        {navigation.map(({ label, displayLabel, icon: Icon }) => (
          <button
            className={activeView === label ? 'is-active' : ''}
            key={label}
            type="button"
            onClick={() => onChangeView(label)}
            aria-current={activeView === label ? 'page' : undefined}
            title={displayLabel}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{displayLabel}</span>
          </button>
        ))}
        <a
          className="sport-switch-link"
          href="/football"
          title="Football Oracle"
        >
          <Goal size={18} aria-hidden="true" />
          <span>Football</span>
        </a>
      </nav>

      <div className="sidebar-status">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>Model in testing</strong>
          <span>Real players · Daily data</span>
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
