/**
 * Built-in rule packs (docs/v3/05 RB-08, pilot WP-A). Same format, evaluator
 * and tests as user packs (RB-01); they live in code so they ship with the
 * build and cannot be edited in place. To change one, bump `version`.
 */
import type { RulePack } from '../../../contracts/pilot'
import { appTierModel } from './appTier'
import { kafkaModel } from './kafka'
import { rdbmsModel } from './rdbms'
import { redisModel } from './redis'
import { sanStorageModel } from './sanStorage'
import { vmwareHostModel } from './vmwareHost'

export const ARCHPILOT_CORE_PACK: RulePack = {
  id: 'archpilot-core',
  name: 'ArchPilot core sizing',
  version: 1,
  status: 'published',
  builtIn: true,
  owner: null,
  description: 'Built-in models: app tier (Little\'s law), Redis, VMware hosts, Kafka, RDBMS, SAN storage. Every model carries golden tests.',
  models: [appTierModel, redisModel, vmwareHostModel, kafkaModel, rdbmsModel, sanStorageModel],
}

export const BUILT_IN_PACKS: readonly RulePack[] = [ARCHPILOT_CORE_PACK]
