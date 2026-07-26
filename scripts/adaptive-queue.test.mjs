import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAdaptiveLexiconQueue } from '../packages/core/src/lexicon/adaptive-queue.ts'

function card(due) {
  return {
    due: new Date(due),
    stability: 1,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 1,
    reps: 1,
    lapses: 0,
    state: 1,
    last_review: new Date('2026-01-01T00:00:00Z'),
  }
}

function word(display, id, stage, options = {}) {
  return {
    word: display,
    lexicalUnitId: id,
    phonetic0: '',
    phonetic1: '',
    trans: [],
    sentences: [],
    phrases: [],
    synos: [],
    relWords: { root: '', rels: [] },
    etymology: [],
    lexiconMeta: {
      schemaVersion: 2,
      lexicalUnitId: id,
      learningStage: stage,
      userTier: options.userTier ?? (stage.startsWith('S4') || stage.startsWith('S5') ? 'R1' : 'A1'),
      masteryTarget:
        options.masteryTarget ??
        (stage.startsWith('S4') || stage.startsWith('S5') ? 'receptive_fluent' : stage.startsWith('S6') ? 'on_demand' : 'active_automatic'),
      priorityScore: options.priorityScore ?? 0,
      independentRank: options.independentRank ?? 100,
      unitType: 'lexeme',
      qualityStatus: 'supported',
      sourceBookCount: options.sourceBookCount ?? 1,
      sourceFamilyCount: options.sourceFamilyCount ?? 1,
      independentStudy: true,
      prerequisiteLexicalUnitIds: options.prerequisites ?? [],
    },
  }
}

test('due reviews always precede new items within a finite budget', () => {
  const due = word('review-me', 'lu:review', 'S3_academic_technical_active')
  const fresh = word('new-me', 'lu:new', 'S0_foundation_automatic', { priorityScore: 100 })
  const result = buildAdaptiveLexiconQueue(
    [
      { word: fresh },
      { word: due, card: card('2026-07-20T00:00:00Z') },
    ],
    {
      now: new Date('2026-07-26T00:00:00Z'),
      maxItems: 2,
      maxReviews: 1,
      maxNew: 1,
    }
  )

  assert.deepEqual(result.items.map(item => item.entityKey), ['lu:review', 'lu:new'])
  assert.equal(result.items[0].kind, 'review')
  assert.ok(result.items[0].reasons.some(reason => reason.code === 'overdue'))
})

test('deduplicates the same normalized entity across source dictionaries', () => {
  const first = word('divide', 'lu:divide', 'S1_core_automatic', { priorityScore: 10 })
  const copied = word('divide', 'lu:divide', 'S1_core_automatic', { priorityScore: 5 })
  const result = buildAdaptiveLexiconQueue([{ word: first }, { word: copied }], {
    maxItems: 10,
    maxReviews: 0,
    maxNew: 10,
  })

  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].entityKey, 'lu:divide')
  assert.equal(result.skipped.duplicate, 1)
})

test('inserts an unmet prerequisite before its dependent', () => {
  const prerequisite = word('base', 'lu:base', 'S1_core_automatic', {
    priorityScore: 0,
    independentRank: 500,
  })
  const dependent = word('base expression', 'lu:expression', 'S2_general_active', {
    priorityScore: 100,
    independentRank: 1,
    prerequisites: ['lu:base'],
  })
  const result = buildAdaptiveLexiconQueue([{ word: dependent }, { word: prerequisite }], {
    maxItems: 2,
    maxReviews: 0,
    maxNew: 2,
  })

  assert.deepEqual(result.items.map(item => item.entityKey), ['lu:base', 'lu:expression'])
  assert.equal(result.items[0].kind, 'prerequisite')
  assert.equal(result.items[0].prerequisiteFor, 'lu:expression')
  assert.ok(result.items[0].reasons.some(reason => reason.code === 'prerequisite'))
})

test('does not admit a dependent when the remaining budget cannot contain its prerequisite closure', () => {
  const prerequisite = word('base', 'lu:base', 'S1_core_automatic', { independentRank: 500 })
  const dependent = word('base expression', 'lu:expression', 'S0_foundation_automatic', {
    priorityScore: 100,
    independentRank: 1,
    prerequisites: ['lu:base'],
  })
  const result = buildAdaptiveLexiconQueue([{ word: dependent }, { word: prerequisite }], {
    maxItems: 1,
    maxReviews: 0,
    maxNew: 1,
  })

  assert.deepEqual(result.items.map(item => item.entityKey), ['lu:base'])
  assert.equal(result.skipped.prerequisiteBudget, 1)
})

test('keeps S6 out of the daily queue until encountered or explicitly requested', () => {
  const ordinary = word('ordinary', 'lu:ordinary', 'S1_core_automatic')
  const dormant = word('rare-domain-term', 'lu:rare', 'S6_on_demand')
  const first = buildAdaptiveLexiconQueue([{ word: dormant }, { word: ordinary }], {
    maxItems: 10,
    maxReviews: 0,
    maxNew: 10,
  })
  const second = buildAdaptiveLexiconQueue([{ word: dormant, encountered: true }, { word: ordinary }], {
    maxItems: 10,
    maxReviews: 0,
    maxNew: 10,
  })

  assert.deepEqual(first.items.map(item => item.entityKey), ['lu:ordinary'])
  assert.equal(first.skipped.onDemand, 1)
  assert.ok(second.items.some(item => item.entityKey === 'lu:rare'))
  assert.ok(second.items.find(item => item.entityKey === 'lu:rare').reasons.some(reason => reason.code === 'encountered'))
})

test('protects active new capacity from being consumed by receptive vocabulary', () => {
  const active = [
    word('active-1', 'lu:a1', 'S2_general_active', { independentRank: 1 }),
    word('active-2', 'lu:a2', 'S2_general_active', { independentRank: 2 }),
    word('active-3', 'lu:a3', 'S3_academic_technical_active', { independentRank: 3 }),
  ]
  const receptive = [
    word('receptive-1', 'lu:r1', 'S4_broad_receptive', { priorityScore: 100, independentRank: 1 }),
    word('receptive-2', 'lu:r2', 'S4_broad_receptive', { priorityScore: 100, independentRank: 2 }),
    word('receptive-3', 'lu:r3', 'S5_specialized_contextual', { priorityScore: 100, independentRank: 3 }),
  ]
  const result = buildAdaptiveLexiconQueue([...active, ...receptive].map(item => ({ word: item })), {
    maxItems: 4,
    maxReviews: 0,
    maxNew: 4,
    receptiveNewShare: 0.25,
  })

  const activeCount = result.items.filter(item => item.word.lexiconMeta.learningStage.startsWith('S2') || item.word.lexiconMeta.learningStage.startsWith('S3')).length
  const receptiveCount = result.items.filter(item => item.word.lexiconMeta.learningStage.startsWith('S4') || item.word.lexiconMeta.learningStage.startsWith('S5')).length
  assert.equal(activeCount, 3)
  assert.equal(receptiveCount, 1)
})

test('personal error severity can reorder candidates within the same stage and exposes the reason', () => {
  const normal = word('normal', 'lu:normal', 'S1_core_automatic', { independentRank: 1 })
  const troublesome = word('troublesome', 'lu:trouble', 'S1_core_automatic', { independentRank: 1000 })
  const result = buildAdaptiveLexiconQueue(
    [
      { word: normal },
      { word: troublesome, personalErrorWeight: 5 },
    ],
    { maxItems: 2, maxReviews: 0, maxNew: 2 }
  )

  assert.equal(result.items[0].entityKey, 'lu:trouble')
  assert.ok(result.items[0].reasons.some(reason => reason.code === 'personal-error'))
})

test('is deterministic for the same candidates and policy', () => {
  const candidates = [
    { word: word('b', 'lu:b', 'S1_core_automatic', { priorityScore: 1, independentRank: 1 }) },
    { word: word('a', 'lu:a', 'S1_core_automatic', { priorityScore: 1, independentRank: 1 }) },
  ]
  const policy = { maxItems: 2, maxReviews: 0, maxNew: 2, now: new Date('2026-07-26T00:00:00Z') }

  const first = buildAdaptiveLexiconQueue(candidates, policy).items.map(item => item.entityKey)
  const second = buildAdaptiveLexiconQueue(candidates.slice().reverse(), policy).items.map(item => item.entityKey)
  assert.deepEqual(first, second)
})
