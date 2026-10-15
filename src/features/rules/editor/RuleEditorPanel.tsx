import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  RuleCalc,
  RuleInput,
  RuleOutput,
  RulePack,
  RuleParam,
  RuleRounding,
  RuleSeverity,
  RuleTest,
  RuleWarning,
  SizingModelDef,
} from '../../../contracts/pilot'
import type { RuleError } from '../../../domain/rules/engine'
import { checkModels, safeCompile, type PackCheck } from '../../../domain/rules/excel/engineGuard'
import { copy, type TextFn } from '../../../ui/copy'
import { CheckResults } from '../excel/CheckResults'
import { errorText } from '../excel/download'
import { findPackByName, persistPack } from '../excel/savePack'
import {
  blankModel,
  blankPack,
  editableFrom,
  formatKv,
  nextModelId,
  packFromJson,
  parseKv,
  rowErrors,
  toDraft,
  unmatchedErrors,
  type EditablePack,
  type Section,
} from './editorModel'
import '../excel/excel.css'
import './editor.css'

/**
 * Pilot WP-A2: create or edit a rule pack in the browser (docs/v3/05 §6).
 * Tables for inputs, params, calc, outputs, warnings and tests; live
 * compileModel errors per row; run tests; save (published only when every
 * model compiles and every test passes); "Paste JSON" import.
 */
export function RuleEditorPanel({ text, initial, onSaved }: { text: TextFn; language: 'vi' | 'en'; initial?: RulePack | null; onSaved?: (pack: RulePack) => void }) {
  const [pack, setPack] = useState<EditablePack>(() => (initial ? editableFrom(initial) : blankPack()))
  const [selected, setSelected] = useState(0)
  const [check, setCheck] = useState<PackCheck | null>(null)
  const [forceDraft, setForceDraft] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<RulePack | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<RulePack | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [jsonOpen, setJsonOpen] = useState(false)

  const initialKey = initial ? `${initial.id}@${initial.version}` : ''
  useEffect(() => {
    setPack(initial ? editableFrom(initial) : blankPack())
    setSelected(0)
    setCheck(null)
    setSaved(null)
    setSaveError(null)
    setDuplicate(null)
    // Reset only when a different pack (or version) is handed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const model = pack.models[Math.min(selected, pack.models.length - 1)]
  const modelIndex = pack.models.indexOf(model)
  const compiled = useMemo(() => safeCompile(model), [model])
  const errors: RuleError[] = compiled.available && !compiled.value.ok ? compiled.value.errors : []

  const touch = (next: EditablePack) => {
    setPack(next)
    setCheck(null)
    setSaved(null)
  }
  const updateModel = (patch: Partial<SizingModelDef>) => {
    touch({ ...pack, models: pack.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)) })
  }
  function updateRow<K extends 'inputs' | 'params' | 'calc' | 'outputs' | 'warnings' | 'tests'>(key: K, index: number, patch: Partial<SizingModelDef[K][number]>) {
    const rows = model[key] as SizingModelDef[K][number][]
    updateModel({ [key]: rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) } as Partial<SizingModelDef>)
  }
  function addRow<K extends 'inputs' | 'params' | 'calc' | 'outputs' | 'warnings' | 'tests'>(key: K, row: SizingModelDef[K][number]) {
    updateModel({ [key]: [...(model[key] as unknown[]), row] } as Partial<SizingModelDef>)
  }
  const removeRow = (key: 'inputs' | 'params' | 'calc' | 'outputs' | 'warnings' | 'tests', index: number) => {
    updateModel({ [key]: (model[key] as unknown[]).filter((_, i) => i !== index) } as Partial<SizingModelDef>)
  }

  const addModel = () => {
    const next = { ...pack, models: [...pack.models, blankModel(nextModelId(pack.models))] }
    touch(next)
    setSelected(next.models.length - 1)
  }
  const removeModel = () => {
    if (pack.models.length <= 1) return
    touch({ ...pack, models: pack.models.filter((_, i) => i !== modelIndex) })
    setSelected(Math.max(0, modelIndex - 1))
  }

  const runTests = () => {
    const c = checkModels(pack.models)
    setCheck(c)
    return c
  }

  const save = async (mode: 'auto' | 'new' | 'update') => {
    setSaving(true)
    setSaveError(null)
    try {
      if (pack.name.trim() === '') throw new Error(text(copy('Cần tên rule pack.', 'The rule pack needs a name.')))
      const c = runTests()
      const status = !forceDraft && c.available && c.publishable ? 'published' : 'draft'
      let existing: RulePack | null = null
      if (mode === 'auto' && pack.id) {
        existing = { id: pack.id, name: pack.name, version: pack.version, status: pack.status, builtIn: false, models: pack.models }
      } else if (mode === 'auto') {
        const same = await findPackByName(pack.name)
        if (same) {
          setDuplicate(same)
          return
        }
      } else if (mode === 'update') {
        existing = duplicate
      }
      const stored = await persistPack(toDraft(pack, status), existing)
      setPack(editableFrom(stored))
      setSaved(stored)
      setDuplicate(null)
      onSaved?.(stored)
    } catch (e) {
      setSaveError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const loadJson = () => {
    const parsed = packFromJson(jsonText)
    if (!parsed.ok) {
      setJsonError(parsed.error)
      return
    }
    setJsonError(null)
    touch(parsed.pack)
    setSelected(0)
    setJsonOpen(false)
  }

  const calcNames = model.calc.map((c) => c.name)
  const fromChoices = [...calcNames, ...model.inputs.map((i) => i.name).filter((n) => !calcNames.includes(n))]
  const errorsOf = (section: Section, name: string | null, index: number) => rowErrors(errors, section, name, index)
  const loose = unmatchedErrors(errors, model)

  return (
    <section className="panel re-panel" data-panel="rules-editor">
      <div className="re-pack">
        <label>
          <span>{text(copy('Tên rule pack', 'Rule pack name'))}</span>
          <input value={pack.name} onChange={(e) => touch({ ...pack, name: e.target.value })} data-field="pack-name" />
        </label>
        <label className="re-wide">
          <span>{text(copy('Mô tả', 'Description'))}</span>
          <input value={pack.description} onChange={(e) => touch({ ...pack, description: e.target.value })} />
        </label>
        <div className="re-meta">
          {pack.id ? text(copy(`Đang sửa v${pack.version}`, `Editing v${pack.version}`)) : text(copy('Pack mới', 'New pack'))}
          {initial?.builtIn && <span className="status-pill amber">{text(copy('bản sao của pack built-in', 'copy of a built-in pack'))}</span>}
        </div>
      </div>

      <div className="re-json">
        <button type="button" className="text-button" onClick={() => setJsonOpen(!jsonOpen)} data-action="toggle-json">
          {text(copy('Dán JSON / xem JSON', 'Paste JSON / view JSON'))}
        </button>
        {jsonOpen && (
          <div className="re-json-box">
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={8} spellCheck={false} placeholder='{"name": "...", "models": [ ... ]}' data-field="json" />
            <div className="rx-actions">
              <button type="button" className="secondary-button" onClick={loadJson} data-action="load-json">
                {text(copy('Nạp JSON (tạo pack mới)', 'Load JSON (as a new pack)'))}
              </button>
              <button type="button" className="text-button" onClick={() => setJsonText(JSON.stringify(toDraft(pack, pack.status), null, 2))}>
                {text(copy('Đưa pack hiện tại ra JSON', 'Show the current pack as JSON'))}
              </button>
            </div>
            {jsonError && <p className="rx-callout rx-error" data-error="json">{jsonError}</p>}
          </div>
        )}
      </div>

      <div className="re-tabs" role="tablist">
        {pack.models.map((m, i) => (
          <button key={`${m.id}-${i}`} type="button" role="tab" aria-selected={i === modelIndex} className={i === modelIndex ? 're-tab active' : 're-tab'} onClick={() => setSelected(i)}>
            {m.id || '?'}
          </button>
        ))}
        <button type="button" className="text-button" onClick={addModel} disabled={pack.models.length >= 50} data-action="add-model">
          + {text(copy('model', 'model'))}
        </button>
        {pack.models.length > 1 && (
          <button type="button" className="text-button re-danger" onClick={removeModel}>
            {text(copy('Xóa model này', 'Remove this model'))}
          </button>
        )}
      </div>

      <div className="re-model-meta">
        <label>
          <span>id</span>
          <input value={model.id} onChange={(e) => updateModel({ id: e.target.value })} data-field="model-id" />
        </label>
        <label>
          <span>{text(copy('Tên (VI)', 'Name (VI)'))}</span>
          <input value={model.nameVi} onChange={(e) => updateModel({ nameVi: e.target.value })} />
        </label>
        <label>
          <span>{text(copy('Tên (EN)', 'Name (EN)'))}</span>
          <input value={model.nameEn} onChange={(e) => updateModel({ nameEn: e.target.value })} />
        </label>
        <label>
          <span>component type</span>
          <input value={model.componentType} onChange={(e) => updateModel({ componentType: e.target.value })} />
        </label>
        <label>
          <span>formula mode</span>
          <select value={model.formulaMode ?? 'units'} onChange={(e) => updateModel({ formulaMode: e.target.value as 'units' | 'excel' })} data-field="formula-mode">
            <option value="units">{text(copy('units (có đơn vị, tự quy đổi)', 'units (unit-aware, converts)'))}</option>
            <option value="excel">{text(copy('excel (số thô, như bảng tính)', 'excel (raw numbers, like a spreadsheet)'))}</option>
          </select>
        </label>
        <label className="re-wide">
          <span>{text(copy('Mô tả', 'Description'))}</span>
          <input value={model.description ?? ''} onChange={(e) => updateModel({ description: e.target.value || undefined })} />
        </label>
      </div>

      <div className="re-compile" data-compile={!compiled.available ? 'unavailable' : compiled.value.ok ? 'ok' : 'error'}>
        {!compiled.available
          ? <span className="status-pill amber">{text(copy('engine chưa sẵn sàng: chưa kiểm tra công thức', 'engine not available: formulas not checked'))}</span>
          : compiled.value.ok
            ? <span className="status-pill teal">{text(copy('compile OK', 'compiles'))}</span>
            : <span className="status-pill coral">{text(copy(`${errors.length} lỗi compile`, `${errors.length} compile error(s)`))}</span>}
        {loose.length > 0 && (
          <ul className="rx-issues">
            {loose.map((e, i) => (
              <li key={i} className="rx-issue error"><code>{e.where}</code> {e.message}</li>
            ))}
          </ul>
        )}
      </div>

      <EditorTable
        text={text}
        title={copy('Inputs', 'Inputs')}
        headers={['name', 'label VI', 'label EN', 'unit', 'default', 'min', 'max', 'source']}
        rows={model.inputs}
        section="inputs"
        rowName={(r) => r.name}
        errorsOf={errorsOf}
        onAdd={() => addRow('inputs', { name: `in_${model.inputs.length + 1}`, labelVi: '', labelEn: '', unit: 'count', default: 0 } satisfies RuleInput)}
        onRemove={(i) => removeRow('inputs', i)}
        cells={(r, i) => [
          <Text key="n" value={r.name} onChange={(v) => updateRow('inputs', i, { name: v })} mono />,
          <Text key="lv" value={r.labelVi} onChange={(v) => updateRow('inputs', i, { labelVi: v })} />,
          <Text key="le" value={r.labelEn} onChange={(v) => updateRow('inputs', i, { labelEn: v })} />,
          <Text key="u" value={r.unit} onChange={(v) => updateRow('inputs', i, { unit: v })} small />,
          <Num key="d" value={r.default} onChange={(v) => updateRow('inputs', i, { default: v ?? 0 })} />,
          <Num key="mi" value={r.min} optional onChange={(v) => updateRow('inputs', i, { min: v })} />,
          <Num key="ma" value={r.max} optional onChange={(v) => updateRow('inputs', i, { max: v })} />,
          <Text key="s" value={r.source ?? ''} onChange={(v) => updateRow('inputs', i, { source: v || undefined })} />,
        ]}
      />

      <EditorTable
        text={text}
        title={copy('Params (hằng số)', 'Params (constants)')}
        headers={['name', 'value', 'unit', 'source']}
        rows={model.params}
        section="params"
        rowName={(r) => r.name}
        errorsOf={errorsOf}
        onAdd={() => addRow('params', { name: `p_${model.params.length + 1}`, value: 0, unit: 'count' } satisfies RuleParam)}
        onRemove={(i) => removeRow('params', i)}
        cells={(r, i) => [
          <Text key="n" value={r.name} onChange={(v) => updateRow('params', i, { name: v })} mono />,
          <Num key="v" value={r.value} onChange={(v) => updateRow('params', i, { value: v ?? 0 })} />,
          <Text key="u" value={r.unit} onChange={(v) => updateRow('params', i, { unit: v })} small />,
          <Text key="s" value={r.source ?? ''} onChange={(v) => updateRow('params', i, { source: v || undefined })} />,
        ]}
      />

      <EditorTable
        text={text}
        title={copy('Calc (các bước tính, theo thứ tự)', 'Calc (steps, in order)')}
        headers={['name', 'formula (DSL)', 'unit', 'description']}
        rows={model.calc}
        section="calc"
        rowName={(r) => r.name}
        errorsOf={errorsOf}
        onAdd={() => addRow('calc', { name: `step_${model.calc.length + 1}`, formula: '0', unit: 'count' } satisfies RuleCalc)}
        onRemove={(i) => removeRow('calc', i)}
        cells={(r, i) => [
          <Text key="n" value={r.name} onChange={(v) => updateRow('calc', i, { name: v })} mono />,
          <div key="f" className="re-formula">
            {/* Editing the DSL drops the stored Excel text, so export re-translates it instead of writing a stale formula. */}
            <Text value={r.formula} onChange={(v) => updateRow('calc', i, { formula: v, excelFormula: undefined })} mono />
            {r.excelFormula && <span className="re-excel" title="Excel">{r.excelFormula}</span>}
          </div>,
          <Text key="u" value={r.unit} onChange={(v) => updateRow('calc', i, { unit: v })} small />,
          <Text key="d" value={r.description ?? ''} onChange={(v) => updateRow('calc', i, { description: v || undefined })} />,
        ]}
      />

      <EditorTable
        text={text}
        title={copy('Outputs', 'Outputs')}
        headers={['name', 'from', 'unit', 'rounding', 'label VI', 'label EN']}
        rows={model.outputs}
        section="outputs"
        rowName={(r) => r.name}
        errorsOf={errorsOf}
        onAdd={() => addRow('outputs', { name: fromChoices[0] ?? 'out', from: fromChoices[0] ?? '', unit: 'count', rounding: 'none' } satisfies RuleOutput)}
        onRemove={(i) => removeRow('outputs', i)}
        cells={(r, i) => [
          <Text key="n" value={r.name} onChange={(v) => updateRow('outputs', i, { name: v })} mono />,
          <select key="f" value={r.from} onChange={(e) => updateRow('outputs', i, { from: e.target.value })}>
            {!fromChoices.includes(r.from) && <option value={r.from}>{r.from || '—'}</option>}
            {fromChoices.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>,
          <Text key="u" value={r.unit} onChange={(v) => updateRow('outputs', i, { unit: v })} small />,
          <select key="r" value={r.rounding ?? 'none'} onChange={(e) => updateRow('outputs', i, { rounding: e.target.value as RuleRounding })}>
            {['none', 'ceil', 'floor', 'round'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>,
          <Text key="lv" value={r.labelVi ?? ''} onChange={(v) => updateRow('outputs', i, { labelVi: v || undefined })} />,
          <Text key="le" value={r.labelEn ?? ''} onChange={(v) => updateRow('outputs', i, { labelEn: v || undefined })} />,
        ]}
      />

      <EditorTable
        text={text}
        title={copy('Warnings (cảnh báo)', 'Warnings')}
        headers={['condition (DSL)', 'severity', 'message VI', 'message EN']}
        rows={model.warnings}
        section="warnings"
        rowName={() => null}
        errorsOf={errorsOf}
        onAdd={() => addRow('warnings', { condition: '', severity: 'medium', messageVi: '', messageEn: '' } satisfies RuleWarning)}
        onRemove={(i) => removeRow('warnings', i)}
        cells={(r, i) => [
          <Text key="c" value={r.condition} onChange={(v) => updateRow('warnings', i, { condition: v })} mono />,
          <select key="s" value={r.severity} onChange={(e) => updateRow('warnings', i, { severity: e.target.value as RuleSeverity })}>
            {['info', 'low', 'medium', 'high'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>,
          <Text key="mv" value={r.messageVi} onChange={(v) => updateRow('warnings', i, { messageVi: v })} />,
          <Text key="me" value={r.messageEn} onChange={(v) => updateRow('warnings', i, { messageEn: v })} />,
        ]}
      />

      <EditorTable
        text={text}
        title={copy('Tests (input → output kỳ vọng)', 'Tests (inputs → expected outputs)')}
        headers={['id', 'inputs (a=1, b=2)', 'expected (out=1)', 'tolerance']}
        rows={model.tests}
        section="tests"
        rowName={(r) => r.id}
        errorsOf={errorsOf}
        onAdd={() => addRow('tests', { id: `T${model.tests.length + 1}`, inputs: {}, expected: {}, tolerance: 0.000001 } satisfies RuleTest)}
        onRemove={(i) => removeRow('tests', i)}
        cells={(r, i) => [
          <Text key="id" value={r.id} onChange={(v) => updateRow('tests', i, { id: v })} mono small />,
          <KvField key="in" value={r.inputs} onCommit={(v) => updateRow('tests', i, { inputs: v })} />,
          <KvField key="ex" value={r.expected} onCommit={(v) => updateRow('tests', i, { expected: v })} />,
          <Num key="t" value={r.tolerance} onChange={(v) => updateRow('tests', i, { tolerance: v ?? 0 })} />,
        ]}
      />

      <LookupsField text={text} model={model} onCommit={(lookups) => updateModel({ lookups })} />

      <div className="rx-actions re-save">
        <button type="button" className="secondary-button" onClick={() => runTests()} disabled={saving} data-action="run-tests">
          {text(copy('Chạy test', 'Run tests'))}
        </button>
        <label className="re-check">
          <input type="checkbox" checked={forceDraft} onChange={(e) => setForceDraft(e.target.checked)} />
          {text(copy('Lưu dạng nháp', 'Save as draft'))}
        </label>
        <button type="button" className="primary-button" onClick={() => void save('auto')} disabled={saving} data-action="save">
          {saving ? text(copy('Đang lưu…', 'Saving…')) : pack.id ? text(copy('Lưu version mới', 'Save new version')) : text(copy('Lưu vào thư viện', 'Save to library'))}
        </button>
      </div>
      {check && <CheckResults text={text} check={check} />}
      {duplicate && (
        <div className="rx-callout rx-warn" data-dialog="duplicate">
          <span>{text(copy(`Đã có pack "${duplicate.name}" (v${duplicate.version}).`, `A pack named "${duplicate.name}" (v${duplicate.version}) exists.`))}</span>
          <div className="rx-actions">
            <button type="button" className="primary-button" onClick={() => void save('update')} disabled={saving}>
              {text(copy(`Cập nhật thành v${duplicate.version + 1}`, `Update to v${duplicate.version + 1}`))}
            </button>
            <button type="button" className="secondary-button" onClick={() => void save('new')} disabled={saving}>
              {text(copy('Lưu thành pack mới', 'Save as a new pack'))}
            </button>
            <button type="button" className="text-button" onClick={() => setDuplicate(null)}>{text(copy('Hủy', 'Cancel'))}</button>
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
          {text(copy('Không lưu được: ', 'Could not save: '))}
          {saveError}
        </p>
      )}
    </section>
  )
}

function EditorTable<T>({
  text,
  title,
  headers,
  rows,
  section,
  rowName,
  errorsOf,
  onAdd,
  onRemove,
  cells,
}: {
  text: TextFn
  title: { vi: string; en: string }
  headers: string[]
  rows: T[]
  section: Section
  rowName: (row: T) => string | null
  errorsOf: (section: Section, name: string | null, index: number) => RuleError[]
  onAdd: () => void
  onRemove: (index: number) => void
  cells: (row: T, index: number) => ReactNode[]
}) {
  return (
    <div className="re-section" data-section={section}>
      <div className="re-section-head">
        <h4>{text(title)}</h4>
        <button type="button" className="text-button" onClick={onAdd} data-action={`add-${section}`}>
          + {text(copy('thêm dòng', 'add row'))}
        </button>
      </div>
      <table className="rx-table re-table">
        <thead>
          <tr>
            {headers.map((h) => <th key={h}>{h}</th>)}
            <th aria-label="remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const errs = errorsOf(section, rowName(row), i)
            return [
              <tr key={`r${i}`} className={errs.length > 0 ? 'rx-failed' : undefined} data-row={`${section}-${i}`}>
                {cells(row, i).map((c, ci) => <td key={ci}>{c}</td>)}
                <td>
                  <button type="button" className="text-button re-danger" onClick={() => onRemove(i)} aria-label={text(copy('Xóa dòng', 'Remove row'))}>
                    ×
                  </button>
                </td>
              </tr>,
              errs.length > 0 && (
                <tr key={`e${i}`} className="re-error-row">
                  <td colSpan={headers.length + 1} data-row-error={`${section}-${i}`}>
                    {errs.map((e, k) => <div key={k}><code>{e.where}</code> {e.message}</div>)}
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function Text({ value, onChange, mono, small }: { value: string; onChange: (v: string) => void; mono?: boolean; small?: boolean }) {
  return <input className={`re-input${mono ? ' mono' : ''}${small ? ' small' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
}

/** Numeric input that keeps the raw text while typing ("0.", "-") and commits a number or undefined. */
function Num({ value, onChange, optional }: { value: number | undefined; onChange: (v: number | undefined) => void; optional?: boolean }) {
  const [raw, setRaw] = useState(value === undefined ? '' : String(value))
  useEffect(() => {
    setRaw((current) => (Number(current) === value && current.trim() !== '' ? current : value === undefined ? '' : String(value)))
  }, [value])
  const bad = raw.trim() !== '' && !Number.isFinite(Number(raw))
  return (
    <input
      className={`re-input num${bad || (!optional && raw.trim() === '') ? ' invalid' : ''}`}
      inputMode="decimal"
      value={raw}
      onChange={(e) => {
        const t = e.target.value
        setRaw(t)
        if (t.trim() === '') onChange(optional ? undefined : 0)
        else if (Number.isFinite(Number(t))) onChange(Number(t))
      }}
    />
  )
}

/** key=value list committed on blur; invalid text stays visible and marked. */
function KvField({ value, onCommit }: { value: Record<string, number>; onCommit: (v: Record<string, number>) => void }) {
  const [raw, setRaw] = useState(formatKv(value))
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setRaw(formatKv(value))
    setBad(false)
  }, [value])
  return (
    <input
      className={`re-input mono${bad ? ' invalid' : ''}`}
      value={raw}
      spellCheck={false}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const parsed = parseKv(raw)
        if (typeof parsed === 'string') setBad(true)
        else {
          setBad(false)
          onCommit(parsed)
        }
      }}
    />
  )
}

function LookupsField({ text, model, onCommit }: { text: TextFn; model: SizingModelDef; onCommit: (lookups: SizingModelDef['lookups']) => void }) {
  const [raw, setRaw] = useState(() => JSON.stringify(model.lookups, null, 1))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setRaw(JSON.stringify(model.lookups, null, 1))
    setError(null)
  }, [model.lookups])
  const commit = () => {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed) || !parsed.every((t) => t && typeof t.name === 'string' && Array.isArray(t.columns) && Array.isArray(t.rows))) {
        throw new Error('[{ "name": "...", "columns": [...], "rows": [[...]] }]')
      }
      setError(null)
      onCommit(parsed as SizingModelDef['lookups'])
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="re-section" data-section="lookups">
      <div className="re-section-head">
        <h4>{text(copy('Lookups (bảng tra, JSON)', 'Lookups (tables, JSON)'))}</h4>
      </div>
      <textarea className="re-lookups" rows={3} value={raw} spellCheck={false} onChange={(e) => setRaw(e.target.value)} onBlur={commit} />
      {error && <p className="rx-callout rx-error">{error}</p>}
    </div>
  )
}
