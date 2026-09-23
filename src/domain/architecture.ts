import type { ArchitectureComponent, DeploymentTarget } from './model'

const STORAGE_KEY = 'archpilot.architecture-components.v1'

export const seedComponents: ArchitectureComponent[] = [
  { id: 'api-gateway', name: 'API Gateway', type: 'network', target: 'aws', environment: 'production' },
  { id: 'order-service', name: 'Order Service', type: 'service', target: 'kubernetes', environment: 'production' },
  { id: 'orders-db', name: 'Orders Database', type: 'database', target: 'aws', environment: 'production' },
]

export function loadComponents(): ArchitectureComponent[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return seedComponents
  try {
    const parsed = JSON.parse(raw) as ArchitectureComponent[]
    return Array.isArray(parsed) ? parsed : seedComponents
  } catch {
    return seedComponents
  }
}

export function saveComponents(components: ArchitectureComponent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(components))
}

export function createComponent(input: { name: string; type: ArchitectureComponent['type']; target: DeploymentTarget; environment: string }): ArchitectureComponent {
  return { ...input, id: `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now()}` }
}
