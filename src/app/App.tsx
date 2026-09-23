import { useState } from 'react'
import { ChevronDown, Compass, Search, Settings2 } from 'lucide-react'
import { copy, type Copy } from '../ui/copy'
import { navItems, type ModuleKey } from './navigation'
import { loadWorkspace, type WorkspaceRecord } from '../domain/store'
import { Overview } from '../features/overview/OverviewScreen'
import { Lifecycle } from '../features/lifecycle/LifecycleScreen'
import { UserBusiness } from '../features/user/UserBusinessScreen'
import { Requirements } from '../features/requirements/RequirementsScreen'
import { Architecture } from '../features/architecture/ArchitectureScreen'
import { ArchitectureEditor } from '../features/architecture/ArchitectureEditor'
import { Decisions } from '../features/decisions/DecisionsScreen'
import { PlatformMap } from '../features/platform/PlatformMapScreen'
import { Ucrops } from '../features/ucrops/UcropsScreen'
import { PatternFunnel } from '../features/patterns/PatternFunnelScreen'
import { DataModel } from '../features/data-model/DataModelScreen'
import { Knowledge } from '../features/knowledge/KnowledgeScreen'
import { Sizing } from '../features/sizing/SizingScreen'
import { Deployment } from '../features/deployment/DeploymentScreen'
import { Operations } from '../features/operations/OperationsScreen'
import { Innovation } from '../features/innovation/InnovationScreen'
import { Investment } from '../features/investment/InvestmentScreen'
import { InvestmentModal } from '../features/investment/InvestmentModal'
import { WorkspaceModal } from '../features/workspace/WorkspaceModal'

/**
 * The application shell: sidebar, topbar, language toggle, module switch and
 * the two modals. It owns no screen content — every screen lives in its own
 * file under `src/features/<module>/`.
 */
export function App() {
  const [activeModule, setActiveModule] = useState<ModuleKey>('overview')
  const [language, setLanguage] = useState<'vi' | 'en'>('vi')
  const [showInvestment, setShowInvestment] = useState(false)
  const [showWorkspace, setShowWorkspace] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(() => loadWorkspace())

  const text = (value: Copy) => value[language]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Compass size={20} strokeWidth={2.5} /></div>
          <div>
            <div className="brand-name">ArchPilot</div>
            <div className="brand-caption">decision workspace</div>
          </div>
        </div>

        <button className="workspace-switcher" onClick={() => setShowWorkspace(true)}>
          <div className="workspace-dot">AP</div>
          <div className="workspace-copy"><strong>{workspace?.name ?? 'Personal workspace'}</strong><span>{workspace?.systemName ?? 'Cloud & on-prem architecture lab'}</span></div>
          <ChevronDown size={15} />
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          <div className="nav-eyebrow">WORKSPACE</div>
          {navItems.map(({ key, icon: Icon, label }) => (
            <button className={`nav-item ${activeModule === key ? 'active' : ''}`} key={key} onClick={() => setActiveModule(key)}>
              <Icon size={17} />
              <span>{text(label)}</span>
              {key === 'investment' && <span className="nav-pulse">NEW</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="nav-eyebrow">CONNECTED</div>
          <div className="connection"><span className="status-dot green-dot" /> GitLab <span className="connected-label">connected</span></div>
          <div className="connection"><span className="status-dot green-dot" /> Targets <span className="connected-label">AWS · on-prem</span></div>
          <button className="nav-item muted"><Settings2 size={17} /><span>{text(copy('Cài đặt', 'Settings'))}</span></button>
          <div className="user-card"><div className="avatar">DV</div><div><strong>Architect</strong><span>Personal account</span></div><ChevronDown size={14} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>ArchPilot</span><span>/</span><strong>{text(navItems.find((item) => item.key === activeModule)?.label ?? copy('Tổng quan', 'Overview'))}</strong></div>
          <div className="top-actions">
            <button className="language-toggle" onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')}><span className={language === 'vi' ? 'selected' : ''}>VI</span><span className={language === 'en' ? 'selected' : ''}>EN</span></button>
            <button className="icon-button" title="Search"><Search size={18} /></button>
            <button className="avatar small">DV</button>
          </div>
        </header>

        {activeModule === 'overview' && <Overview text={text} onOpenInvestment={() => setShowInvestment(true)} onNavigate={setActiveModule} />}
        {activeModule === 'lifecycle' && <Lifecycle text={text} />}
        {activeModule === 'user' && <UserBusiness text={text} />}
        {activeModule === 'requirements' && <Requirements text={text} />}
        {activeModule === 'architecture' && <Architecture text={text} />}
        {activeModule === 'architecture' && <ArchitectureEditor text={text} />}
        {activeModule === 'decisions' && <Decisions text={text} />}
        {activeModule === 'platform' && <PlatformMap text={text} />}
        {activeModule === 'ucrops' && <Ucrops text={text} />}
        {activeModule === 'patterns' && <PatternFunnel text={text} />}
        {activeModule === 'data-model' && <DataModel text={text} />}
        {activeModule === 'knowledge' && <Knowledge text={text} />}
        {activeModule === 'sizing' && <Sizing text={text} />}
        {activeModule === 'deployment' && <Deployment text={text} />}
        {activeModule === 'operations' && <Operations text={text} />}
        {activeModule === 'innovation' && <Innovation text={text} />}
        {activeModule === 'investment' && <Investment text={text} />}
      </main>

      {showInvestment && <InvestmentModal text={text} onClose={() => setShowInvestment(false)} />}
      {showWorkspace && <WorkspaceModal text={text} workspace={workspace} onClose={() => setShowWorkspace(false)} onSave={(next) => { setWorkspace(next); setShowWorkspace(false) }} />}
    </div>
  )
}

export default App
