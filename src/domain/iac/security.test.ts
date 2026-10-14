/**
 * Security suite over every golden (REQ-IAC-015/018/019, NFR2-SEC-001/002;
 * design-v2 4.4.8 "IAM and security groups", 4.4.13 "Security" row).
 * Checks the IR (structure and marks) and the emitted text (secret lint).
 */
import { describe, expect, it } from 'vitest'
import type { ToolIr } from './core/types'
import { buildContext } from './core/generate'
import { lintFiles } from './core/secrets'
import type { Block, BodyItem, Expr } from './terraform/ir'
import { isTerraformIr, type TerraformIr } from './terraform/module'
import { generateGolden, goldenCases, goldenRegistry, loadFixture } from './testing/goldens'

function planOf(fixture: string, adapterId: string, profileId: string): TerraformIr {
  const built = buildContext(loadFixture(fixture), { profileId, adapterId, options: { pipeline: 'none' }, allowTestAdapters: true }, goldenRegistry)
  if ('ruleId' in built) throw new Error(built.ruleId)
  const ir: ToolIr = built.adapter.plan(built.ctx)
  if (!isTerraformIr(ir)) throw new Error('not terraform')
  return ir
}

function* walk(blocks: Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b
    yield* walk(b.body.filter((item): item is Block => item.kind === 'block'))
  }
}

function attrOf(b: Block, name: string): Expr | undefined {
  return (b.body.find((item: BodyItem) => item.kind === 'attr' && item.name === name) as { value: Expr } | undefined)?.value
}

function strings(e: Expr | undefined): string[] {
  if (!e) return []
  switch (e.k) {
    case 'str': return [e.v]
    case 'list': return e.items.flatMap(strings)
    case 'tmpl': return e.parts.filter((part): part is string => typeof part === 'string')
    default: return []
  }
}

const cases = goldenCases()

describe.each(cases.map((c) => [c.fixture, c] as const))('%s', (_name, c) => {
  const ir = planOf(c.fixture, c.adapterId, c.profileId)
  const blocks = [...walk(ir.groups.flatMap((group) => group.blocks))]

  it('IAM: no "*" in any action; Resource "*" only where AWS requires it (marked and commented)', () => {
    for (const statement of blocks.filter((b) => b.type === 'statement')) {
      for (const action of strings(attrOf(statement, 'actions'))) expect(action).not.toContain('*')
      const resources = strings(attrOf(statement, 'resources'))
      if (resources.includes('*')) {
        expect(statement.marks).toEqual(['iamWildcardResourceRequired'])
        expect(strings(attrOf(statement, 'actions'))).toEqual(['ecr:GetAuthorizationToken'])
      }
      for (const principals of statement.body.filter((item): item is Block => item.kind === 'block' && item.type === 'principals')) {
        expect(strings(attrOf(principals, 'identifiers'))).not.toContain('*')
      }
    }
  })

  it('security groups: 0.0.0.0/0 only on a marked listener ingress or the marked service egress 443', () => {
    const rules = blocks.filter((b) => b.type === 'resource' && /^aws_vpc_security_group_(ingress|egress)_rule$/.test(b.labels[0]))
    for (const rule of rules) {
      const cidr = strings(attrOf(rule, 'cidr_ipv4'))
      const port = attrOf(rule, 'from_port')
      expect(attrOf(rule, 'ip_protocol')).toEqual({ k: 'str', v: 'tcp' })
      expect(attrOf(rule, 'to_port')).toEqual(port)
      if (cidr.length === 0) {
        expect(attrOf(rule, 'referenced_security_group_id')).toBeDefined()
        continue
      }
      expect(cidr).toEqual(['0.0.0.0/0'])
      if (rule.labels[0].endsWith('ingress_rule')) {
        expect(rule.marks).toEqual(['publicListenerIngress'])
        expect([443, 80]).toContain((port as { v: number }).v)
      } else {
        expect(rule.marks).toEqual(['serviceEgress443'])
        expect(port).toEqual({ k: 'num', v: 443 })
      }
    }
    // No inline ingress/egress blocks anywhere (they would bypass the checks above).
    expect(blocks.filter((b) => b.type === 'ingress' || b.type === 'egress')).toEqual([])
  })

  it('secure defaults hold on every RDS, ECS service, subnet and load balancer', () => {
    for (const b of blocks.filter((x) => x.type === 'resource')) {
      const is = (name: string, value: Expr) => expect(attrOf(b, name), `${b.labels.join('.')}.${name}`).toEqual(value)
      if (b.labels[0] === 'aws_db_instance') {
        is('storage_encrypted', { k: 'bool', v: true })
        is('publicly_accessible', { k: 'bool', v: false })
        is('manage_master_user_password', { k: 'bool', v: true })
        is('skip_final_snapshot', { k: 'bool', v: false })
        expect(attrOf(b, 'password')).toBeUndefined()
      }
      if (b.labels[0] === 'aws_subnet') is('map_public_ip_on_launch', { k: 'bool', v: false })
      if (b.labels[0] === 'aws_lb') is('drop_invalid_header_fields', { k: 'bool', v: true })
      if (b.labels[0] === 'aws_ecs_service') {
        const net = b.body.find((item): item is Block => item.kind === 'block' && item.type === 'network_configuration')!
        expect(attrOf(net, 'assign_public_ip')).toEqual({ k: 'bool', v: false })
      }
      if (b.labels[0] === 'vsphere_virtual_machine') {
        expect(attrOf(b.body.find((item): item is Block => item.kind === 'block' && item.type === 'disk')!, 'thin_provisioned')).toBeDefined()
      }
    }
  })

  it('sensitive variables have no default and no tfvars value; no variable default looks like a secret', () => {
    for (const v of ir.variables) {
      if (v.sensitive) {
        expect(v.default, v.name).toBeUndefined()
        expect(v.tfvars, v.name).toBeUndefined()
      }
      if (/password|secret|token/i.test(v.name)) expect(v.sensitive, v.name).toBe(true)
    }
  })

  it('NFR2-SEC-001: the emitted files pass the secret lint', () => {
    const result = generateGolden(c)
    expect(lintFiles(result.files)).toEqual([])
  })
})
