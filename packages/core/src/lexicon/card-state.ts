import type { Card } from 'ts-fsrs'
import type { Dict, Word } from '../types'
import {
  buildSpellingCardId,
  normalizeLegacyWordKey,
  resolveLexicalUnitId,
  type LexiconAwareWord,
} from './index'

export const FSRS_CARD_STATE_VERSION = 2

export interface FsrsMigrationConflict {
  legacyKey: string
  lexicalUnitIds: string[]
  displayForms: string[]
  reason: 'ambiguous-legacy-word-key'
}

export interface FsrsMigrationState {
  version: typeof FSRS_CARD_STATE_VERSION
  copiedLegacyKeys: Record<string, string>
  conflicts: Record<string, FsrsMigrationConflict>
  lastRunAt?: number
}

export interface FsrsMigrationResult {
  copied: number
  skippedExisting: number
  conflicts: FsrsMigrationConflict[]
}

export function getDefaultFsrsMigrationState(): FsrsMigrationState {
  return {
    version: FSRS_CARD_STATE_VERSION,
    copiedLegacyKeys: {},
    conflicts: {},
  }
}

export function practiceEntityKey(word: LexiconAwareWord): string {
  return word.lexicalUnitId || word.lexiconMeta?.lexicalUnitId || `legacy:${normalizeLegacyWordKey(word.word)}`
}

export function spellingCardKey(word: LexiconAwareWord): string {
  if (word.lexicalUnitId || word.lexiconMeta?.lexicalUnitId) return buildSpellingCardId(word)
  return normalizeLegacyWordKey(word.word)
}

export function collectLexiconWords(bookList: Dict[]): Word[] {
  const byUnitId = new Map<string, Word>()
  for (const dict of bookList ?? []) {
    for (const word of dict.words ?? []) {
      const unitId = word.lexicalUnitId || word.lexiconMeta?.lexicalUnitId
      if (unitId && !byUnitId.has(unitId)) byUnitId.set(unitId, word)
    }
  }
  return [...byUnitId.values()]
}

export function buildLegacyKeyGroups(words: Word[]): Map<string, Word[]> {
  const groups = new Map<string, Word[]>()
  for (const word of words) {
    const legacyKey = normalizeLegacyWordKey(word.word)
    const group = groups.get(legacyKey) ?? []
    if (!group.some(item => resolveLexicalUnitId(item) === resolveLexicalUnitId(word))) group.push(word)
    groups.set(legacyKey, group)
  }
  return groups
}

function findLegacyCard(fsrsData: Record<string, Card>, word: Word): { key: string; card: Card } | null {
  const candidates = [word.word, normalizeLegacyWordKey(word.word)]
  for (const key of candidates) {
    const card = fsrsData[key]
    if (card) return { key, card }
  }
  return null
}

/**
 * Copies unambiguous legacy word-string cards into stable spelling-card IDs.
 * Legacy cards are intentionally retained for old dictionaries and rollback.
 * Ambiguous lowercase keys (for example US/us) are never guessed.
 */
export function migrateLegacySpellingCards(
  fsrsData: Record<string, Card>,
  words: Word[],
  migrationState: FsrsMigrationState = getDefaultFsrsMigrationState()
): FsrsMigrationResult {
  const groups = buildLegacyKeyGroups(words)
  const conflicts: FsrsMigrationConflict[] = []
  let copied = 0
  let skippedExisting = 0

  migrationState.version = FSRS_CARD_STATE_VERSION
  migrationState.conflicts = {}

  for (const [legacyKey, group] of groups) {
    const unitIds = [...new Set(group.map(resolveLexicalUnitId))]
    if (unitIds.length !== 1) {
      const conflict: FsrsMigrationConflict = {
        legacyKey,
        lexicalUnitIds: unitIds.sort(),
        displayForms: [...new Set(group.map(word => word.word))].sort(),
        reason: 'ambiguous-legacy-word-key',
      }
      migrationState.conflicts[legacyKey] = conflict
      conflicts.push(conflict)
      continue
    }

    const word = group[0]
    const stableKey = buildSpellingCardId(word)
    if (fsrsData[stableKey]) {
      skippedExisting++
      continue
    }

    const legacy = findLegacyCard(fsrsData, word)
    if (!legacy) continue
    fsrsData[stableKey] = { ...legacy.card }
    migrationState.copiedLegacyKeys[legacy.key] = stableKey
    copied++
  }

  migrationState.lastRunAt = Date.now()
  return { copied, skippedExisting, conflicts }
}

export function migrateBookListSpellingCards(
  fsrsData: Record<string, Card>,
  bookList: Dict[],
  migrationState: FsrsMigrationState
): FsrsMigrationResult {
  return migrateLegacySpellingCards(fsrsData, collectLexiconWords(bookList), migrationState)
}

export function isLegacyKeyAmbiguous(migrationState: FsrsMigrationState | undefined, word: Word): boolean {
  const legacyKey = normalizeLegacyWordKey(word.word)
  return !!migrationState?.conflicts?.[legacyKey]
}

export function resolveFsrsCardEntry(
  fsrsData: Record<string, Card>,
  word: Word,
  migrationState?: FsrsMigrationState
): { key: string; card: Card; legacy: boolean } | null {
  const stableKey = spellingCardKey(word)
  const stableCard = fsrsData[stableKey]
  if (stableCard) return { key: stableKey, card: stableCard, legacy: false }

  if (word.lexicalUnitId || word.lexiconMeta?.lexicalUnitId) {
    if (isLegacyKeyAmbiguous(migrationState, word)) return null
  }

  const legacy = findLegacyCard(fsrsData, word)
  return legacy ? { key: legacy.key, card: legacy.card, legacy: true } : null
}

export function hasFsrsCard(
  fsrsData: Record<string, Card>,
  word: Word,
  migrationState?: FsrsMigrationState
): boolean {
  return !!resolveFsrsCardEntry(fsrsData, word, migrationState)
}
