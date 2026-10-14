import { FlaskConical, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RulePack, SizingModelDef, SizingRun } from '../../contracts/pilot'
import { compileModel, evaluateModel, runModelTests, type ModelTestResult } from '../../domain/rules/engine'
import { formatDisplay } from '../../domain/rules/format'
import { isSilentUnit } from '../../domain/rules/units'
import { copy, type TextFn } from '../../ui/copy'
import { defaultValues, parseInputs, type RawValues } from './inputValues'
import { SavedRuns } from './SavedRuns'

/**
 * "Run sizing" tab (pilot WP-A, docs/v3/05 §6 preview, 02 §10 trace).
 * Everything here recomputes client-side on each keystroke: the engine is
 * pure and a model has at most a few hundred steps.
 */

type Language = 'vi' | 'en'

const unitSuffix = (unit: string) => (isSilentUnit(unit) ? '' : unit === '%' ? '%' : ` ${unit}`)
const severityClass: Record<string, string> = { high: 'coral', medium: 'amber', low: 'teal', info: 'teal' }

export function packLabel(pack: RulePack, text: TextFn): string {
  const origin = pack.builtIn ? text(copy('có sẵn', 'built-in')) : pack.status
  return `${pack.name} · v${pack.version} · ${origin}`
}

export function RunPanel({ text, language, packs, packId, onPackChange }: {
  text: TextFn
  language: Language
  packs: RulePack[]
  packId: string
  onPackChange: (id: string) => void
}) {
  const pack = packs.find((candidate) => candidate.id === packId) ?? packs[0]
  const [modelId, setModelId] = useState('')
  const model: SizingModelDef | undefined = pack?.models.find((candidate) => candidate.id === modelId) ?? pack?.models[0]
  // Form state belongs to one pack version + model; switching either starts from its defaults.
  const modelKey = `${pack?.id}@${pack?.version}/${model?.id}`
  const [form, setForm] = useState<{ key: string; values: RawValues }>({ key: '', values: {} })
  const [tests, setTests] = useState<{ key: string; results: ModelTestResult[] } | null>(null)
  const raw = useMemo(() => (form.key === modelKey ? form.values : model ? defaultValues(model) : {}), [form, modelKey, model])

  const compiled = useMemo(() => (model ? compileModel(model) : null), [model])
  const parsed = useMemo(() => (model ? parseInputs(model, raw) : null), [model, raw])
  const outcome = useMemo((): { run: SizingRun } | { error: string } | null => {
    if (!model || !pack || !compiled?.ok || !parsed || Object.keys(parsed.errors).length) return null
    try {
      return { run: evaluateModel(model, parsed.values, { rulePackId: pack.id, rulePackVersion: pack.version }) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [model, pack, compiled, parsed])
  const run = outcome && 'run' in outcome ? outcome.run : null

  if (!pack || !model) {
    return <section className="panel"><p>{text(copy('Không có rule pack nào để chạy.', 'There is no rule pack to run.'))}</p></section>
  }

  const pick = (vi: string | undefined, en: string | undefined) => (language === 'vi' ? vi || en : en || vi) ?? ''
  const setValue = (name: string, value: string) => setForm({ key: modelKey, values: { ...raw, [name]: value } })
  const calcByName = new Map(model.calc.map((step) => [step.name, step]))
  const outputLabel = (name: string) => {
    const output = model.outputs.find((candidate) => candidate.name === name)
    return pick(output?.labelVi, output?.labelEn) || name
  }
  const bindingStep = run?.binding ? run.steps.find((step) => step.name === run.binding) : undefined
  const testResults = tests?.key === modelKey ? tests.results : null
  const passedCount = testResults?.filter((result) => result.passed).length ?? 0

  return (
    <div className="rules-run">
      <section className="panel rules-pickers" aria-label={text(copy('Chọn model', 'Choose a model'))}>
        <div className="calc-field">
          <label htmlFor="rules-pack">{text(copy('Rule pack', 'Rule pack'))}</label>
          <select id="rules-pack" value={pack.id} onChange={(event) => { onPackChange(event.target.value); setModelId('') }}>
            {packs.map((candidate) => <option key={candidate.id} value={candidate.id}>{packLabel(candidate, text)}</option>)}
          </select>
        </div>
        <div className="calc-field">
          <label htmlFor="rules-model">{text(copy('Sizing model', 'Sizing model'))}</label>
          <select id="rules-model" value={model.id} onChange={(event) => setModelId(event.target.value)}>
            {pack.models.map((candidate) => <option key={candidate.id} value={candidate.id}>{pick(candidate.nameVi, candidate.nameEn)} ({candidate.componentType})</option>)}
          </select>
        </div>
        {model.description && <p className="calc-help rules-description">{model.description}</p>}
        {model.formulaMode === 'excel' && <p className="calc-help">{text(copy('Model import từ Excel: số được dùng nguyên giá trị, không quy đổi đơn vị.', 'Imported from Excel: numbers are used as-is, without unit conversion.'))}</p>}
      </section>

      <div className="calc-two">
        <form className="panel calc-form" onSubmit={(event) => event.preventDefault()} aria-label={text(copy('Đầu vào', 'Inputs'))}>
          <h2 className="calc-heading">{text(copy('Đầu vào', 'Inputs'))}</h2>
          <fieldset>
            <legend>{text(copy('Giá trị nhập', 'Values'))}</legend>
            {model.inputs.map((input) => {
              const error = parsed?.errors[input.name]
              const id = `rule-input-${input.name}`
              return (
                <div className="calc-field" key={input.name}>
                  <label htmlFor={id}>{pick(input.labelVi, input.labelEn) || input.name} {input.unit && <span className="calc-unit">({input.unit})</span>}</label>
                  <input
                    id={id}
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={raw[input.name] ?? ''}
                    min={input.min}
                    max={input.max}
                    aria-invalid={error ? 'true' : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(event) => setValue(input.name, event.target.value)}
                  />
                  {error && <span className="calc-error" id={`${id}-error`}>{text(error)}</span>}
                  {input.source && <span className="calc-help">{text(copy('Nguồn', 'Source'))}: {input.source}</span>}
                </div>
              )
            })}
          </fieldset>
          {model.params.length > 0 && (
            <fieldset>
              <legend>{text(copy('Tham số cố định', 'Fixed parameters'))}</legend>
              <ul className="rules-params">
                {model.params.map((param) => (
                  <li key={param.name} data-param={param.name}>
                    <code>{param.name}</code> = <strong>{formatDisplay(param.value)}{unitSuffix(param.unit)}</strong>
                    {param.source && <span className="calc-help">{param.source}</span>}
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <button type="button" className="secondary-button" onClick={() => setForm({ key: modelKey, values: defaultValues(model) })}>
            <RotateCcw size={14} aria-hidden="true" /> {text(copy('Về giá trị mặc định', 'Reset to defaults'))}
          </button>
        </form>

        <div className="rules-results">
          {compiled && !compiled.ok && (
            <section className="panel rules-alert" role="alert" data-section="compile-errors">
              <h2 className="calc-heading">{text(copy('Model có lỗi, chưa chạy được', 'The model has errors and cannot run'))}</h2>
              <ul>{compiled.errors.map((error, index) => <li key={index}>{error.message}</li>)}</ul>
            </section>
          )}
          {outcome && 'error' in outcome && (
            <section className="panel rules-alert" role="alert" data-section="eval-error">
              <h2 className="calc-heading">{text(copy('Lỗi khi tính', 'Evaluation failed'))}</h2>
              <p>{outcome.error}</p>
            </section>
          )}
          {parsed && Object.keys(parsed.errors).length > 0 && (
            <p className="rules-notice error" role="status">{text(copy('Sửa các ô đầu vào bị lỗi để xem kết quả.', 'Fix the highlighted inputs to see results.'))}</p>
          )}

          {run && (
            <>
              <div className="calc-results rules-outputs">
                {run.outputs.map((output, index) => (
                  <article key={output.name} className={`panel calc-card${index === 0 ? ' rules-primary' : ''}`} data-output={output.name}>
                    <h3>{outputLabel(output.name)}</h3>
                    <p className="calc-big">{formatDisplay(output.value)}{!isSilentUnit(output.unit) && <small> {output.unit}</small>}</p>
                    {index === 0 && run.binding && (
                      <p className="rules-binding" data-binding={run.binding}>
                        {text(copy('Ràng buộc quyết định', 'Binding constraint'))}: <strong>{run.binding}</strong>
                        {bindingStep && <> = {formatDisplay(bindingStep.value)}{unitSuffix(bindingStep.unit)}</>}
                        {calcByName.get(run.binding)?.description && <> ({calcByName.get(run.binding)?.description})</>}
                      </p>
                    )}
                  </article>
                ))}
              </div>

              {run.warnings.length > 0 && (
                <section className="panel rules-section" aria-label={text(copy('Cảnh báo', 'Warnings'))} data-section="warnings">
                  <h2 className="calc-heading">{text(copy('Cảnh báo', 'Warnings'))}</h2>
                  <ul className="rules-warnings">
                    {run.warnings.map((warning, index) => (
                      <li key={index} data-severity={warning.severity}>
                        <span className={`status-pill ${severityClass[warning.severity] ?? 'amber'}`}>{warning.severity.toUpperCase()}</span> {pick(warning.messageVi, warning.messageEn)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="panel rules-section" aria-labelledby="rules-trace-heading" data-section="trace">
                <h2 className="calc-heading" id="rules-trace-heading">{text(copy('Các bước tính', 'Calculation steps'))}</h2>
                <div className="rules-table-wrap">
                  <table className="designs-table rules-trace">
                    <thead>
                      <tr>
                        <th scope="col">{text(copy('Bước', 'Step'))}</th>
                        <th scope="col">{text(copy('Công thức', 'Formula'))}</th>
                        <th scope="col">{text(copy('Thay số', 'Substituted'))}</th>
                        <th scope="col">{text(copy('Giá trị', 'Value'))}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.steps.map((step) => (
                        <tr key={step.name} data-step={step.name} className={step.name === run.binding ? 'is-binding' : undefined}>
                          <th scope="row"><code>{step.name}</code>{calcByName.get(step.name)?.description && <small className="calc-help">{calcByName.get(step.name)?.description}</small>}</th>
                          <td><code>{step.formula}</code></td>
                          <td><code>{step.substituted}</code></td>
                          <td className="rules-value">{formatDisplay(step.value)}{unitSuffix(step.unit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <section className="panel rules-section" aria-labelledby="rules-tests-heading" data-section="tests">
            <div className="rules-section-head">
              <h2 className="calc-heading" id="rules-tests-heading">{text(copy('Kiểm thử của model', 'Model tests'))}</h2>
              <button type="button" className="secondary-button" onClick={() => setTests({ key: modelKey, results: runModelTests(model) })} data-action="run-tests">
                <FlaskConical size={14} aria-hidden="true" /> {text(copy('Chạy test', 'Run tests'))}
              </button>
            </div>
            {model.tests.length === 0 && <p className="calc-help">{text(copy('Model này chưa có test.', 'This model has no tests.'))}</p>}
            {testResults && (
              <>
                <p className={`rules-notice ${passedCount === testResults.length ? 'ok' : 'error'}`} role="status" data-tests-summary>
                  {text(copy(`${passedCount}/${testResults.length} test đạt`, `${passedCount}/${testResults.length} tests passed`))}
                </p>
                <ul className="rules-tests">
                  {testResults.map((result) => (
                    <li key={result.testId} data-test={result.testId} data-passed={result.passed}>
                      <span className={`status-pill ${result.passed ? 'teal' : 'coral'}`}>{result.passed ? 'PASS' : 'FAIL'}</span> <code>{result.testId}</code>
                      {result.error && <span className="calc-error"> {result.error}</span>}
                      {!result.error && result.failures.length > 0 && (
                        <span className="calc-error">
                          {' '}{result.failures.map((failure) => `${failure.output}: ${text(copy('kỳ vọng', 'expected'))} ${failure.expected}, ${text(copy('thực tế', 'got'))} ${failure.actual === null ? '—' : formatDisplay(failure.actual)}`).join('; ')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <SavedRuns text={text} language={language} run={run} />
        </div>
      </div>
    </div>
  )
}
