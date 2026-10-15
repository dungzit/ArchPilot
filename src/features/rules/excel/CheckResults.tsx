import type { PackCheck } from '../../../domain/rules/excel/engineGuard'
import { copy, type TextFn } from '../../../ui/copy'

/** Compile + test results of a pack, shared by the Excel panel and the rule editor. */
export function CheckResults({ text, check }: { text: TextFn; check: PackCheck }) {
  if (!check.available) {
    return (
      <div className="rx-callout rx-warn" role="status" data-check="unavailable">
        <strong>{text(copy('Engine tính rule chưa sẵn sàng', 'Rule engine not available'))}</strong>
        <span>{text(copy('Chưa kiểm tra được; vẫn lưu được ở trạng thái nháp (draft).', 'Cannot check yet; you can still save as a draft.'))}</span>
        <code>{check.message}</code>
      </div>
    )
  }
  return (
    <div className="rx-checks" data-check={check.publishable ? 'pass' : 'fail'}>
      <p className={check.publishable ? 'rx-callout rx-ok' : 'rx-callout rx-warn'}>
        {check.publishable
          ? text(copy('Mọi model compile được và mọi test đều pass: có thể lưu ở trạng thái published.', 'Every model compiles and every test passes: can be saved as published.'))
          : text(copy('Còn lỗi compile, test fail hoặc model chưa có test: sẽ lưu ở trạng thái draft.', 'Compile errors, failing tests or models without tests: will be saved as draft.'))}
      </p>
      {check.models.map((m) => (
        <div key={m.modelId} className="rx-check-model">
          <strong>{m.modelId}</strong>
          {!m.compile.ok && (
            <ul className="rx-issues">
              {m.compile.errors.map((e, i) => (
                <li key={i} className="rx-issue error">
                  <code>{e.where}</code> {e.message}
                </li>
              ))}
            </ul>
          )}
          {m.compile.ok && m.tests.length === 0 && <span className="status-pill amber">{text(copy('chưa có test', 'no tests'))}</span>}
          {m.tests.map((t) => (
            <div key={t.testId} className="rx-test-line">
              <span className={t.passed ? 'status-pill teal' : 'status-pill coral'}>{t.passed ? 'PASS' : 'FAIL'}</span> <code>{t.testId}</code>
              {t.error && <span className="rx-test-error"> {t.error}</span>}
              {t.failures.map((f) => (
                <span key={f.output} className="rx-test-error">
                  {' '}
                  {f.output}: {text(copy('kỳ vọng', 'expected'))} {f.expected}, {text(copy('thực tế', 'actual'))} {f.actual ?? '—'}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
