import { useEffect, useState } from 'react'
import { ChevronDown, Compass, LogOut, Search, Settings2 } from 'lucide-react'
import { currentUser, logout, type User } from '../api/auth'
import { isApiError, setUnauthorizedHandler } from '../api/client'
import { LoginScreen, type LoginNotice } from '../features/auth/LoginScreen'
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

type Language = 'vi' | 'en'

type Session =
  | { status: 'checking' }
  | { status: 'anonymous'; notice: LoginNotice | null }
  | { status: 'authenticated'; user: User }

/**
 * Auth gate (task 1.2). Asks `/api/auth/me` once on load: a 401 shows the
 * login screen, a user shows the shell. Any later 401 from any API call
 * (session expired or revoked) routes back to login via client.ts's
 * unauthorized handler. Owns the VI/EN choice so it survives sign-in.
 */
export function App() {
  const [language, setLanguage] = useState<Language>('vi')
  const [session, setSession] = useState<Session>({ status: 'checking' })
  const text = (value: Copy) => value[language]
  const toggleLanguage = () => setLanguage(language === 'vi' ? 'en' : 'vi')

  useEffect(() => {
    const controller = new AbortController()
    currentUser(controller.signal)
      .then((user) => setSession(user ? { status: 'authenticated', user } : { status: 'anonymous', notice: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const unreachable = isApiError(error) && error.kind === 'unreachable'
        setSession({ status: 'anonymous', notice: unreachable ? 'unreachable' : null })
      })
    return () => controller.abort()
  }, [])

  // index.html declares lang="vi"; keep it true after a toggle so screen
  // readers pronounce the English copy as English.
  useEffect(() => { document.documentElement.lang = language }, [language])

  useEffect(() => setUnauthorizedHandler(() => setSession({ status: 'anonymous', notice: 'expired' })), [])

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // The session may already be gone server-side; leaving is still right.
    }
    setSession({ status: 'anonymous', notice: 'signed-out' })
  }

  if (session.status === 'checking') {
    return <div className="auth-splash" role="status">{text(copy('Đang kiểm tra phiên đăng nhập…', 'Checking your session…'))}</div>
  }
  if (session.status === 'anonymous') {
    return (
      <LoginScreen
        text={text}
        language={language}
        onToggleLanguage={toggleLanguage}
        notice={session.notice}
        onLoggedIn={(user) => setSession({ status: 'authenticated', user })}
      />
    )
  }
  return <AppShell language={language} onToggleLanguage={toggleLanguage} user={session.user} onLogout={handleLogout} />
}

function initials(name: string): string {
  const letters = name.trim().split(/\s+/).map((word) => word[0] ?? '').join('')
  return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters || '?').toUpperCase()
}

/**
 * The application shell: sidebar, topbar, language toggle, module switch and
 * the two modals. It owns no screen content — every screen lives in its own
 * file under `src/features/<module>/`.
 */
function AppShell({ language, onToggleLanguage, user, onLogout }: { language: Language; onToggleLanguage: () => void; user: User; onLogout: () => void }) {
  const [activeModule, setActiveModule] = useState<ModuleKey>('overview')
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
          <div className="user-card"><div className="avatar">{initials(user.displayName)}</div><div><strong>{user.displayName}</strong><span>{user.username} · {user.role}</span></div><ChevronDown size={14} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>ArchPilot</span><span>/</span><strong>{text(navItems.find((item) => item.key === activeModule)?.label ?? copy('Tổng quan', 'Overview'))}</strong></div>
          <div className="top-actions">
            <button className="language-toggle" onClick={onToggleLanguage}><span className={language === 'vi' ? 'selected' : ''}>VI</span><span className={language === 'en' ? 'selected' : ''}>EN</span></button>
            <button className="icon-button" title="Search"><Search size={18} /></button>
            <button className="avatar small" title={user.displayName}>{initials(user.displayName)}</button>
            <button className="secondary-button logout-button" onClick={onLogout}><LogOut size={15} aria-hidden="true" />{text(copy('Đăng xuất', 'Log out'))}</button>
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
