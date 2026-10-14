// @vitest-environment jsdom
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildHldModel } from './build'
import { buildDiagramSvg } from './diagram'
import { renderDocxBytes } from './render'
import { emptyInput, fullInput, hybridGraph, KAFKA_RUN, PIN } from './testFixtures'

// jsdom only for its strict XML parser (well-formedness checks).
const parser = new DOMParser()

async function unpack(bytes: Promise<Uint8Array>): Promise<Record<string, string>> {
  const files = unzipSync(await bytes)
  const out: Record<string, string> = {}
  for (const [name, data] of Object.entries(files)) out[name] = name.endsWith('.png') ? `<${data.byteLength} bytes>` : strFromU8(data)
  return out
}

function expectWellFormed(xml: string) {
  const parsed = parser.parseFromString(xml, 'application/xml')
  expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)
}

/** A valid 1x1 PNG. */
const PNG_1X1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

describe('renderDocx', () => {
  it('writes a DOCX whose document.xml holds the project name, a sizing output value and the reference URL', async () => {
    const files = await unpack(renderDocxBytes(buildHldModel(fullInput())))
    const document = files['word/document.xml']
    expect(document).toBeDefined()
    expectWellFormed(document)
    expect(document).toContain('Orders Platform')
    expect(document).toContain('746.625,6') // vi-VN formatted sizing output
    expect(document).toContain('https://www.sysdesai.com/share/abc123')
    expect(document).toContain('Nguồn: SysDesAi · Nội dung AI-generated, chỉ để tham khảo')
    // The hyperlink target is an external relationship.
    expect(files['word/_rels/document.xml.rels']).toMatch(/Target="https:\/\/www\.sysdesai\.com\/share\/abc123" TargetMode="External"/)
    // Every main heading is a Heading 1 paragraph.
    expect(document).toContain('<w:pStyle w:val="Heading1"/>')
    expect(document).toContain('6. Sizing')
    expect(document).toContain('Phụ lục C. Tham chiếu')
  })

  it('has a TOC field Word refreshes on open, A4 portrait, header with project name and footer page numbers', async () => {
    const files = await unpack(renderDocxBytes(buildHldModel(fullInput())))
    const document = files['word/document.xml']
    expect(document).toContain('TOC \\h \\o &quot;1-3&quot;')
    // Pre-filled from the headings, so the TOC is not empty before Word refreshes it.
    expect(document).toMatch(/PAGEREF _Toc\d+/)
    expect(document).toContain('<w:pgSz w:w="11906" w:h="16838"')
    expect(document).toContain('<w:titlePg/>')
    expect(files['word/settings.xml']).toMatch(/<w:updateFields( w:val="(true|1)")?\/>/)
    const headers = Object.keys(files).filter((name) => /^word\/header\d+\.xml$/.test(name)).map((name) => files[name]).join('\n')
    const footers = Object.keys(files).filter((name) => /^word\/footer\d+\.xml$/.test(name)).map((name) => files[name]).join('\n')
    expect(headers).toContain('Orders Platform — HLD v1.2')
    expect(footers).toContain('PAGE')
    expect(footers).toContain('NUMPAGES')
    expect(files['word/styles.xml']).toContain('Calibri')
    expect(files['docProps/core.xml']).toContain('HLD Orders Platform v1.2')
  })

  it('renders an empty design with no runs and no pins as a valid document', async () => {
    const files = await unpack(renderDocxBytes(buildHldModel(emptyInput())))
    const document = files['word/document.xml']
    expectWellFormed(document)
    expect(document).toContain('HIGH-LEVEL DESIGN (HLD)')
    expect(document).toContain('No sizing run has been saved for this design yet.')
    expect(document).toContain('No references have been pinned for this design yet.')
    expect(document).toContain('/designs/dsg_empty')
    expect(files['[Content_Types].xml']).toContain('wordprocessingml.document.main+xml')
  })

  it('renders when the runs and pins services are unavailable', async () => {
    const files = await unpack(renderDocxBytes(buildHldModel(emptyInput({ runs: null, pins: null, design: { id: 'x', name: 'X', graph: null } }))))
    expectWellFormed(files['word/document.xml'])
    expect(files['word/document.xml']).toContain('Sizing data is not available yet')
  })

  it('strips U+0000 and U+0008 from the project name, manual sections and run/pin data: every XML part parses', async () => {
    const C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
    const model = buildHldModel(fullInput({
      meta: { customer: 'Bank\u0000 ABC', projectName: 'Orders\u0008 Platform\u0000', version: '1.\u00082', author: 'An\u0000', reviewer: 'Bi\u0008', date: '2026-10-15', changeNote: 'Init\u0008' },
      manual: { intro: 'Mục đích\u0008 rõ\u0000 ràng', security: '- TLS\u0000 1.3\n- WAF\u0008', questions: 'Q\u0008? | A\u0000' },
      runs: [{ ...KAFKA_RUN, componentLabel: 'Kafka\u0000', steps: [{ ...KAFKA_RUN.steps[0], formula: 'a\u0008 * b' }] }],
      pins: [{ ...PIN, title: 'Pin\u0008 title', url: 'https://www.sysdesai.com/share/x\u0008y' }],
    }))
    expect(model.meta.projectName).toBe('Orders Platform')
    const files = await unpack(renderDocxBytes(model))
    const xmlParts = Object.keys(files).filter((name) => /\.(xml|rels)$/.test(name))
    expect(xmlParts.length).toBeGreaterThan(8)
    for (const name of xmlParts) {
      expect(C0.test(files[name]), `${name} holds a C0 control character`).toBe(false)
      expectWellFormed(files[name])
    }
    expect(files['word/document.xml']).toContain('Orders Platform')
    expect(files['word/document.xml']).toContain('Mục đích rõ ràng')
    expect(files['word/document.xml']).toContain('TLS 1.3')
    // A URL with a control character is not a link at all.
    expect(files['word/_rels/document.xml.rels']).not.toContain('share/x')
  })

  it('cleans a model that bypassed the builder (renderer-side defence)', async () => {
    const model = buildHldModel(fullInput())
    model.meta = { ...model.meta, projectName: 'Raw\u0008Name', author: 'X\u0000' }
    model.chrome = { ...model.chrome, headerText: 'Head\u0000er' }
    model.sections[1] = { ...model.sections[1], heading: 'Intro\u0008', blocks: [{ kind: 'paragraph', text: 'p\u0000' }, { kind: 'table', columns: ['c\u0008'], rows: [['v\u0000']] }] }
    const files = await unpack(renderDocxBytes(model))
    for (const name of Object.keys(files).filter((part) => /\.(xml|rels)$/.test(part))) expectWellFormed(files[name])
  })

  it('exports a design with ~100 components and 10 sizing runs well within 10 seconds', async () => {
    const base = hybridGraph()
    const nodes = Array.from({ length: 100 }, (_, index) => ({
      id: `s${index}`,
      type: 'service',
      label: `Service ${index}`,
      codeName: `service_${index}`,
      position: { x: (index % 10) * 220, y: Math.floor(index / 10) * 120 },
      attributes: { replicas: 2, sizeClass: 'M' as const, failureDomainLevel: 'host' as const },
      config: { runtime: 'java21', port: 8080 },
    }))
    const edges = nodes.slice(1).map((node, index) => ({ id: `x${index}`, source: nodes[index].id, target: node.id, label: 'calls', direction: 'forward' as const, kind: 'access' as const, mode: 'connect' as const, protocol: 'https' as const, port: 443 }))
    const graph = { ...base, nodes: [...base.nodes, ...nodes], edges: [...base.edges, ...edges] }
    const runs = Array.from({ length: 10 }, (_, index) => ({
      ...KAFKA_RUN,
      id: `run_${index}`,
      componentLabel: `Cluster ${index}`,
      inputs: Array.from({ length: 10 }, (__, i) => ({ name: `in${i}`, value: i * 1000.5, unit: 'MB/s' })),
      steps: Array.from({ length: 15 }, (__, i) => ({ name: `s${i}`, formula: 'a * b', substituted: '1 * 2', value: i * 3.5, unit: 'GB' })),
      outputs: Array.from({ length: 5 }, (__, i) => ({ name: `o${i}`, value: i * 12345.678, unit: 'GB' })),
    }))
    const started = performance.now()
    const model = buildHldModel(fullInput({ design: { id: 'big', name: 'Big', graph }, runs }))
    const diagram = buildDiagramSvg(graph, 'vi')
    const bytes = await renderDocxBytes(model)
    const elapsed = performance.now() - started
    expect(model.stats.components).toBe(119)
    expect(diagram?.nodes).toBe(120)
    expect(bytes.byteLength).toBeGreaterThan(10_000)
    expect(elapsed).toBeLessThan(10_000)
  })

  it('the well-formedness check is not vacuous', () => {
    expect(parser.parseFromString('<a><b></a>', 'application/xml').getElementsByTagName('parsererror').length).toBeGreaterThan(0)
    expect(parser.parseFromString('<a>\u0001</a>', 'application/xml').getElementsByTagName('parsererror').length).toBeGreaterThan(0)
  })

  it('keeps XML valid with hostile text (markup, ampersands, control characters, lone surrogates)', async () => {
    const graph = hybridGraph()
    graph.nodes[0].label = '<script>alert("x")</script> & \u0001\u0008 \uD800 DC1'
    const model = buildHldModel(fullInput({
      design: { id: 'd', name: 'A & B <c>', graph },
      meta: { customer: 'X\u0007Y', projectName: 'P & <Q>', version: '1', author: '', reviewer: '', date: '' },
      manual: { intro: 'line \u000b with vertical tab\n- <b>not bold</b>' },
    }))
    const files = await unpack(renderDocxBytes(model))
    expectWellFormed(files['word/document.xml'])
    expect(files['word/document.xml']).toContain('&lt;script&gt;')
    expect(files['word/document.xml']).not.toContain('\u0001')
    expect(model.fileName).toBe('HLD_P_Q_v1.docx')
  })

  it('embeds the diagram PNG in 3.2 when one is given, and always links the design', async () => {
    const model = buildHldModel(fullInput({ design: { id: 'dsg_1', name: 'Orders', graph: hybridGraph(), url: 'http://archpilot.local:8080/designs/dsg_1' } }))
    const files = await unpack(renderDocxBytes(model, { diagram: { png: PNG_1X1, width: 1400, height: 900 } }))
    expect(Object.keys(files).some((name) => /^word\/media\/.+\.png$/.test(name))).toBe(true)
    expect(files['word/document.xml']).toContain('Hình: Sơ đồ logic của thiết kế')
    expect(files['word/_rels/document.xml.rels']).toContain('Target="http://archpilot.local:8080/designs/dsg_1"')
  })
})

describe('buildDiagramSvg', () => {
  it('draws containers, components and edges from stored positions', () => {
    const diagram = buildDiagramSvg(hybridGraph(), 'vi')!
    expect(diagram.nodes).toBe(20)
    expect(diagram.edges).toBe(8)
    expect(diagram.width).toBeGreaterThan(1400)
    expectWellFormed(diagram.svg)
    expect(diagram.svg).toContain('DC1 Hà Nội')
    expect(diagram.svg).toContain('marker-end="url(#arrow)"')
  })

  it('escapes every user string and returns null for an empty design', () => {
    const graph = hybridGraph()
    graph.nodes[0].label = '<img src=x onerror=alert(1)>'
    graph.edges[0].label = '" onload="x'
    const diagram = buildDiagramSvg(graph, 'en')!
    expectWellFormed(diagram.svg)
    expect(diagram.svg).not.toContain('<img')
    expect(diagram.svg).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(diagram.svg).toContain('&quot; onload=&quot;x')
    expect(buildDiagramSvg(null, 'en')).toBeNull()
    expect(buildDiagramSvg({ ...graph, nodes: [], edges: [] }, 'en')).toBeNull()
  })
})
