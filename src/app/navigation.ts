import {
  Activity,
  BookOpen,
  Boxes,
  ClipboardList,
  CircleDollarSign,
  Compass,
  FileCheck2,
  Gauge,
  GitBranch,
  GraduationCap,
  LayoutDashboard,
  LayoutTemplate,
  Library,
  Lightbulb,
  Network,
  PenTool,
  Search,
  ShieldCheck,
  WandSparkles,
  Workflow,
} from 'lucide-react'
import { matchPath } from 'react-router'
import { copy, type Copy } from '../ui/copy'

/**
 * Navigation model (task 0.5; design-v2 4.2.1, D-14).
 *
 * Three sidebar groups:
 * 1. STUDIO - the v1 product surfaces, each a real route (`/designs`, `/hub`...).
 *    Screens not built yet render a "planned" page, so deep links already work.
 * 2. ARCHPILOT MODULES - the sixteen existing screens, unchanged, at
 *    `/m/<moduleKey>`; collapsed by default. `sizing` points at the Studio
 *    screen `/sizing`, which is the same calculator.
 * 3. EDITORIAL - editor and admin roles only.
 *
 * Adding a module is still: add the key, add the directory under
 * `src/features/`, add one line to `navItems` and one to `MODULE_SCREENS` in
 * App.tsx.
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

const MODULE_KEYS = new Set<string>(navItems.map((item) => item.key))

export function isModuleKey(value: string | undefined): value is ModuleKey {
  return value !== undefined && MODULE_KEYS.has(value)
}

/** Where a module lives. Sizing is a Studio screen now, so it has one URL, not two. */
export function modulePath(key: ModuleKey): string {
  return key === 'sizing' ? '/sizing' : `/m/${key}`
}

export type StudioKey = 'home' | 'designs' | 'wizard' | 'templates' | 'hub' | 'sizing' | 'learn' | 'editorial'

export interface StudioItem {
  key: StudioKey
  path: string
  icon: typeof LayoutDashboard
  label: Copy
  /** The screen that answers today; `planned` renders PlannedScreen with `phase`. */
  status: 'live' | 'planned'
  /** design-v2 section 5.2 phase that builds it. */
  phase?: string
  /** Screen eyebrow and one-line purpose. */
  eyebrow: string
  purpose: Copy
  /** Every route this item answers (react-router patterns). App.tsx builds its routes from these. */
  patterns: string[]
}

/**
 * STUDIO group, in sidebar order. The home item keeps the "Tổng quan /
 * Overview" label because `/` still renders the Overview screen; a dedicated
 * Home (continue design, next lesson, recent patterns) is a later phase.
 */
export const studioItems: StudioItem[] = [
  { key: 'home', path: '/', icon: LayoutDashboard, label: copy('Tổng quan', 'Overview'), status: 'live', eyebrow: 'HOME', purpose: copy('Bắt đầu từ đây.', 'Start here.'), patterns: ['/'] },
  { key: 'designs', path: '/designs', icon: PenTool, label: copy('Thiết kế', 'Designs'), status: 'planned', phase: '2', eyebrow: 'DESIGNS', purpose: copy('Canvas thiết kế logic, trung lập với nhà cung cấp, cho on-prem và đám mây.', 'The provider-neutral design canvas for on-prem and cloud.'), patterns: ['/designs', '/designs/:designId'] },
  { key: 'wizard', path: '/wizard', icon: WandSparkles, label: copy('Thiết kế có hướng dẫn', 'New guided design'), status: 'planned', phase: 'W', eyebrow: 'GUIDED DESIGN', purpose: copy('Bảng câu hỏi dựa trên quy tắc: nhu cầu, năng lực, thành phần gợi ý. Không dùng AI.', 'A rule-based questionnaire: needs, capacity, suggested components. No AI.'), patterns: ['/wizard', '/designs/:designId/brief/:step'] },
  { key: 'templates', path: '/templates', icon: LayoutTemplate, label: copy('Mẫu thiết kế', 'Templates'), status: 'planned', phase: '5', eyebrow: 'TEMPLATES', purpose: copy('Bắt đầu từ một thiết kế logic có sẵn.', 'Start from a ready-made logical design.'), patterns: ['/templates', '/templates/:slug'] },
  { key: 'hub', path: '/hub', icon: Library, label: copy('Thư viện tri thức', 'Knowledge hub'), status: 'planned', phase: '5', eyebrow: 'KNOWLEDGE HUB', purpose: copy('Thiết kế tham chiếu do nhóm tự viết, có trích dẫn nguồn gốc.', 'Reference designs written by the team, with attribution.'), patterns: ['/hub', '/hub/:slug'] },
  { key: 'sizing', path: '/sizing', icon: Gauge, label: copy('Sizing', 'Sizing'), status: 'live', eyebrow: 'SIZING', purpose: copy('Ước lượng năng lực có công thức và khoảng tin cậy.', 'Capacity estimates with formulas and ranges.'), patterns: ['/sizing'] },
  { key: 'learn', path: '/learn', icon: GraduationCap, label: copy('Học tập', 'Learn'), status: 'planned', phase: '6', eyebrow: 'LEARN', purpose: copy('Bài học ngắn với bài tập tự chấm theo quy tắc.', 'Short lessons with rule-checked exercises.'), patterns: ['/learn', '/learn/:slug'] },
]

export const editorialItem: StudioItem = {
  key: 'editorial', path: '/editorial', icon: BookOpen, label: copy('Biên tập', 'Editorial'), status: 'planned', phase: '5', eyebrow: 'EDITORIAL', purpose: copy('Soạn, tự chứng nhận và xuất bản nội dung.', 'Draft, self-certify and publish content.'),
  patterns: ['/editorial/*'],
}

export function canSeeEditorial(role: string): boolean {
  return role === 'editor' || role === 'admin'
}

/** The STUDIO item whose route patterns match `pathname` exactly, or undefined (e.g. a 404). */
export function studioItemFor(pathname: string): StudioItem | undefined {
  return [...studioItems, editorialItem].find((item) => item.patterns.some((pattern) => matchPath({ path: pattern, end: true }, pathname)))
}
