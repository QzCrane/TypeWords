export type LearningTier = 'A1' | 'A2' | 'R1' | 'R2' | 'O' | 'Q'

export type LearningStage =
  | 'S0_foundation_automatic'
  | 'S1_core_automatic'
  | 'S2_general_active'
  | 'S3_academic_technical_active'
  | 'S4_broad_receptive'
  | 'S5_specialized_contextual'
  | 'S6_on_demand'
  | 'Q0_cleanup'

export type MasteryTarget =
  | 'active_automatic'
  | 'active_controlled'
  | 'receptive_fluent'
  | 'receptive_contextual'
  | 'on_demand'
  | 'quarantine'
  | string

export type LexiconSkill =
  | 'recognition'
  | 'listening'
  | 'spelling'
  | 'pronunciation'
  | 'sense-discrimination'
  | 'construction'
  | 'collocation'
  | 'zh-to-en-production'
  | 'error-correction'

export interface LexiconWordMeta {
  schemaVersion: 2
  lexicalUnitId: string
  learningStage: LearningStage
  userTier: LearningTier
  masteryTarget: MasteryTarget
  priorityScore: number
  unitType: string
  qualityStatus: string
  sourceBookCount: number
  sourceFamilyCount: number
  independentStudy: boolean
  canonicalForm?: string
  displayForm?: string
  parentLexicalUnitId?: string
  formOfCanonical?: string
  formRelationType?: string
  prerequisiteLexicalUnitIds?: string[]
}

export interface LexiconAwareWord {
  word: string
  lexicalUnitId?: string
  lexiconMeta?: LexiconWordMeta
}

export interface LearningSequenceEntry extends LexiconWordMeta {
  independentRank: number
  canonicalForm: string
  displayForm: string
  formOfCanonical?: string
  formRelationType?: string
  parentLexicalUnitId?: string
  prerequisiteLexicalUnitIds: string[]
}

export interface LexiconStageResource {
  id: Exclude<LearningStage, 'Q0_cleanup'>
  name: string
  url: string
  length: number
  language: string
  translateLanguage: string
  source: string
}

export interface LexiconSourceMembership {
  sourceBookId: string
  filename: string
  sourceIndex: number
  sourceOriginalId?: string | number
  originalHeadword: string
  evidenceVariantId: string
}

export interface LexiconSourceRecord {
  lexicalUnitId: string
  canonicalForm: string
  displayForm: string
  identityKey: string
  sources: LexiconSourceMembership[]
}

export interface LexiconRuntimeManifest {
  schemaVersion: 2
  generatedAt: string
  sourceHash: string
  sequenceCount: number
  sourceUnitCount: number
  stages: Record<string, number>
  sourceShardPrefixLength: number
}

export interface PracticeCardIdentity {
  cardId: string
  lexicalUnitId: string
  skill: LexiconSkill
  discriminator: string
}

export function buildPracticeCardId(
  lexicalUnitId: string,
  skill: LexiconSkill,
  discriminator = 'core'
): string {
  const safeDiscriminator = discriminator.trim().toLocaleLowerCase() || 'core'
  return `${lexicalUnitId}#${skill}#${safeDiscriminator}`
}

export function buildSpellingCardId(word: LexiconAwareWord): string {
  return buildPracticeCardId(resolveLexicalUnitId(word), 'spelling', normalizeLegacyWordKey(word.word))
}

export function resolveLexicalUnitId(word: LexiconAwareWord): string {
  const explicit = word.lexicalUnitId || word.lexiconMeta?.lexicalUnitId
  if (explicit) return explicit
  return `legacy:${normalizeLegacyWordKey(word.word)}`
}

export function normalizeLegacyWordKey(word: string): string {
  return word.trim().normalize('NFKC').toLocaleLowerCase()
}

/**
 * During migration, spelling cards may inherit an old word-string FSRS card.
 * Other skills must start independently, because spelling success does not
 * prove sense, construction, collocation, pronunciation, or production mastery.
 */
export function getFsrsLookupKeys(word: LexiconAwareWord, skill: LexiconSkill = 'spelling'): string[] {
  const cardId = buildPracticeCardId(
    resolveLexicalUnitId(word),
    skill,
    skill === 'spelling' ? normalizeLegacyWordKey(word.word) : 'core'
  )
  if (skill !== 'spelling') return [cardId]
  return [cardId, word.word, normalizeLegacyWordKey(word.word)]
}

export function attachLexiconMeta<T extends { word: string }>(
  word: T,
  entry: LearningSequenceEntry
): T & LexiconAwareWord {
  return {
    ...word,
    lexicalUnitId: entry.lexicalUnitId,
    lexiconMeta: {
      schemaVersion: 2,
      lexicalUnitId: entry.lexicalUnitId,
      learningStage: entry.learningStage,
      userTier: entry.userTier,
      masteryTarget: entry.masteryTarget,
      priorityScore: entry.priorityScore,
      unitType: entry.unitType,
      qualityStatus: entry.qualityStatus,
      sourceBookCount: entry.sourceBookCount,
      sourceFamilyCount: entry.sourceFamilyCount,
      independentStudy: entry.independentStudy,
      canonicalForm: entry.canonicalForm,
      displayForm: entry.displayForm,
      parentLexicalUnitId: entry.parentLexicalUnitId,
      formOfCanonical: entry.formOfCanonical,
      formRelationType: entry.formRelationType,
      prerequisiteLexicalUnitIds: entry.prerequisiteLexicalUnitIds,
    },
  }
}

export function sourceShardPrefix(lexicalUnitId: string, prefixLength = 2): string {
  const hex = lexicalUnitId.replace(/^lu:/, '')
  return hex.slice(0, prefixLength).padEnd(prefixLength, '0')
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

function parseBoolean(value: string): boolean {
  return value === 'True' || value === 'true' || value === '1'
}

function parseJsonStringArray(value: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return value
      .split('|')
      .map(item => item.trim())
      .filter(Boolean)
  }
}

export function parseLearningSequenceCsv(text: string): LearningSequenceEntry[] {
  const [header = [], ...rows] = parseCsv(text.replace(/^\uFEFF/, ''))
  const indexes = new Map(header.map((name, index) => [name, index]))
  const get = (row: string[], key: string) => row[indexes.get(key) ?? -1] ?? ''

  return rows
    .filter(row => get(row, 'lexicalUnitId'))
    .map(row => ({
      schemaVersion: 2 as const,
      independentRank: Number(get(row, 'independentRank')) || 0,
      learningStage: get(row, 'learningStage') as LearningStage,
      userTier: get(row, 'userTier') as LearningTier,
      masteryTarget: get(row, 'masteryTarget'),
      priorityScore: Number(get(row, 'priorityScore')) || 0,
      canonicalForm: get(row, 'canonicalForm'),
      displayForm: get(row, 'displayForm'),
      unitType: get(row, 'unitType'),
      independentStudy: parseBoolean(get(row, 'independentStudy')),
      formOfCanonical: get(row, 'formOfCanonical') || undefined,
      formRelationType: get(row, 'formRelationType') || undefined,
      parentLexicalUnitId: get(row, 'parentLexicalUnitId') || undefined,
      sourceBookCount: Number(get(row, 'sourceBookCount')) || 0,
      sourceFamilyCount: Number(get(row, 'sourceFamilyCount')) || 0,
      qualityStatus: get(row, 'qualityStatus'),
      lexicalUnitId: get(row, 'lexicalUnitId'),
      prerequisiteLexicalUnitIds: parseJsonStringArray(get(row, 'prerequisiteLexicalUnitIds')),
    }))
}
