import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { listRulePacks } from '../../../api/rulePacks'
import type { RulePack } from '../../../contracts/pilot'
import { checkModels, engineCachedResults, type PackCheck } from '../../../domain/rules/excel/engineGuard'
import { LIMITS } from '../../../domain/rules/excel/layout'
import type { ExcelIssue } from '../../../domain/rules/excel/messages'
import type { ImportResult, ModelPreview } from '../../../domain/rules/excel/importer'
import { copy, type TextFn } from '../../../ui/copy'
import { canUpdatePack, type PackUser } from '../editor/editorModel'
import { CheckResults } from './CheckResults'
import { downloadBytes, errorText } from './download'
import { findPackByName, persistPack } from './savePack'
import './excel.css'

/**
 * Pilot WP-A2: Excel template download, rule import and export (docs/v3/05 §4-5).
 * Flow: download template -> pick .xlsx -> preview (translation table, tests,
 * errors with cell addresses) -> check (compile + tests) -> save to library.
 * exceljs (~1 MB) is loaded on first use only.
 */
type ExcelModule = typeof import('../../../domain/rules/excel')
let excelModule: Promise<ExcelModule> | null = null
const loadExcel = () => (excelModule ??= import('../../../domain/rules/excel'))

type Busy = null | 'template' | 'import' | 'save' | 'export'

export function ExcelPanel({ text, onImported, user }: {
  text: TextFn
  language: 'vi' | 'en'
  onImported?: (pack: RulePack) => void
  /** The signed-in user: "Update to vN" on a same-name pack is offered only to its owner or an admin. */
  user?: PackUser | null
}) {
  const [busy, setBusy] = useState<Busy>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [check, setCheck] = useState<PackCheck | null>(null)
  const [duplicate, setDuplicate] = useState<RulePack | null>(null)
  const [saved, setSaved] = useState<RulePack | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [packs, setPacks] = useState<RulePack[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [exportIssues, setExportIssues] = useState<ExcelIssue[]>([])
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportedName, setExportedName] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const refreshPacks = useCallback(async () => {
    setListError(null)
    try {
      const list = await listRulePacks()
      setPacks(list.items)
      setSelectedId((current) => (current && list.items.some((p) => p.id === current) ? current : list.items[0]?.id ?? ''))
    } catch (e) {
      setPacks(null)
      setListError(errorText(e))
    }
  }, [])

  useEffect(() => {
    void refreshPacks()
  }, [refreshPacks])

  const downloadTemplate = async () => {
    setBusy('template')
    setTemplateError(null)
    try {
      const mod = await loadExcel()
      const { data, fileName: name } = await mod.buildTemplateWorkbook()
      downloadBytes(data, name)
    } catch (e) {
      setTemplateError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setCheck(null)
    setSaved(null)
    setSaveError(null)
    setDuplicate(null)
    if (file.size > LIMITS.maxFileBytes) {
      setResult({ pack: null, preview: null, issues: [{ severity: 'error', where: file.name, message: copy('File lớn hơn 5 MB.', 'The file is larger than 5 MB.') }] })
      return
    }
    setBusy('import')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const mod = await loadExcel()
      setResult(await mod.importRulePackXlsx(bytes, file.name))
    } catch (e) {
      setResult({ pack: null, preview: null, issues: [{ severity: 'error', where: file.name, message: copy(`Không đọc được file: ${errorText(e)}`, `Could not read the file: ${errorText(e)}`) }] })
    } finally {
      setBusy(null)
    }
  }

  const runCheck = (): PackCheck | null => {
    if (!result?.pack) return null
    const c = checkModels(result.pack.models)
    setCheck(c)
    return c
  }

  const save = async (mode: 'auto' | 'new' | 'update') => {
    const pack = result?.pack
    if (!pack) return
    setBusy('save')
    setSaveError(null)
    try {
      const c = check ?? runCheck()
      if (mode === 'auto') {
        const existing = await findPackByName(pack.name)
        if (existing) {
          setDuplicate(existing)
          return
        }
      }
      const status = c?.available && c.publishable ? 'published' : 'draft'
      const target = mode === 'update' && duplicate && canUpdatePack(duplicate, user) ? duplicate : null
      const stored = await persistPack({ ...pack, status }, target)
      setSaved(stored)
      setDuplicate(null)
      onImported?.(stored)
      void refreshPacks()
    } catch (e) {
      setSaveError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const exportSelected = async () => {
    const pack = packs?.find((p) => p.id === selectedId)
    if (!pack) return
    setBusy('export')
    setExportError(null)
    setExportIssues([])
    setExportedName(null)
    try {
      const mod = await loadExcel()
      const out = await mod.exportRulePackToXlsx(pack, {
        cachedResults: (model) => engineCachedResults(model, { rulePackId: pack.id, rulePackVersion: pack.version }),
      })
      downloadBytes(out.data, out.fileName)
      setExportIssues(out.issues)
      setExportedName(out.fileName)
    } catch (e) {
      setExportError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const errors = result?.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = result?.issues.filter((i) => i.severity === 'warning') ?? []

  return (
    <section className="panel rx-panel" data-panel="rules-excel">
      <div className="rx-row">
        <div>
          <h3 className="rx-title">{text(copy('1. Template mẫu', '1. Template'))}</h3>
          <p className="muted-copy rx-help">
            {text(copy('Ví dụ Kafka (05 §9) với công thức Excel thật dùng defined name. Sheet HuongDan giải thích cách sửa.', 'Kafka example (05 §9) with real Excel formulas over defined names. The HuongDan sheet explains how to edit it.'))}
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void downloadTemplate()} disabled={busy !== null} data-action="download-template">
          {busy === 'template' ? text(copy('Đang tạo…', 'Building…')) : text(copy('Tải template mẫu', 'Download template'))}
        </button>
      </div>
      {templateError && <p className="rx-callout rx-error">{templateError}</p>}

      <div className="rx-row">
        <div>
          <h3 className="rx-title">{text(copy('2. Import file Excel', '2. Import an Excel file'))}</h3>
          <p className="muted-copy rx-help">
            {text(copy('Chỉ .xlsx, tối đa 5 MB, 2.000 dòng mỗi sheet, 50 model. Lỗi nào cũng báo kèm địa chỉ ô và không tạo pack dở dang.', '.xlsx only, at most 5 MB, 2,000 rows per sheet, 50 models. Every error shows its cell address and no partial pack is created.'))}
          </p>
        </div>
        <label className="primary-button rx-file">
          {busy === 'import' ? text(copy('Đang đọc…', 'Reading…')) : text(copy('Chọn file .xlsx', 'Choose .xlsx file'))}
          <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void onFile(e)} disabled={busy !== null} data-input="xlsx" />
        </label>
      </div>

      {result && (
        <div className="rx-result" data-import={result.pack ? 'ok' : 'error'}>
          <p className={result.pack ? 'rx-callout rx-ok' : 'rx-callout rx-error'}>
            <strong>{fileName}</strong>{' '}
            {result.pack
              ? text(copy(`Đọc được ${result.pack.models.length} model, ${warnings.length} cảnh báo.`, `Read ${result.pack.models.length} model(s), ${warnings.length} warning(s).`))
              : text(copy(`${errors.length} lỗi: chưa tạo pack nào. Sửa file rồi import lại.`, `${errors.length} error(s): no pack was created. Fix the file and import again.`))}
          </p>
          {result.issues.length > 0 && (
            <ul className="rx-issues" data-list="issues">
              {[...errors, ...warnings].map((issue, i) => (
                <li key={i} className={`rx-issue ${issue.severity}`}>
                  <code>{issue.where}</code> {text(issue.message)}
                </li>
              ))}
            </ul>
          )}
          {result.preview && (
            <div className="rx-preview">
              <p className="rx-pack-line">
                <strong>{result.preview.packName}</strong> · v{result.preview.version}
                {result.preview.description && <span className="muted-copy"> · {result.preview.description}</span>}
              </p>
              {result.preview.models.map((m) => (
                <ModelPreviewView key={m.model.id} text={text} preview={m} />
              ))}
            </div>
          )}
          {result.pack && (
            <div className="rx-actions">
              <button type="button" className="secondary-button" onClick={() => runCheck()} disabled={busy !== null} data-action="check">
                {text(copy('Kiểm tra', 'Check'))}
              </button>
              <button type="button" className="primary-button" onClick={() => void save('auto')} disabled={busy !== null || saved !== null} data-action="save">
                {busy === 'save' ? text(copy('Đang lưu…', 'Saving…')) : text(copy('Lưu vào thư viện', 'Save to library'))}
              </button>
            </div>
          )}
          {check && <CheckResults text={text} check={check} />}
          {duplicate && (
            <div className="rx-callout rx-warn" data-dialog="duplicate">
              <span>
                {canUpdatePack(duplicate, user)
                  ? text(copy(`Đã có pack "${duplicate.name}" (v${duplicate.version}). Cập nhật thành version mới hay lưu thành pack riêng?`, `A pack named "${duplicate.name}" (v${duplicate.version}) exists. Update it to a new version or save a separate pack?`))
                  : text(copy(
                    `Đã có pack "${duplicate.name}" (v${duplicate.version})${duplicate.owner ? ` của ${duplicate.owner}` : ''}; chỉ chủ sở hữu hoặc admin mới cập nhật được. Lưu thành pack riêng?`,
                    `A pack named "${duplicate.name}" (v${duplicate.version})${duplicate.owner ? ` owned by ${duplicate.owner}` : ''} exists; only its owner or an admin can update it. Save it as a separate pack?`,
                  ))}
              </span>
              <div className="rx-actions">
                {canUpdatePack(duplicate, user) && (
                  <button type="button" className="primary-button" onClick={() => void save('update')} disabled={busy !== null} data-action="save-update">
                    {text(copy(`Cập nhật thành v${duplicate.version + 1}`, `Update to v${duplicate.version + 1}`))}
                  </button>
                )}
                <button type="button" className="secondary-button" onClick={() => void save('new')} disabled={busy !== null} data-action="save-new">
                  {canUpdatePack(duplicate, user) ? text(copy('Lưu thành pack mới', 'Save as a new pack')) : text(copy('Lưu thành pack riêng', 'Save as a separate pack'))}
                </button>
                <button type="button" className="text-button" onClick={() => setDuplicate(null)}>
                  {text(copy('Hủy', 'Cancel'))}
                </button>
              </div>
            </div>
          )}
          {saved && (
            <p className="rx-callout rx-ok" data-saved={saved.status}>
              {text(copy(`Đã lưu "${saved.name}" v${saved.version}, trạng thái`, `Saved "${saved.name}" v${saved.version}, status`))}{' '}
              <span className={saved.status === 'published' ? 'status-pill teal' : 'status-pill amber'}>{saved.status}</span>
            </p>
          )}
          {saveError && (
            <p className="rx-callout rx-error" data-error="save">
              {text(copy('Không lưu được (backend rule pack có thể chưa sẵn sàng): ', 'Could not save (the rule-pack backend may not be ready): '))}
              {saveError}
            </p>
          )}
        </div>
      )}

      <div className="rx-row rx-export">
        <div>
          <h3 className="rx-title">{text(copy('3. Export rule pack ra Excel', '3. Export a rule pack to Excel'))}</h3>
          <p className="muted-copy rx-help">
            {text(copy('Model dạng excel ghi lại công thức Excel; model dạng units ghi DSL vào cột dsl_formula (Excel không tính).', 'Excel-mode models get their Excel formulas back; units-mode models carry DSL in dsl_formula (Excel does not compute it).'))}
          </p>
        </div>
        <div className="rx-export-controls">
          {packs && packs.length > 0 && (
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} aria-label={text(copy('Chọn rule pack', 'Choose a rule pack'))} data-input="export-pack">
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · v{p.version} · {p.status}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="secondary-button" onClick={() => void exportSelected()} disabled={busy !== null || !selectedId} data-action="export">
            {busy === 'export' ? text(copy('Đang xuất…', 'Exporting…')) : text(copy('Tải .xlsx', 'Download .xlsx'))}
          </button>
          <button type="button" className="text-button" onClick={() => void refreshPacks()}>
            {text(copy('Tải lại danh sách', 'Reload list'))}
          </button>
        </div>
      </div>
      {packs && packs.length === 0 && <p className="muted-copy">{text(copy('Thư viện chưa có rule pack nào.', 'The library has no rule packs yet.'))}</p>}
      {listError && (
        <p className="rx-callout rx-warn" data-error="list">
          {text(copy('Không tải được danh sách rule pack: ', 'Could not load rule packs: '))}
          {listError}
        </p>
      )}
      {exportedName && <p className="rx-callout rx-ok">{text(copy(`Đã tạo ${exportedName}.`, `Created ${exportedName}.`))}</p>}
      {exportError && <p className="rx-callout rx-error">{exportError}</p>}
      {exportIssues.length > 0 && (
        <ul className="rx-issues">
          {exportIssues.map((issue, i) => (
            <li key={i} className={`rx-issue ${issue.severity}`}>
              <code>{issue.where}</code> {text(issue.message)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function fmt(v: number | undefined | null): string {
  return v === undefined || v === null ? '' : String(v)
}

function ModelPreviewView({ text, preview }: { text: TextFn; preview: ModelPreview }) {
  const m = preview.model
  return (
    <article className="rx-model" data-model={m.id}>
      <header className="rx-model-head">
        <strong>{m.id}</strong> · {text(copy(m.nameVi, m.nameEn))} · <code>{m.componentType}</code>{' '}
        <span className="status-pill teal">{m.formulaMode ?? 'units'}</span>
      </header>
      <div className="rx-grid">
        <div>
          <h4>{text(copy('Inputs', 'Inputs'))}</h4>
          <table className="rx-table">
            <thead>
              <tr>
                <th>name</th>
                <th>{text(copy('nhãn', 'label'))}</th>
                <th>unit</th>
                <th>default</th>
                <th>min–max</th>
              </tr>
            </thead>
            <tbody>
              {m.inputs.map((i) => (
                <tr key={i.name}>
                  <td><code>{i.name}</code></td>
                  <td>{text(copy(i.labelVi, i.labelEn))}</td>
                  <td>{i.unit}</td>
                  <td className="num">{i.default}</td>
                  <td className="num">{fmt(i.min)}–{fmt(i.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h4>Params</h4>
          <table className="rx-table">
            <thead>
              <tr>
                <th>name</th>
                <th>value</th>
                <th>unit</th>
                <th>source</th>
              </tr>
            </thead>
            <tbody>
              {m.params.map((p) => (
                <tr key={p.name}>
                  <td><code>{p.name}</code></td>
                  <td className="num">{p.value}</td>
                  <td>{p.unit}</td>
                  <td>{p.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h4>{text(copy('Calc: công thức Excel → DSL', 'Calc: Excel formula → DSL'))}</h4>
      <table className="rx-table rx-translation" data-table="translation">
        <thead>
          <tr>
            <th>{text(copy('bước', 'step'))}</th>
            <th>{text(copy('ô', 'cell'))}</th>
            <th>Excel</th>
            <th>DSL</th>
            <th>{text(copy('giá trị Excel đã lưu', 'Excel cached value'))}</th>
            <th>unit</th>
          </tr>
        </thead>
        <tbody>
          {preview.calcRows.map((r) => (
            <tr key={r.where} className={r.failed ? 'rx-failed' : undefined}>
              <td><code>{r.name}</code></td>
              <td><code>{r.where}</code></td>
              <td><code>{r.excelFormula ?? '—'}</code></td>
              <td><code>{r.dsl ?? '—'}</code></td>
              <td className="num">{r.cached ?? r.cachedText ?? '—'}</td>
              <td>{r.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rx-grid">
        <div>
          <h4>Outputs</h4>
          <table className="rx-table">
            <thead>
              <tr>
                <th>name</th>
                <th>from</th>
                <th>unit</th>
                <th>rounding</th>
              </tr>
            </thead>
            <tbody>
              {m.outputs.map((o) => (
                <tr key={o.name}>
                  <td><code>{o.name}</code></td>
                  <td><code>{o.from}</code></td>
                  <td>{o.unit}</td>
                  <td>{o.rounding ?? 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h4>Warnings</h4>
          <table className="rx-table">
            <thead>
              <tr>
                <th>{text(copy('điều kiện', 'condition'))}</th>
                <th>DSL</th>
                <th>severity</th>
              </tr>
            </thead>
            <tbody>
              {preview.warningRows.map((w) => (
                <tr key={w.where} className={w.failed ? 'rx-failed' : undefined}>
                  <td><code>{w.condition}</code></td>
                  <td><code>{w.dsl ?? '—'}</code></td>
                  <td>{w.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h4>Tests</h4>
      <table className="rx-table" data-table="tests">
        <thead>
          <tr>
            <th>id</th>
            <th>inputs</th>
            <th>{text(copy('kỳ vọng', 'expected'))}</th>
            <th>tolerance</th>
          </tr>
        </thead>
        <tbody>
          {m.tests.map((t) => (
            <tr key={t.id}>
              <td>
                <code>{t.id}</code>{' '}
                {preview.autoTestIds.includes(t.id) && <span className="status-pill amber">{text(copy('tự tạo từ giá trị Excel', 'auto from Excel values'))}</span>}
              </td>
              <td><code>{Object.entries(t.inputs).map(([k, v]) => `${k}=${v}`).join(', ')}</code></td>
              <td><code>{Object.entries(t.expected).map(([k, v]) => `${k}=${v}`).join(', ')}</code></td>
              <td className="num">{t.tolerance}</td>
            </tr>
          ))}
          {m.tests.length === 0 && (
            <tr>
              <td colSpan={4}>{text(copy('Chưa có test: pack sẽ chỉ được lưu dạng draft.', 'No tests: the pack can only be saved as draft.'))}</td>
            </tr>
          )}
        </tbody>
      </table>
    </article>
  )
}
