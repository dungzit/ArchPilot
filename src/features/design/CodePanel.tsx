/**
 * Code (task 2.1; REQ-DES-017): the design document as JSON, read-only, with
 * Copy. The Terraform view arrives with the IaC generator (design-v2 phase
 * 1/3, `src/domain/iac/`); until then its tab says so instead of showing
 * partial code.
 */
import { useMemo, useState } from 'react'
import type { ArchGraphV2 } from '../../domain/graph'
import { copy, type TextFn } from '../../ui/copy'

export function CodePanel({ document, text }: { document: ArchGraphV2; text: TextFn }) {
  const [format, setFormat] = useState<'json' | 'terraform'>('json')
  const [copied, setCopied] = useState<string | null>(null)
  const json = useMemo(() => JSON.stringify(document, null, 2), [document])

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(text(copy('Đã chép JSON.', 'JSON copied.')))
    } catch {
      setCopied(text(copy('Không chép được: hãy chọn văn bản và chép thủ công.', 'Copy failed: select the text and copy it manually.')))
    }
  }

  return (
    <div className="dw-code">
      <div className="dw-code-bar">
        <div role="tablist" aria-label={text(copy('Định dạng mã', 'Code format'))} className="dw-seg">
          <button type="button" role="tab" aria-selected={format === 'json'} onClick={() => setFormat('json')}>JSON</button>
          <button type="button" role="tab" aria-selected={format === 'terraform'} onClick={() => setFormat('terraform')}>Terraform</button>
        </div>
        {format === 'json' && <button type="button" className="dw-button small" onClick={copyJson}>{text(copy('Chép', 'Copy'))}</button>}
        <span className="dw-hint" role="status">{copied ?? text(copy('Chỉ đọc; tạo lại sau mỗi thay đổi.', 'Read-only; regenerated on every change.'))}</span>
      </div>
      {format === 'json' ? (
        <pre className="dw-code-view" tabIndex={0} aria-label={text(copy('Tài liệu thiết kế dạng JSON', 'Design document as JSON'))}>{json}</pre>
      ) : (
        <div className="dw-empty" role="note">
          <strong>{text(copy('Terraform sắp có', 'Terraform is coming'))}</strong>
          <p>{text(copy('Mã Terraform sẽ hiển thị tại đây khi bộ sinh IaC hoàn tất và bạn chọn một đích triển khai. Canvas không bao giờ áp dụng hay triển khai gì.', 'Terraform appears here once the IaC generator lands and a deployment target is chosen. The canvas never applies or deploys anything.'))}</p>
        </div>
      )}
    </div>
  )
}
