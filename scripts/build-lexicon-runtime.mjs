import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDir, '..')
const root = path.join(repositoryRoot, 'apps/nuxt/public/typewords_lexicon_v2')
const sequencePath = path.join(root, 'learning_sequence.csv')
const sourcesPath = path.join(root, 'sources_by_unit.jsonl')
const correctionsPath = path.join(root, 'corrections.v1.json')
const outputRoot = path.join(root, 'runtime')
const stagesRoot = path.join(outputRoot, 'stages')
const sourcesRoot = path.join(outputRoot, 'sources')
const importRoot = path.join(root, 'typewords_import')
const prefixLength = 2

const stageDisplayNames = {
  S0_foundation_automatic: 'S0 基础自动化',
  S1_core_automatic: 'S1 主动核心',
  S2_general_active: 'S2 通用主动扩展',
  S3_academic_technical_active: 'S3 学术与技术主动词',
  S4_broad_receptive: 'S4 广泛流畅识别',
  S5_specialized_contextual: 'S5 专项语境识别',
  S6_on_demand: 'S6 按需学习',
}

for (const required of [sequencePath, sourcesPath]) {
  if (!fs.existsSync(required)) throw new Error(`[lexicon-runtime] Missing required file: ${required}`)
}

function sha256File(filename) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filename))
  return hash.digest('hex')
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }

    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

function parseArray(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return value
      .split(/[;|]/)
      .map(item => item.trim())
      .filter(Boolean)
  }
}

function readCorrections() {
  if (!fs.existsSync(correctionsPath)) return { unitOverrides: {} }
  const parsed = JSON.parse(fs.readFileSync(correctionsPath, 'utf8'))
  return { unitOverrides: parsed.unitOverrides ?? {} }
}

function effectiveUnitId(unitId, overrides) {
  const override = overrides[unitId]
  return override?.action === 'alias' && override.targetLexicalUnitId ? override.targetLexicalUnitId : unitId
}

function sourcePrefix(unitId) {
  return unitId.replace(/^lu:/, '').slice(0, prefixLength).padEnd(prefixLength, '0')
}

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(stagesRoot, { recursive: true })
fs.mkdirSync(sourcesRoot, { recursive: true })
fs.mkdirSync(importRoot, { recursive: true })

const { unitOverrides } = readCorrections()
const aliases = Object.fromEntries(
  Object.entries(unitOverrides)
    .filter(([, value]) => value?.action === 'alias' && value.targetLexicalUnitId)
    .map(([source, value]) => [source, value.targetLexicalUnitId])
)

const sequenceText = fs.readFileSync(sequencePath, 'utf8').replace(/^\uFEFF/, '')
const [header = [], ...dataRows] = parseCsv(sequenceText)
const indexes = new Map(header.map((name, index) => [name, index]))
const get = (row, key) => row[indexes.get(key) ?? -1] ?? ''
const stageEntries = new Map()
const unitsById = new Map()

for (const row of dataRows) {
  const rawUnitId = get(row, 'lexicalUnitId')
  if (!rawUnitId || aliases[rawUnitId]) continue

  const entry = {
    lexicalUnitId: rawUnitId,
    independentRank: Number(get(row, 'independentRank')) || 0,
    learningStage: get(row, 'learningStage'),
    userTier: get(row, 'userTier'),
    masteryTarget: get(row, 'masteryTarget'),
    priorityScore: Number(get(row, 'priorityScore')) || 0,
    canonicalForm: get(row, 'canonicalForm'),
    displayForm: get(row, 'displayForm'),
    unitType: get(row, 'unitType'),
    independentStudy: /^(true|1)$/i.test(get(row, 'independentStudy')),
    formOfCanonical: get(row, 'formOfCanonical') || undefined,
    formRelationType: get(row, 'formRelationType') || undefined,
    parentLexicalUnitId: get(row, 'parentLexicalUnitId') || undefined,
    sourceBookCount: Number(get(row, 'sourceBookCount')) || 0,
    sourceFamilyCount: Number(get(row, 'sourceFamilyCount')) || 0,
    qualityStatus: get(row, 'qualityStatus'),
    prerequisiteLexicalUnitIds: parseArray(get(row, 'prerequisiteLexicalUnitIds')),
  }

  unitsById.set(rawUnitId, entry)
  if (!entry.independentStudy || entry.learningStage === 'Q0_cleanup') continue
  if (/[\r\n\u0000]/.test(entry.displayForm)) {
    throw new Error(`[lexicon-runtime] Uncorrected control character in ${entry.lexicalUnitId}: ${JSON.stringify(entry.displayForm)}`)
  }
  const entries = stageEntries.get(entry.learningStage) ?? []
  entries.push(entry)
  stageEntries.set(entry.learningStage, entries)
}

const catalog = []
for (const [stage, entries] of stageEntries) {
  entries.sort((a, b) => a.independentRank - b.independentRank || b.priorityScore - a.priorityScore)
  fs.writeFileSync(
    path.join(stagesRoot, `${stage}.json`),
    JSON.stringify({ schemaVersion: 2, stage, count: entries.length, entries })
  )

  fs.writeFileSync(path.join(importRoot, `${stage}.txt`), `${entries.map(entry => entry.displayForm).join('\n')}\n`)
  catalog.push({
    id: stage,
    name: stageDisplayNames[stage] ?? stage,
    url: `${stage}.txt`,
    runtimeUrl: `../runtime/stages/${stage}.json`,
    length: entries.length,
    language: 'en',
    translateLanguage: 'zh-CN',
    source: 'typewords-lexicon-v2',
  })
}

catalog.sort((a, b) => a.id.localeCompare(b.id))
fs.writeFileSync(path.join(importRoot, 'catalog.json'), JSON.stringify(catalog, null, 2))

const sourceRecords = new Map()
const input = fs.createReadStream(sourcesPath, { encoding: 'utf8' })
const lines = readline.createInterface({ input, crlfDelay: Infinity })
let rawSourceUnitCount = 0

for await (const line of lines) {
  if (!line.trim()) continue
  const raw = JSON.parse(line)
  rawSourceUnitCount++
  const rawUnitId = String(raw.lexicalUnitId)
  const unitId = effectiveUnitId(rawUnitId, unitOverrides)
  const existing = sourceRecords.get(unitId) ?? {
    lexicalUnitId: unitId,
    identityKey: raw.identityKey,
    canonicalForm: raw.canonicalForm,
    displayForm: raw.displayForm,
    aliases: [],
    sources: [],
  }

  if (rawUnitId !== unitId && !existing.aliases.includes(rawUnitId)) existing.aliases.push(rawUnitId)
  if (rawUnitId === unitId) {
    existing.identityKey = raw.identityKey
    existing.canonicalForm = raw.canonicalForm
    existing.displayForm = raw.displayForm
  }

  existing.sources.push(...(Array.isArray(raw.sources) ? raw.sources : []))
  sourceRecords.set(unitId, existing)
}

const shards = new Map()
for (const record of sourceRecords.values()) {
  const dedupe = new Map()
  for (const source of record.sources) {
    const key = [
      source.sourceBookId,
      source.sourceIndex,
      source.sourceOriginalId ?? '',
      source.originalHeadword,
      source.evidenceVariantId,
    ].join('|')
    dedupe.set(key, source)
  }
  record.sources = [...dedupe.values()].sort(
    (a, b) => String(a.filename).localeCompare(String(b.filename)) || Number(a.sourceIndex) - Number(b.sourceIndex)
  )
  const prefix = sourcePrefix(record.lexicalUnitId)
  const records = shards.get(prefix) ?? []
  records.push(record)
  shards.set(prefix, records)
}

for (const [prefix, records] of shards) {
  records.sort((a, b) => a.lexicalUnitId.localeCompare(b.lexicalUnitId))
  fs.writeFileSync(
    path.join(sourcesRoot, `${prefix}.json`),
    JSON.stringify({ schemaVersion: 2, prefix, count: records.length, records })
  )
}

const stages = Object.fromEntries([...stageEntries].map(([stage, entries]) => [stage, entries.length]))
const sourceHash = createHash('sha256')
  .update(sha256File(sequencePath))
  .update(sha256File(sourcesPath))
  .update(fs.existsSync(correctionsPath) ? sha256File(correctionsPath) : '')
  .digest('hex')

const manifest = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sourceHash,
  sequenceCount: unitsById.size,
  rawSourceUnitCount,
  sourceUnitCount: sourceRecords.size,
  stages,
  sourceShardPrefixLength: prefixLength,
  sourceShardCount: shards.size,
  aliases,
}

fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(
  `[lexicon-runtime] Built ${Object.values(stages).reduce((sum, count) => sum + count, 0)} study units, ` +
    `${sourceRecords.size} source records, and ${shards.size} lazy source shards.`
)
