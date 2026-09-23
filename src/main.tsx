/**
 * Entry point. Nothing but bootstrap lives here.
 *
 * Task 1.1 (`docs/development/systemsarchitect-build-scope.md`) split the
 * previous 292-line all-screens-inline version into:
 *   src/app/App.tsx          - shell: sidebar, topbar, language, module switch
 *   src/app/navigation.ts    - ModuleKey + navItems
 *   src/ui/*                 - PageHeader, ModulePanel, DatabaseIcon, copy()
 *   src/features/<module>/*  - one file per screen
 */
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './app/App'

const rootElement = document.getElementById('root')!
const runtime = globalThis as typeof globalThis & { __archPilotRoot?: ReturnType<typeof createRoot> }
const root = runtime.__archPilotRoot ?? createRoot(rootElement)
runtime.__archPilotRoot = root
root.render(<App />)

export default App
