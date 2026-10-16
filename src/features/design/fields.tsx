/**
 * Small form controls for the Inspector (task 2.5): labelled, with inline
 * validation text (never colour alone), and a local draft so an invalid
 * value can be typed and corrected without being written to the document.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { copy, type TextFn } from '../../ui/copy'

function Shell({ id, label, error, hint, children }: { id: string; label: string; error?: string | null; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className={`dw-field${error ? ' invalid' : ''}`}>
      <label className="dw-field-label" htmlFor={id}>{label}</label>
      {children}
      {error && <p className="dw-field-error" id={`${id}-error`} role="alert"><span aria-hidden="true">⚠ </span>{error}</p>}
      {!error && hint && <p className="dw-field-hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  )
}

export function TextField({
  label, value, onCommit, text, maxLength = 2000, required = false, placeholder, hint, multiline = false, inputRef, dataFirst,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  text: TextFn
  maxLength?: number
  required?: boolean
  placeholder?: string
  hint?: ReactNode
  multiline?: boolean
  inputRef?: (element: HTMLInputElement | HTMLTextAreaElement | null) => void
  dataFirst?: boolean
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  // The command layer trims labels: keep the user's trailing space while typing
  // ("Orders " on the way to "Orders API"), take the document's value otherwise
  // (undo, another node selected).
  useEffect(() => { setDraft((previous) => (previous.trim() === value.trim() ? previous : value)) }, [value])
  const error = required && draft.trim() === ''
    ? text(copy('Không được để trống.', 'Required.'))
    : draft.length > maxLength ? text(copy(`Tối đa ${maxLength} ký tự.`, `At most ${maxLength} characters.`)) : null
  const change = (next: string) => {
    setDraft(next)
    const invalid = (required && next.trim() === '') || next.length > maxLength
    if (!invalid) onCommit(next)
  }
  const common = {
    id,
    className: 'dw-input',
    value: draft,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
    'data-inspector-first': dataFirst ? 'true' : undefined,
  }
  return (
    <Shell id={id} label={label} error={error} hint={hint}>
      {multiline
        ? <textarea {...common} ref={inputRef} rows={3} onChange={(event) => change(event.target.value)} />
        : <input {...common} ref={inputRef} type="text" onChange={(event) => change(event.target.value)} />}
    </Shell>
  )
}

export function NumberField({
  label, value, onCommit, text, min, max, integer = true, unit, placeholder, hint,
}: {
  label: string
  value: number | undefined
  /** `null` = cleared (the key is removed and the default applies). */
  onCommit: (value: number | null) => void
  text: TextFn
  min?: number
  max?: number
  integer?: boolean
  unit?: string
  placeholder?: string
  hint?: ReactNode
}) {
  const id = useId()
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  useEffect(() => { setDraft(value === undefined ? '' : String(value)) }, [value])
  const problem = (raw: string): string | null => {
    if (raw.trim() === '') return null
    const number = Number(raw)
    if (!Number.isFinite(number)) return text(copy('Cần một số.', 'Enter a number.'))
    if (integer && !Number.isInteger(number)) return text(copy('Cần số nguyên.', 'Enter a whole number.'))
    if (min !== undefined && number < min) return text(copy(`Nhỏ nhất là ${min}.`, `The minimum is ${min}.`))
    if (max !== undefined && number > max) return text(copy(`Lớn nhất là ${max}.`, `The maximum is ${max}.`))
    return null
  }
  const error = problem(draft)
  return (
    <Shell id={id} label={unit ? `${label} (${unit})` : label} error={error} hint={hint}>
      <input
        id={id}
        className="dw-input"
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={draft}
        min={min}
        max={max}
        step={integer ? 1 : 'any'}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          const raw = event.target.value
          setDraft(raw)
          if (problem(raw)) return
          onCommit(raw.trim() === '' ? null : Number(raw))
        }}
      />
    </Shell>
  )
}

export function SelectField({
  label, value, options, onCommit, emptyLabel, hint, disabled,
}: {
  label: string
  value: string | undefined
  options: { value: string; label: string; disabled?: boolean }[]
  /** `null` = the empty option (default / inherited). */
  onCommit: (value: string | null) => void
  emptyLabel?: string
  hint?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <Shell id={id} label={label} hint={hint}>
      <select
        id={id}
        className="dw-input"
        value={value ?? ''}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
    </Shell>
  )
}

export function CheckboxField({ label, checked, onCommit, hint }: { label: string; checked: boolean; onCommit: (value: boolean) => void; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="dw-field dw-check">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onCommit(event.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id}>{label}</label>
      {hint && <p className="dw-field-hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  )
}

export function CheckboxGroup({ label, values, selected, onCommit }: { label: string; values: string[]; selected: string[]; onCommit: (value: string[]) => void }) {
  return (
    <fieldset className="dw-fieldset">
      <legend className="dw-field-label">{label}</legend>
      <div className="dw-check-grid">
        {values.map((value) => (
          <label key={value} className="dw-check-inline">
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={(event) => onCommit(event.target.checked ? values.filter((candidate) => candidate === value || selected.includes(candidate)) : selected.filter((candidate) => candidate !== value))}
            />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
