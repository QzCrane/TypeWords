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

export type SkillType =
  | 'recognition'
  | 'listening'
  | 'spelling'
  | 'pronunciation'
  | 'sense-discrimination'
  | 'construction'
  | 'collocation'
  | 'zh-to-en-production'
  | 'error-correction'

export interface SourceBook {
  sourceBookId: string
  filename: string
  displayName: string
  category: string
  sourceFamilyId: string
  level: string
  role: string
}

export interface BookMembership {
  sourceBookId: string
  sourceIndex: number
  sourceOriginalId?: string | number
  originalHeadword: string
  decodedHeadword: string
  searchKey: string
  lexicalUnitId: string
  evidenceVariantId: string
  rawPayloadHash: string
}

export interface LexicalUnitProjection {
  lexicalUnitId: string
  identityKey: string
  canonicalForm: string
  displayForm: string
  searchKey: string
  caseProfile: 'normal' | 'acronym'
  sourceDisambiguator?: string
  unitType: string
  parentLexicalUnitId?: string
  userTier: LearningTier
  learningStage: LearningStage
  masteryTarget: string
  priorityScore: number
  preferredVariantId: string
  qualityStatus: string
  sourceBookIds: string[]
  sourceFamilies: string[]
  sourceCategories: string[]
}

export interface PracticeCard {
  cardId: string
  lexicalUnitId: string
  senseId?: string
  skill: SkillType
  prompt: string
  answer: string
  acceptedAnswers?: string[]
  sourceVersion: number
}
