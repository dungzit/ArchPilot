/**
 * IaC generation (design-v2 4.4). Pure TypeScript: runs in the browser (Code
 * tab, Generate dialog) and in Node (vitest goldens, CI). No clock, no
 * randomness, no locale, no environment input.
 *
 *   core/        tool-agnostic: adapter interface, registry, coverage, gate, Markdown, manifest, zip
 *   terraform/   the shared Terraform layer: IR, fmt-canonical printer, escaping, naming, CIDR, files
 *   adapters/    one folder per adapter (aws, vsphere)
 */
import { awsTerraformAdapter } from './adapters/aws'
import { vsphereTerraformAdapter } from './adapters/vsphere'
import { createRegistry, type AdapterRegistry } from './core/registry'

export * from './core/types'
export type { IacAdapter, AdapterStatus } from './core/adapter'
export { createRegistry, type AdapterRegistry, type RegisteredAdapter } from './core/registry'
export { coverageFor, generatePackage, packageZip, type GenerateRequest, type PackageResult } from './core/generate'
export { GENERATOR_VERSION, TERRAFORM_VERSION, TERRAFORM_FLOOR_VERSION } from './versions'

/**
 * The registry the application uses. `aws-terraform` is shipped (goldens +
 * CI gate). `vsphere-terraform` is the Phase 1 spike: registered as `test`,
 * so the UI does not offer it until Phase V completes it.
 */
export function createDefaultRegistry(): AdapterRegistry {
  const registry = createRegistry()
  registry.register(awsTerraformAdapter, 'shipped')
  registry.register(vsphereTerraformAdapter, 'test')
  return registry
}

export const iacRegistry: AdapterRegistry = createDefaultRegistry()
