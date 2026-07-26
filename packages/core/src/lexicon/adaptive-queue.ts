import type { Card } from 'ts-fsrs'
import type { Word } from '../types'
import { practiceEntityKey, spellingCardKey } from './card-state'
import type { LearningStage, MasteryTarget } from './index'

export type AdaptiveQueueKind = 'review' | 'new' | 'prerequisite'

export type AdaptiveQueueReasonCode =
  | 'overdue'
  | 'due-now'
  | 'prerequisite'
  | 'personal-error'
  | 'active-stage'
  | 'receptive-stage'
  | 'domain-boost'
  | 'encountered'
  | 'explicit-on-demand'
  | 'source-breadth'
  | 'canonical-order'

export interface AdaptiveQueueReason {
  code: AdaptiveQueueReasonCode
  weight: number
  detail: string
}

export interface AdaptiveQueueCandidate {
  word: Word
  /** Existing skill card. Absence means this is a new item for that skill. */
  card?: Card
  /** Optional explicit card ID for non-spelling skills. */
  cardId?: string
  /** Repeated personal failure severity, normally 0–10. */
  personalErrorWeight?: number
  /** Temporary goal boost for a domain, project, article, or current task. */
  domainBoost?: number
  /** The learner met this entity in real context. */
  encountered?: boolean
  /** Explicitly requested despite being in S6/on-demand. */
  explicitOnDemand?: boolean
  /** Already mastered for the target skill. */
  known?: boolean
  suspended?: boolean
}

export interface AdaptiveQueuePolicy {
  now?: Date
  maxItems: number
  maxReviews: number
  maxNew: number
  /** Maximum share of new slots allocated to receptive S4/S5 items while active items remain. */
  receptiveNewShare?: number
  /** Optional stage allow-list. Prerequisites may cross this boundary when required. */
  allowedStages?: LearningStage[]
}

export interface AdaptiveQueueItem {
  entityKey: string
  cardId: string
  word: Word
  kind: AdaptiveQueueKind
  score: number
  reasons: AdaptiveQueueReason[]
  prerequisiteFor?: string
}

export interface AdaptiveQueueResult {
  items: AdaptiveQueueItem[]
  reviewCount: number
  newCount: number
  prerequisiteCount: number
  skipped: {
    known: number
    suspended: number
    quarantined: number
    onDemand: number
    stageFiltered: number
    duplicate: number
    prerequisiteBudget: number
  }
}

type RankedCandidate = AdaptiveQueueCandidate & {
  entityKey: string
  cardId: string
  stage: LearningStage
  masteryTarget: MasteryTarget
  active: boolean
  receptive: boolean
  score: number
  reasons: AdaptiveQueueReason[]
  dueAt: number
}

const STAGE_WEIGHT: Record<string, number> = {
  S0_foundation_automatic: 70_000,
  S1_core_automatic: 60_000,
  S2_general_active: 50_000,
  S3_academic_technical_active: 40_000,
  S4_broad_receptive: 30_000,
  S5_specialized_contextual: 20_000,
  S6_on_demand: 10_000,
  Q0_cleanup: -1_000_000,
}

function numberOrZero(value: unknown): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function stageOf(word: Word): LearningStage {
  return (word.lexiconMeta?.learningStage ?? 'S6_on_demand') as LearningStage
}

function masteryTargetOf(word: Word): MasteryTarget {
  return word.lexiconMeta?.masteryTarget ?? 'on_demand'
}

function isActiveStage(stage: LearningStage, masteryTarget: MasteryTarget): boolean {
  return (
    ['S0_foundation_automatic', 'S1_core_automatic', 'S2_general_active', 'S3_academic_technical_active'].includes(stage) ||
    ['active_automatic', 'active_controlled'].includes(masteryTarget)
  )
}

function isReceptiveStage(stage: LearningStage, masteryTarget: MasteryTarget): boolean {
  return (
    ['S4_broad_receptive', 'S5_specialized_contextual'].includes(stage) ||
    ['receptive_fluent', 'receptive_contextual'].includes(masteryTarget)
  )
}

function cardDueAt(card: Card | undefined): number {
  if (!card?.due) return Number.POSITIVE_INFINITY
  const due = new Date(card.due).getTime()
  return Number.isFinite(due) ? due : Number.POSITIVE_INFINITY
}

function addReason(reasons: AdaptiveQueueReason[], code: AdaptiveQueueReasonCode, weight: number, detail: string) {
  if (!weight && code !== 'due-now') return
  reasons.push({ code, weight, detail })
}

function buildRankedCandidate(candidate: AdaptiveQueueCandidate, now: number): RankedCandidate {
  const { word } = candidate
  const entityKey = practiceEntityKey(word)
  const stage = stageOf(word)
  const masteryTarget = masteryTargetOf(word)
  const active = isActiveStage(stage, masteryTarget)
  const receptive = isReceptiveStage(stage, masteryTarget)
  const dueAt = cardDueAt(candidate.card)
  const reasons: AdaptiveQueueReason[] = []
  const stageWeight = STAGE_WEIGHT[stage] ?? 0
  const priorityScore = numberOrZero(word.lexiconMeta?.priorityScore)
  const sourceFamilyCount = numberOrZero(word.lexiconMeta?.sourceFamilyCount)
  const personalError = clamp(numberOrZero(candidate.personalErrorWeight), 0, 100)
  const domainBoost = clamp(numberOrZero(candidate.domainBoost), 0, 100)
  const rank = Math.max(1, numberOrZero((word.lexiconMeta as any)?.independentRank) || 100_000)
  let score = stageWeight + priorityScore * 100 + Math.max(0, 20_000 - rank)

  addReason(reasons, 'canonical-order', Math.max(0, 20_000 - rank), `canonical rank ${rank}`)
  addReason(reasons, active ? 'active-stage' : 'receptive-stage', stageWeight, `${stage} / ${masteryTarget}`)
  addReason(reasons, 'source-breadth', sourceFamilyCount * 20, `${sourceFamilyCount} source families`)
  score += sourceFamilyCount * 20

  if (personalError > 0) {
    const weight = personalError * 2_000
    score += weight
    addReason(reasons, 'personal-error', weight, `personal error severity ${personalError}`)
  }
  if (domainBoost > 0) {
    const weight = domainBoost * 1_500
    score += weight
    addReason(reasons, 'domain-boost', weight, `goal boost ${domainBoost}`)
  }
  if (candidate.encountered) {
    score += 25_000
    addReason(reasons, 'encountered', 25_000, 'encountered in real context')
  }
  if (candidate.explicitOnDemand) {
    score += 30_000
    addReason(reasons, 'explicit-on-demand', 30_000, 'explicit learner request')
  }

  if (candidate.card && dueAt <= now) {
    const overdueHours = Math.max(0, (now - dueAt) / 3_600_000)
    const overdueWeight = Math.min(800_000, 300_000 + overdueHours * 100)
    score += 1_000_000 + overdueWeight
    addReason(reasons, overdueHours >= 1 ? 'overdue' : 'due-now', 1_000_000 + overdueWeight, `${overdueHours.toFixed(1)} hours overdue`)
  }

  return {
    ...candidate,
    entityKey,
    cardId: candidate.cardId || spellingCardKey(word),
    stage,
    masteryTarget,
    active,
    receptive,
    score,
    reasons,
    dueAt,
  }
}

function compareRanked(left: RankedCandidate, right: RankedCandidate): number {
  return (
    right.score - left.score ||
    left.dueAt - right.dueAt ||
    numberOrZero((left.word.lexiconMeta as any)?.independentRank) -
      numberOrZero((right.word.lexiconMeta as any)?.independentRank) ||
    left.entityKey.localeCompare(right.entityKey)
  )
}

function queueItem(candidate: RankedCandidate, kind: AdaptiveQueueKind, prerequisiteFor?: string): AdaptiveQueueItem {
  const reasons = candidate.reasons.slice()
  let score = candidate.score
  if (kind === 'prerequisite') {
    const weight = 900_000
    score += weight
    reasons.push({
      code: 'prerequisite',
      weight,
      detail: prerequisiteFor ? `required before ${prerequisiteFor}` : 'required prerequisite',
    })
  }
  return {
    entityKey: candidate.entityKey,
    cardId: candidate.cardId,
    word: candidate.word,
    kind,
    score,
    reasons,
    prerequisiteFor,
  }
}

/**
 * Creates a finite, deterministic, explainable queue.
 *
 * Ordering contract:
 * 1. overdue/due reviews;
 * 2. active new items under the active quota;
 * 3. receptive new items under the receptive quota;
 * 4. unused slots may be filled by either pool;
 * 5. every unmet prerequisite is inserted before its dependent, or the
 *    dependent is skipped if the remaining budget cannot contain the closure.
 */
export function buildAdaptiveLexiconQueue(
  candidates: AdaptiveQueueCandidate[],
  policy: AdaptiveQueuePolicy
): AdaptiveQueueResult {
  const now = (policy.now ?? new Date()).getTime()
  const maxItems = Math.max(0, Math.floor(policy.maxItems))
  const maxReviews = Math.min(maxItems, Math.max(0, Math.floor(policy.maxReviews)))
  const maxNew = Math.min(maxItems, Math.max(0, Math.floor(policy.maxNew)))
  const receptiveShare = clamp(policy.receptiveNewShare ?? 0.25, 0, 1)
  const allowedStages = policy.allowedStages ? new Set(policy.allowedStages) : null
  const skipped = {
    known: 0,
    suspended: 0,
    quarantined: 0,
    onDemand: 0,
    stageFiltered: 0,
    duplicate: 0,
    prerequisiteBudget: 0,
  }

  const byEntity = new Map<string, RankedCandidate>()
  for (const rawCandidate of candidates) {
    if (rawCandidate.known) {
      skipped.known++
      continue
    }
    if (rawCandidate.suspended) {
      skipped.suspended++
      continue
    }

    const ranked = buildRankedCandidate(rawCandidate, now)
    if (ranked.stage === 'Q0_cleanup' || ranked.masteryTarget === 'quarantine' || ranked.word.lexiconMeta?.qualityStatus === 'quarantined') {
      skipped.quarantined++
      continue
    }
    if (ranked.stage === 'S6_on_demand' && !ranked.encountered && !ranked.explicitOnDemand) {
      skipped.onDemand++
      continue
    }
    if (allowedStages && !allowedStages.has(ranked.stage)) {
      skipped.stageFiltered++
      continue
    }

    const existing = byEntity.get(ranked.entityKey)
    if (!existing || compareRanked(ranked, existing) < 0) {
      if (existing) skipped.duplicate++
      byEntity.set(ranked.entityKey, ranked)
    } else skipped.duplicate++
  }

  const all = [...byEntity.values()]
  const reviews = all.filter(item => item.card && item.dueAt <= now).sort(compareRanked)
  const newActive = all.filter(item => !item.card && item.active).sort(compareRanked)
  const newReceptive = all.filter(item => !item.card && !item.active && item.receptive).sort(compareRanked)
  const newOther = all.filter(item => !item.card && !item.active && !item.receptive).sort(compareRanked)

  const items: AdaptiveQueueItem[] = []
  const selected = new Set<string>()
  const reviewing = new Set<string>()

  for (const candidate of reviews.slice(0, maxReviews)) {
    items.push(queueItem(candidate, 'review'))
    selected.add(candidate.entityKey)
    reviewing.add(candidate.entityKey)
  }

  function unmetPrerequisiteClosure(candidate: RankedCandidate): RankedCandidate[] | null {
    const closure: RankedCandidate[] = []
    const visited = new Set<string>()
    const stack = new Set<string>()

    function visit(entityKey: string): boolean {
      if (selected.has(entityKey) || visited.has(entityKey)) return true
      if (stack.has(entityKey)) return false
      const prerequisite = byEntity.get(entityKey)
      if (!prerequisite) return false
      stack.add(entityKey)
      for (const nested of prerequisite.word.lexiconMeta?.prerequisiteLexicalUnitIds ?? []) {
        if (!visit(nested)) return false
      }
      stack.delete(entityKey)
      visited.add(entityKey)
      if (!prerequisite.card) closure.push(prerequisite)
      return true
    }

    for (const prerequisite of candidate.word.lexiconMeta?.prerequisiteLexicalUnitIds ?? []) {
      if (!visit(prerequisite)) return null
    }
    return closure.filter(item => !selected.has(item.entityKey))
  }

  function appendNew(candidate: RankedCandidate): boolean {
    if (selected.has(candidate.entityKey)) return false
    const closure = unmetPrerequisiteClosure(candidate)
    if (closure === null || items.length + closure.length + 1 > maxItems) {
      skipped.prerequisiteBudget++
      return false
    }
    for (const prerequisite of closure) {
      if (selected.has(prerequisite.entityKey)) continue
      items.push(queueItem(prerequisite, 'prerequisite', candidate.entityKey))
      selected.add(prerequisite.entityKey)
    }
    if (items.length >= maxItems) return false
    items.push(queueItem(candidate, 'new'))
    selected.add(candidate.entityKey)
    return true
  }

  const newBudget = Math.min(maxNew, Math.max(0, maxItems - items.length))
  const receptiveQuota = Math.floor(newBudget * receptiveShare)
  const activeQuota = newBudget - receptiveQuota
  let activeAdded = 0
  let receptiveAdded = 0

  for (const candidate of newActive) {
    if (activeAdded >= activeQuota || items.length >= maxItems) break
    const before = selected.size
    if (appendNew(candidate)) activeAdded += Math.max(1, selected.size - before)
  }
  for (const candidate of newReceptive) {
    if (receptiveAdded >= receptiveQuota || items.length >= maxItems) break
    const before = selected.size
    if (appendNew(candidate)) receptiveAdded += Math.max(1, selected.size - before)
  }

  for (const candidate of [...newActive, ...newReceptive, ...newOther].sort(compareRanked)) {
    if (items.length >= maxItems || selected.size - reviewing.size >= maxNew) break
    appendNew(candidate)
  }

  return {
    items,
    reviewCount: items.filter(item => item.kind === 'review').length,
    newCount: items.filter(item => item.kind === 'new').length,
    prerequisiteCount: items.filter(item => item.kind === 'prerequisite').length,
    skipped,
  }
}
