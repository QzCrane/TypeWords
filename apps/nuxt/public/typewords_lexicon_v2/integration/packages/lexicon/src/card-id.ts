import type { SkillType } from './types'

export function buildCardId(lexicalUnitId: string, skill: SkillType, discriminator = 'core'): string {
  return `${lexicalUnitId}#${skill}#${discriminator}`
}

export function migrateLegacyFsrsKey(word: string, lexicalUnitId: string): string {
  return buildCardId(lexicalUnitId, 'spelling', word.toLocaleLowerCase())
}
