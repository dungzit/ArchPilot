/**
 * Stub adapters for SC-18 / REQ-ADP-005 / REQ-ADP-009 / NFR2-EXT-001
 * (design-v2 4.4.3, task 1.2). Test-only: registered as `test` in
 * `stubs.test.ts`, never in the application registry.
 *
 * - `ansible-stub` (tool 'ansible') emits YAML (inventory + playbook), its own
 *   file set and its own validation command. Nothing in core/ knows YAML.
 * - `acme-terraform` (tool 'terraform', target 'acme') reuses the shared
 *   Terraform layer with the built-in `terraform_data` resource.
 * - `leaky-stub` emits a secret on purpose, to prove IAC-E12 blocks it.
 *
 * Both only use the public core API: adding them required no core change.
 */
import type { IacAdapter } from '../core/adapter'
import type { GeneratedFile, RealisationCatalogue, TargetContext, ToolIr } from '../core/types'
import { attr, block, ref, resource, str } from '../terraform/ir'
import { printFile } from '../terraform/printer'

const en = (text: string) => ({ en: text, vi: text })
const COMMON = ['COVERAGE.md', 'MANUAL-STEPS.md', 'README.md', 'archpilot-manifest.json']

function hostCatalogue(target: string): RealisationCatalogue {
  return {
    target, version: '0.0.1', aliases: [], accessPairs: [], unmappedAccess: 'manual',
    realisations: [
      { id: `${target}.host`, role: 'bare_metal_host', label: en('Host'), badge: 'generatable', note: en('Configured by the stub.'), consumes: [] },
      { id: `${target}.vm`, role: 'virtual_machine', label: en('VM'), badge: 'generatable', note: en('Configured by the stub.'), consumes: [] },
    ],
  }
}

interface HostsIr extends ToolIr { tool: 'ansible'; hosts: string[] }

function generatableCodeNames(ctx: TargetContext): string[] {
  return ctx.coverage.nodes.filter((row) => row.class === 'generatable').map((row) => row.codeName)
}

export const ansibleStubAdapter: IacAdapter = {
  id: 'ansible-stub', version: '0.0.1', tool: 'ansible', targetKinds: ['bare_metal'],
  toolConstraint: '>= 2.16', providerPins: [], supportedFailureDomainLevels: [], variableSchema: [],
  emittedFiles: ['inventory.yml', 'site.yml', ...COMMON],
  pipelineTemplates: [],
  validationCommands: [['ansible-playbook', '--syntax-check', '-i', 'inventory.yml', 'site.yml']],
  goldenFixtures: [],
  catalogue: hostCatalogue('bare_metal'),
  gate: () => [],
  plan: (ctx): HostsIr => ({ tool: 'ansible', hosts: generatableCodeNames(ctx) }),
  manualSteps: () => [],
  files: (ir): GeneratedFile[] => {
    const hosts = (ir as HostsIr).hosts
    return [
      { path: 'inventory.yml', content: `all:\n  hosts:\n${hosts.map((host) => `    ${host}: {}\n`).join('')}` },
      { path: 'site.yml', content: '- name: Baseline\n  hosts: all\n  become: true\n  tasks:\n    - name: Ping\n      ansible.builtin.ping:\n' },
    ]
  },
}

export const acmeTerraformStub: IacAdapter = {
  id: 'acme-terraform', version: '0.0.1', tool: 'terraform', targetKinds: ['acme'],
  toolConstraint: '>= 1.11.0', providerPins: [], supportedFailureDomainLevels: ['host'], variableSchema: [],
  emittedFiles: ['main.tf', ...COMMON],
  pipelineTemplates: [],
  validationCommands: [['terraform', 'validate']],
  goldenFixtures: [],
  catalogue: hostCatalogue('acme'),
  gate: () => [],
  plan: (ctx): HostsIr => ({ tool: 'ansible', hosts: generatableCodeNames(ctx) }),
  manualSteps: () => [],
  files: (ir): GeneratedFile[] => [{
    path: 'main.tf',
    content: printFile({ header: ['acme stub'], blocks: (ir as HostsIr).hosts.map((host) => resource('terraform_data', host, [
      attr('input', str(host)),
      block('lifecycle', [], [attr('ignore_changes', { k: 'list', items: [ref('input')] })]),
    ])) }),
  }],
}

export const leakyStubAdapter: IacAdapter = {
  ...ansibleStubAdapter,
  id: 'leaky-stub',
  targetKinds: ['leaky'],
  catalogue: hostCatalogue('leaky'),
  files: () => [{ path: 'inventory.yml', content: 'all:\n  vars:\n    aws_key: AKIAABCDEFGHIJKLMNOP\n' }],
}
