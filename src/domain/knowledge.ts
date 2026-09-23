export interface KnowledgeRecord {
  id: string
  title: string
  summary: string
  kind: 'pattern' | 'anti_pattern' | 'technology' | 'sizing_rule' | 'control'
  tags: string[]
  targets: string[]
  source?: string
}

export function searchKnowledge(records: KnowledgeRecord[], query: string): KnowledgeRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
  if (!normalizedQuery) return records
  return records.filter((record) => [record.title, record.summary, record.kind, ...record.tags, ...record.targets].join(' ').toLocaleLowerCase('vi-VN').includes(normalizedQuery))
}
