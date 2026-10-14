import { describe, expect, it } from 'vitest'
import { validateGraph } from '../graph/validate'
import { buildHldModel, enabledSections, mergeManual, sectionNumbers } from './build'
import { buildSkeleton } from './skeleton'
import { fileSafe, formatNumber, hldFileName, parseManualText, safeUrl } from './format'
import { SECTION_IDS, type HldBlock, type HldModel, type SectionId } from './types'
import { emptyInput, fullInput, hybridGraph, KAFKA_RUN, PIN } from './testFixtures'

const section = (model: HldModel, id: SectionId) => {
  const found = model.sections.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`section ${id} missing`)
  return found
}
const tables = (blocks: HldBlock[]) => blocks.filter((block): block is Extract<HldBlock, { kind: 'table' }> => block.kind === 'table')
const texts = (blocks: HldBlock[]) =>
  blocks.flatMap((block) => {
    if (block.kind === 'paragraph' || block.kind === 'heading') return [block.text]
    if (block.kind === 'bullets') return block.items
    if (block.kind === 'table') return [...block.columns, ...block.rows.flat()]
    if (block.kind === 'fields') return block.rows.flatMap((row) => [row.label, row.value])
    if (block.kind === 'links') return block.items.flatMap((item) => [item.title, item.url ?? '', ...item.details, item.source])
    if (block.kind === 'diagram') return [block.fallback]
    return []
  })

describe('buildHldModel: structure', () => {
  it('has every section of 06 §1 in template order with VI headings', () => {
    const model = buildHldModel(fullInput())
    expect(model.sections.map((s) => s.id)).toEqual([...SECTION_IDS])
    expect(model.sections.map((s) => s.heading)).toEqual([
      'Thông tin tài liệu',
      '1. Giới thiệu',
      '2. Yêu cầu và ràng buộc',
      '3. Kiến trúc tổng thể',
      '4. Kiến trúc triển khai',
      '5. Tính sẵn sàng và DR',
      '6. Sizing',
      '7. Hạ tầng và BOM cấu hình',
      '8. Bảo mật',
      '9. Vận hành',
      '10. Rủi ro',
      '11. Kế hoạch triển khai',
      'Phụ lục A. Sizing chi tiết',
      'Phụ lục B. Câu hỏi làm rõ',
      'Phụ lục C. Tham chiếu',
    ])
  })

  it('uses EN headings and subsection titles when the language is en', () => {
    const model = buildHldModel(fullInput({ language: 'en' }))
    expect(model.sections.map((s) => s.heading)).toEqual([
      'Document information',
      '1. Introduction',
      '2. Requirements and constraints',
      '3. Overall architecture',
      '4. Deployment architecture',
      '5. High availability and DR',
      '6. Sizing',
      '7. Infrastructure and BOM',
      '8. Security',
      '9. Operations',
      '10. Risks',
      '11. Rollout plan',
      'Appendix A. Detailed sizing',
      'Appendix B. Clarification questions',
      'Appendix C. References',
    ])
    const headings = section(model, 'requirements').blocks.filter((b) => b.kind === 'heading').map((b) => (b as { text: string }).text)
    expect(headings).toEqual(['2.1 Business overview', '2.2 Functional requirements summary', '2.3 Non-functional requirements', '2.4 Constraints', '2.5 Assumptions'])
    expect(model.chrome.documentTitle).toBe('HIGH-LEVEL DESIGN (HLD)')
    expect(model.locale).toBe('en-US')
  })

  it('honours section toggles and renumbers without gaps; section 0 cannot be switched off', () => {
    const model = buildHldModel(fullInput({ sections: { info: false, deployment: false, rollout: false, questionsAppendix: false } }))
    expect(model.sections.map((s) => s.id)).toEqual(['info', 'intro', 'requirements', 'architecture', 'availability', 'sizing', 'infrastructure', 'security', 'operations', 'risks', 'traceAppendix', 'referencesAppendix'])
    expect(section(model, 'availability').heading).toBe('4. Tính sẵn sàng và DR')
    expect(section(model, 'risks').heading).toBe('9. Rủi ro')
    expect(section(model, 'referencesAppendix').heading).toBe('Phụ lục B. Tham chiếu')
    // Subsections follow the new number.
    expect(texts(section(model, 'sizing').blocks)).toContain('5.1 Phương pháp và rule pack')
  })

  it('points the sizing section at the trace appendix letter, or says nothing when the appendix is off', () => {
    const on = buildHldModel(fullInput())
    expect(texts(section(on, 'sizing').blocks)[0]).toMatch(/Phụ lục A\.$/)
    const off = buildHldModel(fullInput({ sections: { traceAppendix: false } }))
    expect(texts(section(off, 'sizing').blocks)[0]).toBe('Kết quả lấy từ các lần chạy sizing đã lưu cho thiết kế này.')
  })

  it('enabledSections / sectionNumbers letter appendices separately', () => {
    const enabled = enabledSections({ intro: false })
    const numbers = sectionNumbers(enabled)
    expect(numbers.get('info')).toBeNull()
    expect(numbers.get('requirements')).toBe('1')
    expect(numbers.get('rollout')).toBe('10')
    expect(numbers.get('traceAppendix')).toBe('A')
    expect(numbers.get('referencesAppendix')).toBe('C')
  })
})

describe('buildHldModel: content and counts', () => {
  const graph = hybridGraph()
  const findings = validateGraph(graph)

  it('counts components, connections, containers, decisions, runs, pins and risks', () => {
    const model = buildHldModel(fullInput())
    expect(model.stats).toMatchObject({
      components: 19, // 20 nodes minus the note annotation
      connections: 8,
      containers: 7, // site, zone, 4 network segments, hypervisor cluster
      decisions: 2,
      sizingRuns: 2,
      pins: 1,
      sizingWarnings: 1,
      designFindings: findings.length,
      manualRisks: 2,
      risks: 1 + findings.length + 2,
      questions: 2,
    })
    const componentTable = tables(section(model, 'architecture').blocks)[0]
    expect(componentTable.rows).toHaveLength(19)
    expect(componentTable.rows.find((row) => row[1] === 'Orders API (orders_api)')).toEqual([
      expect.any(String),
      'Orders API (orders_api)',
      'Dịch vụ (API)',
      'App tier',
      expect.stringContaining('Số bản sao: 3'),
    ])
    const connectionTable = tables(section(model, 'architecture').blocks)[1]
    expect(connectionTable.rows).toHaveLength(8)
    expect(connectionTable.rows[0]).toEqual(['1', 'Người dùng', 'Web LB', 'truy cập · kết nối tới · HTTPS:443', 'HTTPS'])
  })

  it('lists decisions as 3.4 when the graph has them and omits 3.4 otherwise', () => {
    const withAdr = buildHldModel(fullInput())
    expect(texts(section(withAdr, 'architecture').blocks)).toContain('3.4 Các phương án đã cân nhắc và quyết định')
    expect(texts(section(withAdr, 'architecture').blocks)).toContain('ADR-001')
    const bare = { ...hybridGraph(), decisions: undefined }
    const without = buildHldModel(fullInput({ design: { id: 'd', name: 'd', graph: bare } }))
    expect(texts(section(without, 'architecture').blocks).some((text) => text.startsWith('3.4'))).toBe(false)
  })

  it('builds section 4 from containers and failure domains', () => {
    const model = buildHldModel(fullInput())
    const all = texts(section(model, 'deployment').blocks)
    expect(all).toContain('4.1 Phân vùng và miền lỗi')
    expect(all).toContain('DC1 Hà Nội › Prod network › App tier')
    expect(all).toContain('Hybrid')
    expect(all).toContain('All on DC1 (đang dùng)')
  })

  it('fills 2.5 assumptions from every run input and the design brief', () => {
    const model = buildHldModel(fullInput())
    const assumptions = tables(section(model, 'requirements').blocks)[0]
    expect(assumptions.columns).toEqual(['Lần chạy / thành phần', 'Đầu vào', 'Giá trị', 'Đơn vị', 'Nguồn'])
    expect(assumptions.rows).toEqual([
      ['Kafka cluster (Prod)', 'throughput', '1.234,5', 'MB/s', 'customer RFP'],
      ['Kafka cluster (Prod)', 'retention', '7', 'day', '—'],
      ['Redis memory', 'keys', '2.000.000', 'count', 'catalog'],
      ['Thiết kế', 'peakFactor', '3', '—', 'Default: not answered.'],
    ])
  })

  it('formats numbers per language (vi-VN / en-US)', () => {
    const vi = buildHldModel(fullInput())
    const en = buildHldModel(fullInput({ language: 'en' }))
    expect(texts(section(vi, 'sizing').blocks)).toContain('746.625,6')
    expect(texts(section(en, 'sizing').blocks)).toContain('746,625.6')
    expect(formatNumber(1234567.891, 'vi')).toBe('1.234.567,89')
    expect(formatNumber(1234567.891, 'en')).toBe('1,234,567.89')
    expect(formatNumber(0.000123, 'vi')).toBe('0,000123')
    expect(formatNumber(Number.NaN, 'en')).toBe('—')
  })

  it('section 6 shows per run the label, model, pack id/version, inputs, outputs with binding, and warnings', () => {
    const model = buildHldModel(fullInput({ language: 'en' }))
    const blocks = section(model, 'sizing').blocks
    const all = texts(blocks)
    expect(all).toContain('6.2.1 Kafka cluster (Prod)')
    expect(all).toContain('Kafka brokers (kafka-brokers)')
    expect(all).toContain('builtin-kafka v3')
    expect(all).toContain('Broker count (Binding constraint)')
    expect(all).toContain('[High] More than 50 brokers')
    expect(all).toContain('6.2.2 Redis memory')
  })

  it('section 7 summarises outputs, estimates size classes and promises the BOM later', () => {
    const model = buildHldModel(fullInput({ language: 'en' }))
    const blocks = section(model, 'infrastructure').blocks
    expect(tables(blocks)[0].rows).toContainEqual(['Kafka cluster (Prod)', 'Total storage', '746,625.6', 'GB'])
    // Orders API: S x3 = 6 vCPU / 12 GiB; Orders DB: M x2 = 8 vCPU / 32 GiB.
    expect(tables(blocks)[1].rows.at(-1)).toEqual(['Total', '', '', '', '', '14', '44'])
    expect(texts(blocks)).toContain('A detailed BOM will be added in a later version.')
  })

  it('section 10 merges sizing warnings, design findings and manual risks, most severe first', () => {
    const model = buildHldModel(fullInput({ language: 'en' }))
    const risk = tables(section(model, 'risks').blocks)[0]
    expect(risk.rows[0].slice(1, 4)).toEqual(['Sizing', 'High', 'More than 50 brokers'])
    expect(risk.rows.filter((row) => row[1] === 'Design check')).toHaveLength(findings.length)
    expect(risk.rows.slice(-2).map((row) => [row[1], row[3]])).toEqual([
      ['Manual', 'Thiếu dữ liệu tải thực tế'],
      ['Manual', 'Nhà cung cấp chậm giao hàng'],
    ])
  })

  it('appendix A traces every step of every run', () => {
    const model = buildHldModel(fullInput())
    const trace = tables(section(model, 'traceAppendix').blocks)
    expect(trace).toHaveLength(2)
    expect(trace[0].columns).toEqual(['Bước', 'Công thức', 'Thay số', 'Giá trị'])
    expect(trace[0].rows[0]).toEqual(['storage', 'throughput * retention', '1234.5 MB/s * 7 day', '746.625,6 GB'])
  })

  it('appendix C/D: questions split "question | answer"; pins become safe links with the SysDesAi attribution', () => {
    const model = buildHldModel(fullInput())
    expect(tables(section(model, 'questionsAppendix').blocks)[0].rows).toEqual([
      ['1', 'Tải đỉnh là bao nhiêu?', '1500 rps'],
      ['2', 'Có cần DR không?', ''],
    ])
    const links = section(model, 'referencesAppendix').blocks.find((block) => block.kind === 'links')
    expect(links).toEqual({
      kind: 'links',
      items: [{
        title: 'Design Kafka event pipeline',
        url: 'https://www.sysdesai.com/share/abc123',
        details: ['Bước 8: Storage sizing', 'Ghi chú: Compare broker count'],
        source: 'Nguồn: SysDesAi · Nội dung AI-generated, chỉ để tham khảo',
      }],
    })
    const hostile = buildHldModel(fullInput({ pins: [{ ...PIN, url: 'javascript:alert(1)' }] }))
    const hostileLinks = section(hostile, 'referencesAppendix').blocks.find((block) => block.kind === 'links') as Extract<HldBlock, { kind: 'links' }>
    expect(hostileLinks.items[0].url).toBeNull()
  })

  it('manual text becomes paragraphs and bullets; blank manual text becomes a visible placeholder', () => {
    const model = buildHldModel(fullInput({ manual: { intro: 'Mục đích\n- một\n- hai\n\nKết luận' } }))
    expect(section(model, 'intro').blocks).toEqual([
      { kind: 'paragraph', text: 'Mục đích' },
      { kind: 'bullets', items: ['một', 'hai'] },
      { kind: 'paragraph', text: 'Kết luận' },
    ])
    expect(section(model, 'security').blocks).toEqual([{ kind: 'paragraph', text: expect.stringContaining('Chưa có nội dung'), tone: 'placeholder' }])
  })

  it('names the file HLD_<project>_v<version>.docx with a safe name', () => {
    expect(buildHldModel(fullInput()).fileName).toBe('HLD_Orders_Platform_v1.2.docx')
    expect(hldFileName('Hệ thống Đặt hàng / NHNN', 'v2.0')).toBe('HLD_He_thong_Dat_hang_NHNN_v2.0.docx')
    expect(hldFileName('<>:"|?*', '')).toBe('HLD_project_v1.0.docx')
    expect(fileSafe('..\\..\\evil', 'x')).toBe('evil')
  })
})

describe('buildHldModel: missing data never throws', () => {
  it('an empty design with no runs and no pins still has every section', () => {
    const model = buildHldModel(emptyInput())
    expect(model.sections.map((s) => s.id)).toEqual([...SECTION_IDS])
    expect(model.stats).toMatchObject({ components: 0, connections: 0, sizingRuns: 0, pins: 0, risks: 0 })
    expect(texts(section(model, 'architecture').blocks)).toContain('The design has no components yet.')
    expect(texts(section(model, 'sizing').blocks)).toEqual(['No sizing run has been saved for this design yet.'])
    expect(texts(section(model, 'referencesAppendix').blocks)).toEqual(['No references have been pinned for this design yet.'])
    // No containers and no deployment model: section 4 is the manual text only.
    expect(section(model, 'deployment').blocks).toEqual([{ kind: 'paragraph', text: expect.stringContaining('No content yet'), tone: 'placeholder' }])
    expect(model.meta.projectName).toBe('Empty')
    expect(model.fileName).toBe('HLD_Empty_v1.0.docx')
    expect(model.notices).toEqual([])
  })

  it('unavailable runs/pins services (null) and an unreadable graph become notices', () => {
    const model = buildHldModel(emptyInput({ runs: null, pins: null, design: { id: 'x', name: 'X', graph: null } }))
    expect(model.notices).toEqual([
      'Sizing data is not available yet (service not ready). Add it once sizing results exist.',
      'The reference list is not available yet (service not ready).',
      'The design graph could not be read; the automatic sections are empty.',
    ])
    expect(texts(section(model, 'sizing').blocks)).toEqual(['Sizing data is not available yet (service not ready). Add it once sizing results exist.'])
    expect(texts(section(model, 'referencesAppendix').blocks)).toEqual(['The reference list is not available yet (service not ready).'])
  })

  it('tolerates runs with missing arrays and odd values', () => {
    const odd = { ...KAFKA_RUN, inputs: undefined, steps: undefined, outputs: undefined, warnings: undefined } as unknown as typeof KAFKA_RUN
    const model = buildHldModel(fullInput({ runs: [odd, { ...KAFKA_RUN, outputs: [{ name: 'x', value: Number.POSITIVE_INFINITY, unit: '' }] }] }))
    expect(model.stats.sizingRuns).toBe(2)
    expect(texts(section(model, 'sizing').blocks)).toContain('—')
  })
})

describe('skeletons and helpers', () => {
  it('derives the manual skeleton from the design brief, nodes and runs', () => {
    const skeleton = buildSkeleton({ design: { id: 'd', name: 'Orders platform', graph: hybridGraph() }, runs: [KAFKA_RUN], meta: { customer: 'ABC', projectName: 'Orders' }, language: 'vi' })
    expect(skeleton.intro).toContain('dự án Orders cho ABC')
    expect(skeleton.business).toContain('Take and fulfil customer orders.')
    expect(skeleton.nonFunctional).toContain('Tính sẵn sàng (SLA): 99,95%')
    expect(skeleton.nonFunctional).toContain('RPO: 15 phút')
    expect(skeleton.constraints).toContain('Vị trí lưu trữ dữ liệu: in_country')
    expect(skeleton.availability).toContain('Orders API: 3 bản sao, tách theo host.')
    expect(skeleton.security).toContain('An ninh mạng: Edge firewall')
    expect(skeleton.questions.split('\n')).toEqual(['Xác nhận giả định peakFactor = 3?', 'Xác nhận retention = 7 day cho Kafka cluster (Prod)?'])
    expect(skeleton.risks).toBe('')
  })

  it('skeleton for an empty design in EN has prompts, not crashes', () => {
    const skeleton = buildSkeleton({ design: { id: 'd', name: 'Empty', graph: null }, runs: null, meta: { customer: '', projectName: '' }, language: 'en' })
    expect(skeleton.intro).toContain('project Empty,')
    expect(skeleton.functional).toBe('- Function 1: …\n- Function 2: …')
    expect(skeleton.questions).toBe('')
  })

  it('mergeManual keeps edited fields, including deliberately emptied ones', () => {
    const skeleton = buildSkeleton({ design: { id: 'd', name: 'Empty', graph: null }, runs: null, meta: { customer: '', projectName: '' }, language: 'en' })
    const merged = mergeManual(skeleton, { intro: 'Mine', rollout: '' })
    expect(merged.intro).toBe('Mine')
    expect(merged.rollout).toBe('')
    expect(merged.security).toBe(skeleton.security)
  })

  it('parseManualText, safeUrl', () => {
    expect(parseManualText('a\r\n* b\n• c\n\nd')).toEqual([{ kind: 'paragraph', text: 'a' }, { kind: 'bullets', items: ['b', 'c'] }, { kind: 'paragraph', text: 'd' }])
    expect(safeUrl('https://www.sysdesai.com/share/x')).toBe('https://www.sysdesai.com/share/x')
    expect(safeUrl('http://host:8080/designs/1')).toBe('http://host:8080/designs/1')
    expect(safeUrl('/designs/1')).toBeNull()
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('file:///c:/x')).toBeNull()
  })
})
