import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLegacyKeyGroups,
  getDefaultFsrsMigrationState,
  migrateLegacySpellingCards,
  practiceEntityKey,
  resolveFsrsCardEntry,
  spellingCardKey,
} from '../packages/core/src/lexicon/card-state.ts'

function card(lastReview, due = lastReview) {
  return {
    due: new Date(due),
    stability: 1,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 1,
    reps: 1,
    lapses: 0,
    state: 1,
    last_review: new Date(lastReview),
  }
}

function word(display, lexicalUnitId) {
  return {
    word: display,
    lexicalUnitId,
    phonetic0: '',
    phonetic1: '',
    trans: [],
    sentences: [],
    phrases: [],
    synos: [],
    relWords: { root: '', rels: [] },
    etymology: [],
  }
}

test('copies one unambiguous legacy spelling card and keeps the rollback key', () => {
  const item = word('divide', 'lu:divide')
  const legacy = card('2026-01-01T00:00:00Z')
  const fsrsData = { divide: legacy }
  const migration = getDefaultFsrsMigrationState()

  const result = migrateLegacySpellingCards(fsrsData, [item], migration)
  const stableKey = spellingCardKey(item)

  assert.equal(result.copied, 1)
  assert.equal(result.updated, 0)
  assert.equal(result.conflicts.length, 0)
  assert.ok(fsrsData.divide)
  assert.deepEqual(fsrsData[stableKey], legacy)
  assert.notEqual(fsrsData[stableKey], legacy)
  assert.equal(migration.copiedLegacyKeys.divide, stableKey)
})

test('does not let stale legacy compatibility data overwrite a newer stable card', () => {
  const item = word('divide', 'lu:divide')
  const stableKey = spellingCardKey(item)
  const stable = card('2026-03-01T00:00:00Z')
  const fsrsData = {
    divide: card('2026-01-01T00:00:00Z'),
    [stableKey]: stable,
  }

  const result = migrateLegacySpellingCards(fsrsData, [item], getDefaultFsrsMigrationState())

  assert.equal(result.copied, 0)
  assert.equal(result.updated, 0)
  assert.equal(result.skippedExisting, 1)
  assert.deepEqual(fsrsData[stableKey], stable)
})

test('mirrors a newer unique legacy card into the stable spelling card', () => {
  const item = word('divide', 'lu:divide')
  const stableKey = spellingCardKey(item)
  const newerLegacy = card('2026-04-01T00:00:00Z')
  const fsrsData = {
    divide: newerLegacy,
    [stableKey]: card('2026-02-01T00:00:00Z'),
  }

  const result = migrateLegacySpellingCards(fsrsData, [item], getDefaultFsrsMigrationState())

  assert.equal(result.updated, 1)
  assert.deepEqual(fsrsData[stableKey], newerLegacy)
  assert.notEqual(fsrsData[stableKey], newerLegacy)
})

test('never guesses one lowercase legacy key across US and us', () => {
  const lower = word('us', 'lu:pronoun-us')
  const upper = word('US', 'lu:country-us')
  const fsrsData = { us: card('2026-01-01T00:00:00Z') }
  const migration = getDefaultFsrsMigrationState()

  const groups = buildLegacyKeyGroups([lower, upper])
  const result = migrateLegacySpellingCards(fsrsData, [lower, upper], migration)

  assert.equal(groups.get('us').length, 2)
  assert.equal(result.copied, 0)
  assert.equal(result.conflicts.length, 1)
  assert.deepEqual(result.conflicts[0].lexicalUnitIds, ['lu:country-us', 'lu:pronoun-us'])
  assert.equal(resolveFsrsCardEntry(fsrsData, lower, migration), null)
  assert.equal(resolveFsrsCardEntry(fsrsData, upper, migration), null)
  assert.equal(fsrsData[spellingCardKey(lower)], undefined)
  assert.equal(fsrsData[spellingCardKey(upper)], undefined)
})

test('stable entity and spelling keys remain distinct across dictionaries and case-sensitive entities', () => {
  const lower = word('us', 'lu:pronoun-us')
  const upper = word('US', 'lu:country-us')

  assert.equal(practiceEntityKey(lower), 'lu:pronoun-us')
  assert.equal(practiceEntityKey(upper), 'lu:country-us')
  assert.notEqual(spellingCardKey(lower), spellingCardKey(upper))
})

test('resolves a stable card before any legacy fallback', () => {
  const item = word('divide', 'lu:divide')
  const stableKey = spellingCardKey(item)
  const stable = card('2026-04-01T00:00:00Z')
  const fsrsData = {
    divide: card('2026-01-01T00:00:00Z'),
    [stableKey]: stable,
  }

  const resolved = resolveFsrsCardEntry(fsrsData, item, getDefaultFsrsMigrationState())

  assert.equal(resolved.key, stableKey)
  assert.equal(resolved.legacy, false)
  assert.deepEqual(resolved.card, stable)
})
