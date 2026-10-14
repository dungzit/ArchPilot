/**
 * renderDocx (pilot WP-C, docs/v3/06 TP-01/TP-04): HldModel -> Word document
 * with the `docx` library.
 *
 * A4 portrait, 2 cm margins, Calibri 11 pt, Heading 1-3 styles, a TOC field
 * (pre-filled from the headings; Word refreshes it on open because
 * `updateFields` is set), bordered tables with a repeated header row,
 * ExternalHyperlink for references, a header with the project name and a
 * footer with "Page X / Y". The cover page has no header or footer.
 *
 * Works in the browser (`renderDocxBlob`) and in Node (`renderDocxBytes`, used
 * by the tests). No DOM access here: the diagram PNG, when there is one, is
 * produced by the caller and passed in.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx'
import { cleanText, safeUrl } from './format'
import type { HldBlock, HldLink, HldModel } from './types'

export interface DiagramImage {
  png: Uint8Array
  /** Pixel size of the PNG (its aspect ratio is kept). */
  width: number
  height: number
}

export interface RenderOptions {
  /** The logical diagram for section 3.2. Without it the section links to the design instead. */
  diagram?: DiagramImage | null
}

// A4 portrait in twips (1/1440 inch), 2 cm margins.
const PAGE = { width: 11906, height: 16838 }
const MARGIN = 1134
export const TEXT_WIDTH = PAGE.width - 2 * MARGIN // 9638 twips = 6.69 in
/** Largest image that fits the text width, in pixels at 96 dpi. */
const MAX_IMAGE = { width: 620, height: 860 }

const FONT = 'Calibri'
const COLOR = { ink: '17324D', teal: '0F8B7A', muted: '5F6F80', amber: 'B45309', border: 'A9B8C6', headerFill: 'DCE6F0', labelFill: 'F1F5F9' }
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: COLOR.border }
const TABLE_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER }
const CELL_MARGINS = { top: 40, bottom: 40, left: 90, right: 90 }

function run(text: string, options: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}): TextRun {
  return new TextRun({ text: cleanText(text), ...options })
}

/** Text with embedded newlines as one paragraph per line (a run cannot hold a line break as "\n"). */
function lines(text: string, options: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph[] {
  const parts = cleanText(text).split(/\r?\n/)
  return parts.map(
    (part) =>
      new Paragraph({
        alignment: options.align,
        spacing: { before: 0, after: 0 },
        children: [run(part, { bold: options.bold, size: options.size })],
      }),
  )
}

function columnWidths(count: number, weights?: number[]): number[] {
  const raw = weights && weights.length === count ? weights.map((weight) => (weight > 0 ? weight : 1)) : Array.from({ length: count }, () => 1)
  const sum = raw.reduce((total, weight) => total + weight, 0)
  const widths = raw.map((weight) => Math.floor((weight / sum) * TEXT_WIDTH))
  widths[widths.length - 1] += TEXT_WIDTH - widths.reduce((total, width) => total + width, 0)
  return widths
}

function cell(text: string, width: number, options: { header?: boolean; label?: boolean; numeric?: boolean; span?: number } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: options.span,
    margins: CELL_MARGINS,
    shading: options.header ? { type: ShadingType.CLEAR, color: 'auto', fill: COLOR.headerFill } : options.label ? { type: ShadingType.CLEAR, color: 'auto', fill: COLOR.labelFill } : undefined,
    children: lines(text, { bold: options.header || options.label, size: 19, align: options.numeric ? AlignmentType.RIGHT : undefined }),
  })
}

function renderTable(block: Extract<HldBlock, { kind: 'table' }>): Table {
  const widths = columnWidths(block.columns.length, block.widths)
  const numeric = new Set(block.numeric ?? [])
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: block.columns.map((column, index) => cell(column, widths[index], { header: true })),
  })
  const body = block.rows.length > 0
    ? block.rows.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: block.columns.map((_, index) => cell(row[index] ?? '', widths[index], { numeric: numeric.has(index) })),
          }),
      )
    : [new TableRow({ children: [cell('—', TEXT_WIDTH, { span: block.columns.length })] })]
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    rows: [header, ...body],
  })
}

function renderFields(rows: { label: string; value: string }[]): Table {
  const widths = columnWidths(2, [1, 2.6])
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    rows: rows.map((row) => new TableRow({ cantSplit: true, children: [cell(row.label, widths[0], { label: true }), cell(row.value, widths[1])] })),
  })
}

function link(url: string, text: string, size?: number): ParagraphChild {
  return new ExternalHyperlink({ link: url, children: [new TextRun({ text: cleanText(text), style: 'Hyperlink', size })] })
}

function renderLinks(items: HldLink[]): Paragraph[] {
  const out: Paragraph[] = []
  items.forEach((item, index) => {
    const url = safeUrl(item.url)
    out.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 160, after: 40 },
        children: [run(`${index + 1}. `, { bold: true }), url ? link(url, item.title) : run(item.title, { bold: true })],
      }),
    )
    if (url) out.push(new Paragraph({ keepNext: true, spacing: { after: 40 }, indent: { left: 360 }, children: [link(url, url, 19)] }))
    for (const detail of item.details) out.push(new Paragraph({ keepNext: true, spacing: { after: 40 }, indent: { left: 360 }, children: [run(detail, { size: 20 })] }))
    out.push(new Paragraph({ spacing: { after: 80 }, indent: { left: 360 }, children: [run(item.source, { italics: true, color: COLOR.muted, size: 18 })] }))
  })
  return out
}

function fitImage(image: DiagramImage): { width: number; height: number } {
  const width = Math.max(1, image.width)
  const height = Math.max(1, image.height)
  const scale = Math.min(1, MAX_IMAGE.width / width, MAX_IMAGE.height / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function renderDiagram(block: Extract<HldBlock, { kind: 'diagram' }>, options: RenderOptions): Paragraph[] {
  const out: Paragraph[] = []
  const url = safeUrl(block.url)
  if (options.diagram && options.diagram.png.byteLength > 0) {
    const size = fitImage(options.diagram)
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        children: [
          new ImageRun({
            type: 'png',
            data: options.diagram.png,
            transformation: size,
            altText: { name: 'diagram', title: block.caption, description: block.caption },
          }),
        ],
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run(block.caption, { italics: true, color: COLOR.muted, size: 19 })] }),
    )
  }
  // The link to the live design always follows: the image is a snapshot, the design is the source of truth.
  const prefix = block.fallback.endsWith(block.url) ? block.fallback.slice(0, block.fallback.length - block.url.length) : `${block.fallback} `
  out.push(new Paragraph({ children: [run(prefix), url ? link(url, block.url) : run(block.url, { bold: true }), run('.')] }))
  return out
}

function renderBlocks(blocks: HldBlock[], options: RenderOptions): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        out.push(new Paragraph({ heading: block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: [run(block.text)] }))
        break
      case 'paragraph': {
        const tone = block.tone ?? 'normal'
        out.push(
          new Paragraph({
            keepNext: tone === 'strong',
            children: [
              run(block.text, {
                bold: tone === 'strong',
                italics: tone === 'note' || tone === 'placeholder',
                color: tone === 'note' ? COLOR.muted : tone === 'placeholder' ? COLOR.amber : undefined,
              }),
            ],
          }),
        )
        break
      }
      case 'bullets':
        for (const item of block.items) out.push(new Paragraph({ bullet: { level: 0 }, children: [run(item)] }))
        break
      case 'table':
        out.push(renderTable(block), new Paragraph({ spacing: { after: 80 }, children: [] }))
        break
      case 'fields':
        out.push(renderFields(block.rows), new Paragraph({ spacing: { after: 80 }, children: [] }))
        break
      case 'links':
        out.push(...renderLinks(block.items))
        break
      case 'diagram':
        out.push(...renderDiagram(block, options))
        break
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }))
        break
    }
  }
  return out
}

function titlePage(model: HldModel): (Paragraph | Table)[] {
  const { chrome, meta } = model
  return [
    new Paragraph({ spacing: { before: 2400, after: 240 }, children: [run(meta.customer.toUpperCase() || ' ', { color: COLOR.muted, size: 28, bold: true })] }),
    new Paragraph({ spacing: { after: 240 }, children: [run(chrome.documentTitle, { bold: true, size: 44, color: COLOR.ink })] }),
    new Paragraph({ spacing: { after: 720 }, children: [run(chrome.documentSubtitle, { bold: true, size: 34, color: COLOR.teal })] }),
    renderFields(chrome.titleFields),
    new Paragraph({ spacing: { before: 1200 }, children: [run(chrome.generatedBy, { italics: true, color: COLOR.muted, size: 18 })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

function tableOfContents(model: HldModel): (Paragraph | TableOfContents)[] {
  return [
    new Paragraph({ spacing: { before: 240, after: 200 }, children: [run(model.chrome.tocTitle, { bold: true, size: 32, color: COLOR.ink })] }),
    new TableOfContents(model.chrome.tocTitle, { hyperlink: true, headingStyleRange: '1-3' }),
    new Paragraph({ spacing: { before: 200 }, children: [run(model.chrome.tocNote, { italics: true, color: COLOR.muted, size: 18 })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

export function renderDocx(model: HldModel, options: RenderOptions = {}): Document {
  const children: (Paragraph | Table | TableOfContents)[] = [...titlePage(model)]
  let appendixStarted = false
  for (const section of model.sections) {
    const isAppendix = section.number !== null && /^[A-Z]$/.test(section.number)
    if (isAppendix && !appendixStarted) {
      appendixStarted = true
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(section.heading)] }))
    children.push(...renderBlocks(section.blocks, options))
    // Section 0 sits before the table of contents, on its own page.
    if (section.id === 'info') children.push(new Paragraph({ children: [new PageBreak()] }), ...tableOfContents(model))
  }
  if (!model.sections.some((section) => section.id === 'info')) children.splice(titlePage(model).length, 0, ...tableOfContents(model))

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border, space: 4 } },
        children: [run(model.chrome.headerText, { color: COLOR.muted, size: 18 })],
      }),
    ],
  })
  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }],
        children: [
          run(model.meta.customer || model.meta.projectName, { color: COLOR.muted, size: 18 }),
          new TextRun({ color: COLOR.muted, size: 18, children: ['\t', `${model.chrome.pageLabel} `, PageNumber.CURRENT, ` ${model.chrome.ofLabel} `, PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  })
  const empty = () => new Paragraph({ children: [] })

  // Document properties go to docProps/core.xml unescaped by run(): clean them here too,
  // so a model built by another caller cannot produce invalid XML.
  return new Document({
    creator: cleanText(model.meta.author) || 'ArchPilot',
    lastModifiedBy: 'ArchPilot',
    title: cleanText(`HLD ${model.meta.projectName} v${model.meta.version}`),
    subject: cleanText(model.chrome.documentTitle),
    description: cleanText(model.chrome.generatedBy),
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, language: { value: model.locale } },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        heading1: {
          run: { font: FONT, size: 32, bold: true, color: COLOR.ink },
          paragraph: { spacing: { before: 360, after: 160 }, keepNext: true, keepLines: true },
        },
        heading2: {
          run: { font: FONT, size: 26, bold: true, color: COLOR.ink },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, keepLines: true },
        },
        heading3: {
          run: { font: FONT, size: 23, bold: true, color: COLOR.teal },
          paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, keepLines: true },
        },
        hyperlink: { run: { color: '1F5FAD', underline: {} } },
      },
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            size: { width: PAGE.width, height: PAGE.height, orientation: PageOrientation.PORTRAIT },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 567, footer: 567 },
          },
        },
        headers: { default: header, first: new Header({ children: [empty()] }) },
        footers: { default: footer, first: new Footer({ children: [empty()] }) },
        children,
      },
    ],
  })
}

/** The .docx as bytes (Node and browser). */
export async function renderDocxBytes(model: HldModel, options: RenderOptions = {}): Promise<Uint8Array> {
  return new Uint8Array(await Packer.toArrayBuffer(renderDocx(model, options)))
}

/** The .docx as a Blob for a browser download. */
export function renderDocxBlob(model: HldModel, options: RenderOptions = {}): Promise<Blob> {
  return Packer.toBlob(renderDocx(model, options))
}
