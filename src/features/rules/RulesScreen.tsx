import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '../../api/auth'
import { isApiError } from '../../api/client'
import { listRulePacks } from '../../api/rulePacks'
import type { RulePack } from '../../contracts/pilot'
import { BUILT_IN_PACKS } from '../../domain/rules/packs'
import { copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'
import { RuleEditorPanel } from './editor/RuleEditorPanel'
import { ExcelPanel } from './excel/ExcelPanel'
import { RunPanel } from './RunPanel'
import './rules.css'

/**
 * Pilot WP-A: Sizing Studio rule packs (docs/v3/05). Three tabs:
 * run a model (client-side engine, trace, tests, save), Excel import/export
 * (WP-A2) and the rule editor (WP-A2).
 *
 * Built-in packs come from the bundle; team packs from `/api/rule-packs`. A
 * failing API never blocks the built-in pack: the error is shown, the rest
 * keeps working.
 */

type Tab = 'run' | 'excel' | 'editor'

const TABS: { key: Tab; label: ReturnType<typeof copy> }[] = [
  { key: 'run', label: copy('Chạy sizing', 'Run sizing') },
  { key: 'excel', label: copy('Import/Export Excel', 'Import/Export Excel') },
  { key: 'editor', label: copy('Soạn rule', 'Rule editor') },
]

export function RulesScreen({ text, language, user }: {
  text: TextFn
  language: 'vi' | 'en'
  /** The signed-in user (App passes it): a pack someone else owns opens in the editor as a copy. */
  user?: User | null
}) {
  const [tab, setTab] = useState<Tab>('run')
  // Panels mount on first visit and then stay mounted (hidden), so switching
  // tabs never throws away a half-edited rule or an import in progress.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['run']))
  const [serverPacks, setServerPacks] = useState<RulePack[]>([])
  const [packsError, setPacksError] = useState<string | null>(null)
  const [packId, setPackId] = useState(BUILT_IN_PACKS[0].id)
  const [reloadKey, setReloadKey] = useState(0)
  // The editor's own open pack: the Run tab picker never changes it, only an
  // explicit "Open in editor" does (request bumps so reopening resets too).
  const [editorPack, setEditorPack] = useState<{ pack: RulePack | null; request: number }>({ pack: null, request: 0 })
  const [editorDirty, setEditorDirty] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    listRulePacks(controller.signal)
      .then((result) => {
        setServerPacks(result.items.filter((pack) => !BUILT_IN_PACKS.some((builtIn) => builtIn.id === pack.id)))
        setPacksError(null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPacksError(isApiError(error) ? error.detail : String(error))
      })
    return () => controller.abort()
  }, [reloadKey])

  const refresh = useCallback((pack?: RulePack) => {
    setReloadKey((value) => value + 1)
    if (pack?.id) setPackId(pack.id)
  }, [])

  const packs = useMemo(() => [...BUILT_IN_PACKS, ...serverPacks], [serverPacks])

  const openTab = (key: Tab) => {
    setTab(key)
    setVisited((previous) => (previous.has(key) ? previous : new Set(previous).add(key)))
  }

  const openInEditor = (pack: RulePack) => {
    const discard = text(copy('Trình soạn đang có thay đổi chưa lưu. Bỏ chúng và mở pack này?', 'The rule editor has unsaved changes. Discard them and open this pack?'))
    if (editorDirty && !window.confirm(discard)) return
    setEditorPack((current) => ({ pack, request: current.request + 1 }))
    openTab('editor')
  }

  return (
    <div className="page-content rules-screen" data-studio="rules">
      <PageHeader
        eyebrow="SIZING STUDIO"
        title={text(copy('Sizing theo rule', 'Rule-based sizing'))}
        description={text(copy('Chạy rule pack, xem công thức từng bước, import rule từ Excel.', 'Run rule packs, see every step of the formula, import rules from Excel.'))}
        text={text}
        action={<span />}
      />
      <div className="rules-tabs" role="tablist" aria-label={text(copy('Chức năng rule', 'Rule tools'))}>
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`rules-tab-${item.key}`}
            aria-selected={tab === item.key}
            aria-controls={`rules-panel-${item.key}`}
            className="rules-tab"
            onClick={() => openTab(item.key)}
          >
            {text(item.label)}
          </button>
        ))}
      </div>
      {packsError && (
        <p className="rules-notice error" role="status" data-packs-error>
          {text(copy('Không tải được rule pack của nhóm; vẫn dùng được pack có sẵn.', 'Team rule packs could not be loaded; built-in packs still work.'))} {packsError}
        </p>
      )}
      <div role="tabpanel" id="rules-panel-run" aria-labelledby="rules-tab-run" hidden={tab !== 'run'}>
        <RunPanel text={text} language={language} packs={packs} packId={packId} onPackChange={setPackId} onOpenInEditor={openInEditor} />
      </div>
      {visited.has('excel') && (
        <div role="tabpanel" id="rules-panel-excel" aria-labelledby="rules-tab-excel" hidden={tab !== 'excel'}>
          <ExcelPanel text={text} language={language} onImported={refresh} user={user} />
        </div>
      )}
      {visited.has('editor') && (
        <div role="tabpanel" id="rules-panel-editor" aria-labelledby="rules-tab-editor" hidden={tab !== 'editor'}>
          <RuleEditorPanel
            text={text}
            language={language}
            initial={editorPack.pack}
            openRequest={editorPack.request}
            onSaved={refresh}
            onDirtyChange={setEditorDirty}
            user={user}
          />
        </div>
      )}
    </div>
  )
}
