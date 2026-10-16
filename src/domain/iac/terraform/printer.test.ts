import { describe, expect, it } from 'vitest'
import {
  attr, block, bool, call, cond, forList, list, not, num, obj, op, paren, ref, resource, str, tmpl, type Expr,
} from './ir'
import { HclPrintError, isMultiline, printAttributeFile, printBlock, printExpr, printFile } from './printer'

// Every expected string below was checked with the real `terraform fmt -check`
// 1.16.4 (see the build note); the golden suite re-checks whole files in CI.

describe('printExpr: scalars', () => {
  it('prints strings, numbers, booleans and null', () => {
    expect(printExpr(str('a'), 0)).toBe('"a"')
    expect(printExpr(num(8080), 0)).toBe('8080')
    expect(printExpr(num(-1), 0)).toBe('-1')
    expect(printExpr(num(3.25), 0)).toBe('3.25')
    expect(printExpr(num(-0), 0)).toBe('0')
    expect(printExpr(bool(true), 0)).toBe('true')
    expect(printExpr({ k: 'null' }, 0)).toBe('null')
  })

  it('refuses exponent-form and non-finite numbers (IR constraint 6)', () => {
    expect(() => printExpr(num(1e21), 0)).toThrow(HclPrintError)
    expect(() => printExpr(num(1e-7), 0)).toThrow(HclPrintError)
    expect(() => printExpr(num(Number.NaN), 0)).toThrow(HclPrintError)
    expect(() => printExpr(num(Number.POSITIVE_INFINITY), 0)).toThrow(HclPrintError)
  })

  it('refuses references that are not plain traversals', () => {
    expect(printExpr(ref('data.aws_availability_zones.available.names[count.index]'), 0)).toBe('data.aws_availability_zones.available.names[count.index]')
    expect(printExpr(ref('aws_subnet.app[*].id'), 0)).toBe('aws_subnet.app[*].id')
    expect(printExpr(ref('aws_db_instance.x.master_user_secret[0].secret_arn'), 0)).toBe('aws_db_instance.x.master_user_secret[0].secret_arn')
    for (const bad of ['var.x}', 'file("x")', 'a b', '${var.x}', 'a.b[var.c]', '']) {
      expect(() => printExpr(ref(bad), 0), bad).toThrow(HclPrintError)
    }
  })
})

describe('templates (IR constraint 1)', () => {
  it('collapses an interpolation-only template to the bare expression', () => {
    expect(tmpl(ref('var.x'))).toEqual(ref('var.x'))
    expect(tmpl('', ref('var.x'), '')).toEqual(ref('var.x'))
    expect(printExpr(tmpl(ref('var.x')), 0)).toBe('var.x')
  })

  it('merges literal parts and keeps literal-only templates as strings', () => {
    expect(tmpl('a', str('b'), 'c')).toEqual(str('abc'))
    expect(printExpr(tmpl(ref('local.name_prefix'), '-orders'), 0)).toBe('"${local.name_prefix}-orders"')
    expect(printExpr(tmpl(ref('local.name_prefix'), '-db-', op(ref('count.index'), '+', num(1))), 0)).toBe('"${local.name_prefix}-db-${count.index + 1}"')
  })

  it('escapes literal parts, so user text cannot open an interpolation', () => {
    expect(printExpr(tmpl(ref('local.p'), '-${file("x")}'), 0)).toBe('"${local.p}-$${file(\\"x\\")}"')
  })

  it('refuses a hand-built interpolation-only template', () => {
    expect(() => printExpr({ k: 'tmpl', parts: [ref('var.x')] }, 0)).toThrow(/constraint 1/)
  })
})

describe('lists, objects and calls', () => {
  it('prints short lists inline and empty collections compactly', () => {
    expect(printExpr(list([str('a'), num(1), ref('var.x')]), 0)).toBe('["a", 1, var.x]')
    expect(printExpr(list([]), 0)).toBe('[]')
    expect(printExpr(obj([]), 0)).toBe('{}')
  })

  it('prints objects one entry per line with keys aligned', () => {
    expect(printExpr(obj([['Name', str('x')], ['archpilot_node', str('orders')]]), 1)).toBe([
      '{',
      '    Name           = "x"',
      '    archpilot_node = "orders"',
      '  }',
    ].join('\n'))
  })

  it('quotes keys that are not bare identifiers or are keywords', () => {
    expect(printExpr(obj([['awslogs-group', str('g')], ['true', num(1)], ['a', num(2)]]), 0)).toBe([
      '{',
      '  "awslogs-group" = "g"',
      '  "true"          = 1',
      '  a               = 2',
      '}',
    ].join('\n'))
    expect(() => printExpr(obj([['ố', num(1)]]), 0)).toThrow(/ASCII/)
    expect(() => printExpr(obj([['a', num(1)], ['a', num(2)]]), 0)).toThrow(/twice/)
  })

  it('breaks the alignment run at a multi-line entry (observed fmt behaviour)', () => {
    const e = obj([
      ['name', str('x')],
      ['image', ref('var.y')],
      ['portMappings', list([obj([['containerPort', num(8080)]])])],
      ['logConfiguration', obj([['logDriver', str('awslogs')]])],
      ['essential', bool(true)],
    ])
    expect(printExpr(e, 1)).toBe([
      '{',
      '    name  = "x"',
      '    image = var.y',
      '    portMappings = [',
      '      {',
      '        containerPort = 8080',
      '      },',
      '    ]',
      '    logConfiguration = {',
      '      logDriver = "awslogs"',
      '    }',
      '    essential = true',
      '  }',
    ].join('\n'))
  })

  it('opens a multi-line last call argument on the call line', () => {
    expect(printExpr(call('merge', ref('var.tags'), obj([['a', num(1)], ['bbb', num(2)]])), 1)).toBe([
      'merge(var.tags, {',
      '    a   = 1',
      '    bbb = 2',
      '  })',
    ].join('\n'))
    expect(printExpr(call('jsonencode', list([obj([['a', num(1)]])])), 0)).toBe(['jsonencode([', '  {', '    a = 1', '  },', '])'].join('\n'))
  })

  it('refuses a multi-line argument that is not last', () => {
    expect(() => printExpr(call('merge', obj([['a', num(1)]]), ref('var.tags')), 0)).toThrow(/last argument/)
  })

  it('classifies multi-line expressions', () => {
    expect(isMultiline(obj([]))).toBe(false)
    expect(isMultiline(obj([['a', num(1)]]))).toBe(true)
    expect(isMultiline(list([str('a')]))).toBe(false)
    expect(isMultiline(call('merge', ref('var.a'), obj([['a', num(1)]])))).toBe(true)
  })
})

describe('operators', () => {
  it('prints operators with fmt spacing and adds parentheses only where precedence needs them', () => {
    expect(printExpr(op(ref('var.a'), '>=', num(1)), 0)).toBe('var.a >= 1')
    expect(printExpr(op(op(ref('var.a'), '>=', num(1)), '&&', op(ref('var.a'), '<=', num(10))), 0)).toBe('var.a >= 1 && var.a <= 10')
    expect(printExpr(op(op(ref('var.a'), '+', num(1)), '*', num(2)), 0)).toBe('(var.a + 1) * 2')
    expect(printExpr(op(ref('var.a'), '-', op(ref('var.b'), '-', num(1))), 0)).toBe('var.a - (var.b - 1)')
    expect(printExpr(not(ref('var.flag')), 0)).toBe('!var.flag')
    expect(printExpr(not(op(ref('var.a'), '==', num(1))), 0)).toBe('!(var.a == 1)')
    expect(printExpr(cond(op(ref('var.a'), '==', str('x')), str('y'), str('z')), 0)).toBe('var.a == "x" ? "y" : "z"')
    expect(printExpr(paren(ref('var.a')), 0)).toBe('(var.a)')
    expect(printExpr(forList('c', ref('var.x'), call('can', call('cidrhost', ref('c'), num(0)))), 0)).toBe('[for c in var.x : can(cidrhost(c, 0))]')
  })
})

describe('blocks and files', () => {
  it('aligns runs of single-line attributes and spaces multi-line values and nested blocks', () => {
    const b = resource('aws_ecs_service', 'orders_api', [
      attr('name', str('x')),
      attr('desired_count', ref('var.orders_api_desired_count')),
      attr('launch_type', str('FARGATE')),
      block('network_configuration', [], [
        attr('subnets', ref('aws_subnet.app[*].id')),
        attr('assign_public_ip', bool(false)),
      ]),
      attr('tags', obj([['Name', str('x')]])),
    ])
    expect(printBlock(b)).toBe([
      'resource "aws_ecs_service" "orders_api" {',
      '  name          = "x"',
      '  desired_count = var.orders_api_desired_count',
      '  launch_type   = "FARGATE"',
      '',
      '  network_configuration {',
      '    subnets          = aws_subnet.app[*].id',
      '    assign_public_ip = false',
      '  }',
      '',
      '  tags = {',
      '    Name = "x"',
      '  }',
      '}',
      '',
    ].join('\n'))
  })

  it('breaks the run at an attribute comment (observed fmt behaviour)', () => {
    const b = block('statement', [], [
      attr('sid', str('EcrAuthToken')),
      attr('actions', list([str('ecr:GetAuthorizationToken')])),
      attr('resources', list([str('*')]), ['AWS requires "*" for this action']),
    ])
    expect(printBlock(b)).toBe([
      'statement {',
      '  sid     = "EcrAuthToken"',
      '  actions = ["ecr:GetAuthorizationToken"]',
      '  # AWS requires "*" for this action',
      '  resources = ["*"]',
      '}',
      '',
    ].join('\n'))
  })

  it('prints an empty block on one line and refuses duplicate attributes and bad identifiers', () => {
    expect(printBlock(block('backend', ['s3'], []))).toBe('backend "s3" {}\n')
    expect(() => printBlock(block('x', [], [attr('a', num(1)), attr('a', num(2))]))).toThrow(/twice/)
    expect(() => printBlock(block('x', [], [attr('bad name', num(1))]))).toThrow(HclPrintError)
    expect(() => printBlock(block('resource', ['aws_vpc', 'x"y'], []))).toThrow(HclPrintError)
  })

  it('prints a file: header, one blank line between blocks, one trailing newline, LF only', () => {
    const text = printFile({ header: ['Generated by ArchPilot.', 'Line two\nwith a newline'], blocks: [block('locals', [], [attr('a', num(1))]), block('locals', [], [attr('b', num(2))])] })
    expect(text).toBe('# Generated by ArchPilot.\n# Line two with a newline\n\nlocals {\n  a = 1\n}\n\nlocals {\n  b = 2\n}\n')
    expect(text).not.toMatch(/\r|\t/)
  })

  it('prints attribute files (tfvars) with aligned rows', () => {
    expect(printAttributeFile(['h'], [attr('project_name', str('orders')), attr('aws_region', str('ap-southeast-1'))])).toBe(
      '# h\n\nproject_name = "orders"\naws_region   = "ap-southeast-1"\n',
    )
  })

  it('is deterministic: same IR, same bytes', () => {
    const make = (): Expr => obj([['b', list([num(1), num(2)])], ['a', tmpl(ref('var.x'), '-y')]])
    expect(printExpr(make(), 0)).toBe(printExpr(make(), 0))
  })
})
