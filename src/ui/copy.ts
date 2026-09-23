/**
 * Bilingual copy helper, extracted verbatim from `main.tsx` (task 1.1).
 *
 * Every screen receives a `text` function rather than reading the language
 * itself, so the shell stays the single owner of the VI/EN toggle.
 */
export type Copy = {
  vi: string
  en: string
}

export const copy = (vi: string, en: string): Copy => ({ vi, en })

/** The prop every screen takes: `text: (value: Copy) => string`. */
export type TextFn = (value: Copy) => string
