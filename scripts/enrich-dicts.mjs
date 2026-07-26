import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// 读取额外数据
const extraPath = join(root, 'apps', 'nuxt', 'public', 'extra-word-data.json')
let extraMap = {}
try {
  extraMap = JSON.parse(readFileSync(extraPath, 'utf-8'))
  console.log(`✅ 已读取额外数据，共 ${Object.keys(extraMap).length} 个词条\n`)
} catch {
  console.log('⚠️  extra-word-data.json 未找到或为空，仅下载不合并')
}

// 从 CDN 获取索引
const BASE = 'https://files.typewords.cc'
const listUrl = `${BASE}/list/word.json`
const list = await fetch(listUrl).then(r => r.json())
console.log(`📋 词库总数: ${list.length}\n`)

// 保存 CDN 索引到本地（确保格式一致）
const listOut = join(root, 'apps', 'nuxt', 'public', 'list', 'word.json')
writeFileSync(listOut, JSON.stringify(list, null, 2))
console.log(`💾 已保存索引 -> apps/nuxt/public/list/word.json`)

const recommendUrl = `${BASE}/list/recommend_word.json`
const recommend = await fetch(recommendUrl).then(r => r.json())
const recommendOut = join(root, 'apps', 'nuxt', 'public', 'list', 'recommend_word.json')
writeFileSync(recommendOut, JSON.stringify(recommend, null, 2))
console.log(`💾 已保存推荐索引 -> apps/nuxt/public/list/recommend_word.json\n`)

// 逐词库下载、合并、保存
let ok = 0, fail = 0
for (const item of list) {
  const lang = item.language || 'en'
  const url = `${BASE}/dicts/${lang}/word/${item.url}`
  const outPath = join(root, 'apps', 'nuxt', 'public', 'dicts', lang, 'word', item.url)
  mkdirSync(dirname(outPath), { recursive: true })

  try {
    let words = await fetch(url).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })

    // 合并额外数据
    if (Object.keys(extraMap).length) {
      words = words.map(w => ({
        ...w,
        ...(extraMap[w.word] || {}),
      }))
    }

    writeFileSync(outPath, JSON.stringify(words))
    ok++
    console.log(`✅ [${String(ok + fail).padStart(2, '0')}/${list.length}] ${item.name.padEnd(18)} (${item.length}词) -> ${item.url}`)
  } catch (e) {
    fail++
    console.log(`❌ [${String(ok + fail).padStart(2, '0')}/${list.length}] ${item.name.padEnd(18)} 失败: ${e.message}`)
  }
}

console.log(`\n🏁 完成: 成功 ${ok}, 失败 ${fail}`)
