import type { Card } from 'ts-fsrs'
import type { Dict, Word } from '../types'
import type { LexiconAwareWord } from './index'

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

function legacyKey(word: string): string {
  return word.trim().normalize('NFKC').toLocaleLowerCase()
}

function lexicalUnitId(word: LexiconAwareWord): string {
  return word.lexicalUnitId || word.lexiconMeta?.lexicalUnitId || `legacy:${legacyKey(word.word)}`
}

function stableSpellingCardKey(word: LexiconAwareWord): string {
  return `${lexicalUnitId(word)}#spelling#${legacyKey(word.word)}`
}

export function practiceEntityKey(word: LexiconAwareWord): string {
  return lexicalUnitId(word)
}

export function spellingCardKey(word: LexiconAwareWord): string {
  if (word.lexicalUnitId || word.lexiconMeta?.lexicalUnitId) return stableSpellingCardKey(word)
  return legacyKey(word.word)
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
    const key = legacyKey(word.word)
    const group = groups.get(key) ?? []
    if (!group.some(item => lexicalUnitId(item) === lexicalUnitId(word))) group.push(word)
    groups.set(key, group)
  }
  return groups
}

function findLegacyCard(fsrsData: Record<string, Card>, word: Word): { key: string; card: Card } | null {
  const candidates = [word.word, legacyKey(word.word)]
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

  for (const [key, group] of groups) {
    const unitIds = [...new Set(group.map(lexicalUnitId))]
    if (unitIds.length !== 1) {
      const conflict: FsrsMigrationConflict = {
        legacyKey: key,
        lexicalUnitIds: unitIds.sort(),
        displayForms: [...new Set(group.map(word => word.word))].sort(),
        reason: 'ambiguous-legacy-word-key',
      }
      migrationState.conflicts[key] = conflict
      conflicts.push(conflict)
      continue
    }

    const word = group[0]
    const stableKey = stableSpellingCardKey(word)
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
  return !!migrationState?.conflicts?.[legacyKey(word.word)]
}

export function resolveFsrsCardEntry(
  fsrsData: Record<string, Card>,
  word: Word,
  migrationState?: FsrsMigrationState
): { key: string; card: Card; legacy: boolean } | null {
  const stableKey = spellingCardKey(word)
  const stableCard = fsrsData[stableKey]
  if (stableCard) return { key: stableKey, card: stableCard, legacy: false }

  if ((word.lexicalUnitId || word.lexiconMeta?.lexicalUnitId) && isLegacyKeyAmbiguous(migrationState, word)) return null

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
