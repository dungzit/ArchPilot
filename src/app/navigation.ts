import {
  Activity,
  Boxes,
  ClipboardList,
  CircleDollarSign,
  Compass,
  FileCheck2,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Lightbulb,
  Network,
  Search,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { copy, type Copy } from '../ui/copy'

/**
 * The module identifiers used by the shell. Each value maps 1:1 to a directory
 * under `src/features/`, so adding a screen is: add the key, add the directory,
 * add one line to `navItems` and one line to `App`'s module switch.
 */
export type ModuleKey = 'overview' | 'lifecycle' | 'user' | 'requirements' | 'architecture' | 'decisions' | 'platform' | 'ucrops' | 'patterns' | 'data-model' | 'knowledge' | 'sizing' | 'deployment' | 'operations' | 'innovation' | 'investment'

export const navItems: { key: ModuleKey; icon: typeof LayoutDashboard; label: Copy }[] = [
  { key: 'overview', icon: LayoutDashboard, label: copy('Tổng quan', 'Overview') },
  { key: 'lifecycle', icon: Compass, label: copy('6R lifecycle', '6R lifecycle') },
  { key: 'user', icon: Search, label: copy('6U user & business', '6U user & business') },
  { key: 'requirements', icon: ClipboardList, label: copy('Requirements / NFR', 'Requirements / NFR') },
  { key: 'architecture', icon: Boxes, label: copy('Thiết kế kiến trúc', 'Architecture') },
  { key: 'decisions', icon: FileCheck2, label: copy('ADR & review', 'ADR & review') },
  { key: 'platform', icon: Network, label: copy('Platform map', 'Platform map') },
  { key: 'ucrops', icon: ShieldCheck, label: copy('UCROPS quality', 'UCROPS quality') },
  { key: 'patterns', icon: Compass, label: copy('Pattern funnel', 'Pattern funnel') },
  { key: 'data-model', icon: GitBranch, label: copy('Data access', 'Data access') },
  { key: 'knowledge', icon: Search, label: copy('Knowledge base', 'Knowledge base') },
  { key: 'sizing', icon: Gauge, label: copy('Sizing & capacity', 'Sizing & capacity') },
  { key: 'deployment', icon: Workflow, label: copy('Thiết kế triển khai', 'Deployment design') },
  { key: 'operations', icon: Activity, label: copy('Tối ưu vận hành', 'Operations') },
  { key: 'innovation', icon: Lightbulb, label: copy('Technology radar', 'Technology radar') },
  { key: 'investment', icon: CircleDollarSign, label: copy('Investment & Value', 'Investment & Value') },
]
