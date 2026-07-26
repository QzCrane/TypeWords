import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('apps/nuxt/public/typewords_lexicon_v2')
const sequencePath = path.join(root, 'learning_sequence.csv')
const sourcesPath = path.join(root, 'sources_by_unit.jsonl')
const correctionsPath = path.join(root, 'corrections.v1.json')
const catalogPath = path.join(root, 'typewords_import/catalog.json')
const runtimeManifestPath = path.join(root, 'runtime/manifest.json')

function fail(message) {
  throw new Error(`[lexicon-validate] ${message}`)
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

for (const required of [sequencePath, sourcesPath, correctionsPath, catalogPath, runtimeManifestPath]) {
  if (!fs.existsSync(required)) fail(`Missing required generated or source file: ${required}`)
}

const corrections = JSON.parse(fs.readFileSync(correctionsPath, 'utf8'))
const aliases = Object.fromEntries(
  Object.entries(corrections.unitOverrides ?? {})
    .filter(([, value]) => value?.action === 'alias' && value.targetLexicalUnitId)
    .map(([source, value]) => [source, value.targetLexicalUnitId])
)

const [header = [], ...rows] = parseCsv(fs.readFileSync(sequencePath, 'utf8').replace(/^\uFEFF/, ''))
const indexes = new Map(header.map((name, index) => [name, index]))
const get = (row, key) => row[indexes.get(key) ?? -1] ?? ''
const effectiveStageCounts = new Map()
const seenUnits = new Set()
let sourceSequenceCount = 0

for (const row of rows) {
  const unitId = get(row, 'lexicalUnitId')
  if (!unitId) continue
  sourceSequenceCount++
  if (seenUnits.has(unitId)) fail(`Duplicate lexicalUnitId in learning sequence: ${unitId}`)
  seenUnits.add(unitId)

  const displayForm = get(row, 'displayForm')
  const independent = /^(true|1)$/i.test(get(row, 'independentStudy'))
  const stage = get(row, 'learningStage')
  if (independent && !aliases[unitId] && /[\r\n\u0000]/.test(displayForm)) {
    fail(`Independent unit contains a control character: ${unitId} ${JSON.stringify(displayForm)}`)
  }
  if (independent && !aliases[unitId] && stage !== 'Q0_cleanup') {
    effectiveStageCounts.set(stage, (effectiveStageCounts.get(stage) ?? 0) + 1)
  }
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
const catalogIds = new Set()
for (const item of catalog) {
  if (catalogIds.has(item.id)) fail(`Duplicate catalog stage: ${item.id}`)
  catalogIds.add(item.id)
  const expected = effectiveStageCounts.get(item.id) ?? 0
  if (Number(item.length) !== expected) fail(`Catalog count mismatch for ${item.id}: ${item.length} != ${expected}`)

  const txtPath = path.join(root, 'typewords_import', item.url)
  if (!fs.existsSync(txtPath)) fail(`Missing stage text export: ${txtPath}`)
  const lines = fs
    .readFileSync(txtPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
  if (lines.length !== expected) fail(`Text export count mismatch for ${item.id}: ${lines.length} != ${expected}`)
  if (lines.some(line => line === 'n')) fail(`Standalone POS marker leaked into ${item.id}`)
}

for (const [stage, count] of effectiveStageCounts) {
  if (!catalogIds.has(stage)) fail(`Stage is missing from catalog: ${stage} (${count})`)
}

const manifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'))
if (manifest.schemaVersion !== 2) fail(`Unsupported runtime schemaVersion: ${manifest.schemaVersion}`)
for (const [stage, count] of effectiveStageCounts) {
  if (Number(manifest.stages?.[stage]) !== count) {
    fail(`Runtime manifest count mismatch for ${stage}: ${manifest.stages?.[stage]} != ${count}`)
  }
  const stagePath = path.join(root, 'runtime/stages', `${stage}.json`)
  if (!fs.existsSync(stagePath)) fail(`Missing runtime stage: ${stagePath}`)
  const stagePayload = JSON.parse(fs.readFileSync(stagePath, 'utf8'))
  if (stagePayload.count !== count || stagePayload.entries?.length !== count) {
    fail(`Runtime stage payload mismatch for ${stage}`)
  }
}

const sourceLineCount = fs
  .readFileSync(sourcesPath, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean).length
if (sourceLineCount !== sourceSequenceCount) {
  fail(`Source index and learning sequence disagree: ${sourceLineCount} != ${sourceSequenceCount}`)
}
if (manifest.rawSourceUnitCount !== sourceLineCount) {
  fail(`Runtime rawSourceUnitCount mismatch: ${manifest.rawSourceUnitCount} != ${sourceLineCount}`)
}
if (manifest.sourceUnitCount !== sourceLineCount - Object.keys(aliases).length) {
  fail(
    `Runtime sourceUnitCount mismatch after aliases: ${manifest.sourceUnitCount} != ${
      sourceLineCount - Object.keys(aliases).length
    }`
  )
}

console.log(
  `[lexicon-validate] OK: ${sourceSequenceCount} source units, ${[...effectiveStageCounts.values()].reduce(
    (sum, count) => sum + count,
    0
  )} independent study units, ${Object.keys(aliases).length} traceable aliases.`
)
