/**
 * Form state for a model's inputs (pilot WP-A). Pure, so the validation rules
 * are unit-tested without a DOM. The form keeps raw strings (what the user
 * typed); only a fully valid set reaches the engine.
 */
import type { SizingModelDef } from '../../contracts/pilot'
import { copy, type Copy } from '../../ui/copy'

export type RawValues = Record<string, string>

export interface ParsedInputs {
  values: Record<string, number>
  errors: Record<string, Copy>
}

export function defaultValues(model: SizingModelDef): RawValues {
  return Object.fromEntries(model.inputs.map((input) => [input.name, String(input.default)]))
}

export function parseInputs(model: SizingModelDef, raw: RawValues): ParsedInputs {
  const values: Record<string, number> = {}
  const errors: Record<string, Copy> = {}
  for (const input of model.inputs) {
    const text = (raw[input.name] ?? String(input.default)).trim()
    if (text === '') {
      errors[input.name] = copy('Bắt buộc nhập.', 'Required.')
      continue
    }
    const value = Number(text)
    if (!Number.isFinite(value)) {
      errors[input.name] = copy('Không phải là số.', 'Not a number.')
      continue
    }
    const hasMin = typeof input.min === 'number'
    const hasMax = typeof input.max === 'number'
    if ((hasMin && value < (input.min as number)) || (hasMax && value > (input.max as number))) {
      errors[input.name] = hasMin && hasMax
        ? copy(`Ngoài khoảng cho phép ${input.min} – ${input.max}.`, `Outside the allowed range ${input.min} – ${input.max}.`)
        : hasMin
          ? copy(`Tối thiểu ${input.min}.`, `Minimum ${input.min}.`)
          : copy(`Tối đa ${input.max}.`, `Maximum ${input.max}.`)
      continue
    }
    values[input.name] = value
  }
  return { values, errors }
}
