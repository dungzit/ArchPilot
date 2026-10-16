/**
 * HLD export model (pilot WP-C, docs/v3/06 §1).
 *
 * `buildHldModel` turns a design, its sizing runs and its reference pins into
 * an `HldModel`: a language-resolved, renderer-neutral document (sections of
 * headings, paragraphs, bullet lists, tables, links and a diagram slot).
 * `renderDocx` turns that model into a .docx. Keeping the two apart means the
 * content rules are tested without unzipping anything, and a future
 * company-template renderer (TP-02) can reuse the same model.
 */
import type { ArchGraphV2 } from '../graph/types'
import type { ReferencePin, SizingRun } from '../../contracts/pilot'

export type HldLanguage = 'vi' | 'en'

/** Every section of the built-in template, in document order (06 §1). */
export const SECTION_IDS = [
  'info', // 0 Thông tin tài liệu
  'intro', // 1 Giới thiệu
  'requirements', // 2 Yêu cầu và ràng buộc
  'architecture', // 3 Kiến trúc tổng thể
  'deployment', // 4 Kiến trúc triển khai
  'availability', // 5 Tính sẵn sàng và DR
  'sizing', // 6 Sizing
  'infrastructure', // 7 Hạ tầng và BOM
  'security', // 8 Bảo mật
  'operations', // 9 Vận hành
  'risks', // 10 Rủi ro
  'rollout', // 11 Kế hoạch triển khai
  'traceAppendix', // PL-A Sizing chi tiết
  'questionsAppendix', // PL-C Câu hỏi làm rõ
  'referencesAppendix', // PL-D Tham chiếu
] as const

export type SectionId = (typeof SECTION_IDS)[number]

/** Appendices are lettered (A, B, ...); everything else is numbered. */
export const APPENDIX_IDS: ReadonlySet<SectionId> = new Set<SectionId>(['traceAppendix', 'questionsAppendix', 'referencesAppendix'])

/** Section 0 carries the metadata the title page and change history depend on, so it cannot be switched off. */
export const ALWAYS_ON: ReadonlySet<SectionId> = new Set<SectionId>(['info'])

/** false = section left out. Missing = included. */
export type SectionToggles = Partial<Record<SectionId, boolean>>

/** Free-text fields the user writes (06 "S"/"M" sections; no AI in the pilot). */
export const MANUAL_FIELDS = [
  'intro', // 1
  'business', // 2.1
  'functional', // 2.2
  'nonFunctional', // 2.3
  'constraints', // 2.4
  'principles', // 3.1
  'deployment', // 4 (notes; the whole section when the graph has no containers)
  'availability', // 5
  'security', // 8
  'operations', // 9
  'risks', // 10 (manual additions)
  'rollout', // 11
  'questions', // PL-C (one question per line; "question | answer" optional)
] as const

export type ManualField = (typeof MANUAL_FIELDS)[number]
export type HldManual = Record<ManualField, string>

export interface HldMeta {
  customer: string
  projectName: string
  /** Document version, e.g. "1.0". */
  version: string
  author: string
  reviewer: string
  /** YYYY-MM-DD. */
  date: string
  /** Change-history description for this version. Default: "initial draft". */
  changeNote?: string
}

export interface HldDesignInput {
  id: string
  name: string
  /** The design as a 2.0 document; null when it could not be read (treated as empty). */
  graph: ArchGraphV2 | null
  revision?: number
  /** Link to the design in ArchPilot. Default `/designs/<id>`. */
  url?: string
}

export interface HldInput {
  design: HldDesignInput
  /** null = the sizing-run service is not available (shown as a notice, never an error). */
  runs: SizingRun[] | null
  /** null = the reference-pin service is not available. */
  pins: ReferencePin[] | null
  meta: HldMeta
  /** Missing or blank fields render a placeholder line. Use `buildSkeleton` for prefilled text. */
  manual: Partial<HldManual>
  language: HldLanguage
  sections?: SectionToggles
}

// ---------------------------------------------------------------- output model

export type HldBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string; tone?: 'normal' | 'note' | 'placeholder' | 'strong' }
  | { kind: 'bullets'; items: string[] }
  | {
      kind: 'table'
      columns: string[]
      rows: string[][]
      /** Relative column weights; the renderer scales them to the text width. */
      widths?: number[]
      /** Right-align these column indexes (numbers). */
      numeric?: number[]
    }
  | { kind: 'fields'; rows: { label: string; value: string }[] }
  | { kind: 'links'; items: HldLink[] }
  | { kind: 'diagram'; designId: string; url: string; caption: string; fallback: string }
  | { kind: 'pageBreak' }

export interface HldLink {
  title: string
  /** Only http(s) URLs; anything else is null and rendered as plain text. */
  url: string | null
  details: string[]
  /** Attribution line, e.g. "Nguồn: SysDesAi · Nội dung AI-generated, chỉ để tham khảo". */
  source: string
}

export type SectionSource = 'auto' | 'manual' | 'mixed'

export interface HldSection {
  id: SectionId
  /** "1".."n", "A".."C", or null for the unnumbered document-information section. */
  number: string | null
  title: string
  /** Title with its number, e.g. "6. Sizing" or "Phụ lục A. Sizing chi tiết". */
  heading: string
  source: SectionSource
  blocks: HldBlock[]
}

export interface HldStats {
  components: number
  connections: number
  containers: number
  decisions: number
  sizingRuns: number
  pins: number
  risks: number
  sizingWarnings: number
  designFindings: number
  manualRisks: number
  assumptions: number
  questions: number
}

/** Strings the renderer needs around the content (title page, TOC, header, footer). */
export interface HldChrome {
  documentTitle: string
  documentSubtitle: string
  tocTitle: string
  tocNote: string
  pageLabel: string
  ofLabel: string
  generatedBy: string
  titleFields: { label: string; value: string }[]
  headerText: string
}

export interface HldModel {
  language: HldLanguage
  locale: 'vi-VN' | 'en-US'
  meta: HldMeta
  design: { id: string; name: string; url: string }
  chrome: HldChrome
  sections: HldSection[]
  stats: HldStats
  /** Data-availability notices (runs/pins service missing, unreadable graph). */
  notices: string[]
  /** Sanitised download name: HLD_<project>_v<version>.docx */
  fileName: string
}
