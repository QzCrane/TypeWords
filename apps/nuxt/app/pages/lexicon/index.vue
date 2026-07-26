<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BasePage, Toast } from '@typewords/base'
import Header from '@typewords/core/components/Header.vue'
import { addDict } from '@typewords/core/apis'
import { getWordList } from '@typewords/core/apis/words.ts'
import { AppEnv } from '@typewords/core/config/env.ts'
import { useBaseStore } from '@typewords/core/stores/base.ts'
import { useRuntimeStore } from '@typewords/core/stores/runtime.ts'
import { getDefaultDict, getDefaultWord } from '@typewords/core/types/func.ts'
import type { Dict, Word } from '@typewords/core/types/types.ts'
import { cloneDeep } from '@typewords/core/utils'
import { withAppBaseURL } from '@typewords/core/utils/base-url.ts'
import {
  attachLexiconMeta,
  type LearningSequenceEntry,
  type LearningStage,
  type LexiconRuntimeManifest,
} from '@typewords/core/lexicon'

const router = useRouter()
const store = useBaseStore()
const runtimeStore = useRuntimeStore()

const stageOrder: Exclude<LearningStage, 'Q0_cleanup'>[] = [
  'S0_foundation_automatic',
  'S1_core_automatic',
  'S2_general_active',
  'S3_academic_technical_active',
  'S4_broad_receptive',
  'S5_specialized_contextual',
  'S6_on_demand',
]

const stageLabels: Record<string, string> = {
  S0_foundation_automatic: 'S0 基础自动化',
  S1_core_automatic: 'S1 主动核心',
  S2_general_active: 'S2 通用主动扩展',
  S3_academic_technical_active: 'S3 学术与技术主动词',
  S4_broad_receptive: 'S4 广泛流畅识别',
  S5_specialized_contextual: 'S5 专项语境识别',
  S6_on_demand: 'S6 按需学习',
}

const stageDescriptions: Record<string, string> = {
  S0_foundation_automatic: '最强通用支持，目标是听说读写自动调用。',
  S1_core_automatic: '主动核心和多义基础词，要求准确产出。',
  S2_general_active: '通用扩展、常用搭配和多词表达。',
  S3_academic_technical_active: '学术、计算机、AI 与工程方向主动词。',
  S4_broad_receptive: '阅读和听力中快速识别，不强求全部自由产出。',
  S5_specialized_contextual: '考试、领域和低频表达，依赖具体语境。',
  S6_on_demand: '真实任务触发后再学，不进入日常主队列。',
}

const manifest = ref<LexiconRuntimeManifest | null>(null)
const selectedStage = ref<Exclude<LearningStage, 'Q0_cleanup'>>('S0_foundation_automatic')
const entries = ref<LearningSequenceEntry[]>([])
const loading = ref(false)
const importing = ref(false)
const importProgress = ref({ completed: 0, total: 0 })
const searchText = ref('')
const visibleLimit = ref(200)

const filteredEntries = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase()
  const source = query
    ? entries.value.filter(entry =>
        [entry.displayForm, entry.canonicalForm, entry.lexicalUnitId, entry.unitType, entry.qualityStatus]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)
      )
    : entries.value
  return source.slice(0, visibleLimit.value)
})

const selectedCount = computed(() => manifest.value?.stages?.[selectedStage.value] ?? entries.value.length)
const progressPercent = computed(() => {
  if (!importProgress.value.total) return 0
  return Math.round((importProgress.value.completed / importProgress.value.total) * 100)
})

function runtimeUrl(relative: string) {
  return withAppBaseURL(`/typewords_lexicon_v2/runtime/${relative}`)
}

async function loadManifest() {
  const response = await fetch(runtimeUrl('manifest.json'))
  if (!response.ok) throw new Error('Lexicon 运行时索引不存在，请先执行 pnpm lexicon:runtime')
  manifest.value = await response.json()
}

async function loadStage(stage: Exclude<LearningStage, 'Q0_cleanup'>) {
  selectedStage.value = stage
  loading.value = true
  visibleLimit.value = 200
  searchText.value = ''
  try {
    const response = await fetch(runtimeUrl(`stages/${stage}.json`))
    if (!response.ok) throw new Error(`无法加载 ${stage}`)
    const payload = await response.json()
    entries.value = payload.entries ?? []
  } catch (error: any) {
    entries.value = []
    Toast.error(error?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function normalizeWordKey(word: string) {
  return word.trim().normalize('NFKC').toLocaleLowerCase()
}

async function resolveChunk(chunk: LearningSequenceEntry[]): Promise<Word[]> {
  const requested = chunk.map(entry => entry.displayForm.trim())
  const response = await getWordList(null, requested)
  if (!response.success) throw new Error(response.msg || '词条查询失败')

  const { list = [], missing = [] } = (response.data ?? {}) as { list: any[]; missing: string[] }
  const missingSet = new Set(missing.map(normalizeWordKey))

  return chunk.map((entry, index) => {
    const item = list[index]
    const requestedWord = requested[index]
    const found = item?.word && !missingSet.has(normalizeWordKey(requestedWord))
    const baseWord = found
      ? getDefaultWord({ ...item, id: item.id, custom: !item.trans?.length })
      : getDefaultWord({ word: requestedWord, custom: true })
    return attachLexiconMeta(baseWord, entry)
  })
}

function findExistingStageDict(stage: string) {
  const sourceId = `typewords-lexicon-v2:${stage}`
  return store.word.bookList.findIndex(dict => dict.sourceId === sourceId || dict.enName === sourceId)
}

async function openExisting(index: number) {
  store.word.studyIndex = index
  runtimeStore.editDict = cloneDeep(store.word.bookList[index])
  await router.push('/dict')
}

async function importSelectedStage() {
  if (!entries.value.length || importing.value) return

  const existingIndex = findExistingStageDict(selectedStage.value)
  if (existingIndex >= 0) {
    await openExisting(existingIndex)
    return
  }

  importing.value = true
  importProgress.value = { completed: 0, total: entries.value.length }
  try {
    const sourceId = `typewords-lexicon-v2:${selectedStage.value}`
    let dict: Dict = getDefaultDict({
      id: `local-${sourceId}-${Date.now()}`,
      enName: sourceId,
      sourceId,
      name: stageLabels[selectedStage.value],
      description: stageDescriptions[selectedStage.value],
      category: 'Lexicon v2',
      tags: ['归一化词库', selectedStage.value],
      translateLanguage: 'zh-CN',
      language: 'en',
      custom: true,
      perDayStudyNumber: 20,
    })

    if (AppEnv.CAN_REQUEST) {
      const createResponse = await addDict(null, dict)
      if (!createResponse.success) throw new Error(createResponse.msg || '创建词典失败')
      dict = getDefaultDict({ ...dict, ...createResponse.data, custom: true, sourceId, enName: sourceId })
    }

    const resolvedWords: Word[] = []
    const chunkSize = 400
    for (let start = 0; start < entries.value.length; start += chunkSize) {
      const chunk = entries.value.slice(start, start + chunkSize)
      resolvedWords.push(...(await resolveChunk(chunk)))
      importProgress.value.completed = Math.min(start + chunk.length, entries.value.length)
    }

    dict.words = resolvedWords
    dict.length = resolvedWords.length
    dict.lastLearnIndex = 0
    dict.complete = false

    store.word.bookList.push(dict)
    store.word.studyIndex = store.word.bookList.length - 1
    runtimeStore.editDict = cloneDeep(dict)
    Toast.success(`已导入 ${resolvedWords.length} 个学习单位`)
    await router.push('/dict')
  } catch (error: any) {
    Toast.error(error?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

function openUnit(entry: LearningSequenceEntry) {
  router.push(`/lexicon/${encodeURIComponent(entry.lexicalUnitId)}`)
}

onMounted(async () => {
  try {
    await loadManifest()
    await loadStage(selectedStage.value)
  } catch (error: any) {
    Toast.error(error?.message || 'Lexicon 初始化失败')
  }
})

useHead({ title: 'Lexicon v2 学习顺序' })
</script>

<template>
  <BasePage>
    <Header title="Lexicon v2 学习顺序" />

    <div class="mx-auto max-w-6xl space-y-5 pb-12">
      <section class="rounded-xl border border-solid border-gray-300 p-4 dark:border-gray-700">
        <div class="text-lg font-bold">不是把 3.2 万项全部背到同一深度</div>
        <div class="mt-2 text-sm opacity-75">
          主动层先完成 S0–S3；S4–S5 以识别为主；S6 只在真实任务触发时进入学习。
          每个导入词都会保留稳定实体 ID、学习层级、质量状态与来源规模。
        </div>
        <div v-if="manifest" class="mt-3 text-sm">
          运行时来源哈希：<code>{{ manifest.sourceHash.slice(0, 16) }}</code> · 来源实体：{{
            manifest.sourceUnitCount
          }}
        </div>
      </section>

      <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <button
          v-for="stage in stageOrder"
          :key="stage"
          class="rounded-xl border border-solid p-3 text-left transition hover:-translate-y-0.5"
          :class="selectedStage === stage ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-gray-300 dark:border-gray-700'"
          @click="loadStage(stage)"
        >
          <div class="font-bold">{{ stageLabels[stage] }}</div>
          <div class="mt-1 text-xs opacity-70">{{ manifest?.stages?.[stage] ?? 0 }} 项</div>
          <div class="mt-2 text-sm opacity-80">{{ stageDescriptions[stage] }}</div>
        </button>
      </section>

      <section class="rounded-xl border border-solid border-gray-300 p-4 dark:border-gray-700">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-lg font-bold">{{ stageLabels[selectedStage] }}</div>
            <div class="text-sm opacity-70">{{ selectedCount }} 个独立学习单位</div>
          </div>
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="loading || importing || !entries.length"
            @click="importSelectedStage"
          >
            {{ importing ? `导入中 ${progressPercent}%` : '一键导入到 TypeWords' }}
          </button>
        </div>

        <div v-if="importing" class="mt-3 h-2 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
          <div class="h-full bg-blue-600 transition-all" :style="{ width: `${progressPercent}%` }" />
        </div>

        <input
          v-model="searchText"
          class="mt-4 w-full rounded-lg border border-solid border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
          placeholder="搜索词、实体 ID、类型或质量状态"
        />

        <div v-if="loading" class="py-10 text-center opacity-70">正在加载阶段索引…</div>
        <div v-else class="mt-4 overflow-x-auto">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="border-b border-solid border-gray-300 text-left dark:border-gray-700">
                <th class="p-2">顺序</th>
                <th class="p-2">词/表达</th>
                <th class="p-2">目标</th>
                <th class="p-2">类型</th>
                <th class="p-2">来源</th>
                <th class="p-2">质量</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in filteredEntries"
                :key="entry.lexicalUnitId"
                class="cursor-pointer border-b border-solid border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                @click="openUnit(entry)"
              >
                <td class="p-2 tabular-nums">{{ entry.independentRank }}</td>
                <td class="p-2">
                  <div class="font-medium">{{ entry.displayForm }}</div>
                  <code class="text-xs opacity-60">{{ entry.lexicalUnitId }}</code>
                </td>
                <td class="p-2">{{ entry.userTier }} · {{ entry.masteryTarget }}</td>
                <td class="p-2">{{ entry.unitType }}</td>
                <td class="p-2">{{ entry.sourceBookCount }} 本 / {{ entry.sourceFamilyCount }} 家族</td>
                <td class="p-2">{{ entry.qualityStatus }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <button
          v-if="filteredEntries.length < entries.length"
          class="mt-4 w-full rounded-lg border border-solid border-gray-300 py-2 dark:border-gray-700"
          @click="visibleLimit += 500"
        >
          再显示 500 项
        </button>
      </section>
    </div>
  </BasePage>
</template>
