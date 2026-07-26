<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { BasePage, Toast } from '@typewords/base'
import Header from '@typewords/core/components/Header.vue'
import { withAppBaseURL } from '@typewords/core/utils/base-url.ts'
import {
  sourceShardPrefix,
  type LearningSequenceEntry,
  type LexiconRuntimeManifest,
  type LexiconSourceRecord,
} from '@typewords/core/lexicon'

const route = useRoute()
const lexicalUnitId = decodeURIComponent(String(route.params.id ?? ''))
const manifest = ref<LexiconRuntimeManifest | null>(null)
const entry = ref<LearningSequenceEntry | null>(null)
const sourceRecord = ref<(LexiconSourceRecord & { aliases?: string[] }) | null>(null)
const loading = ref(true)

function runtimeUrl(relative: string) {
  return withAppBaseURL(`/typewords_lexicon_v2/runtime/${relative}`)
}

async function findLearningEntry(currentManifest: LexiconRuntimeManifest) {
  for (const stage of Object.keys(currentManifest.stages ?? {})) {
    const response = await fetch(runtimeUrl(`stages/${stage}.json`))
    if (!response.ok) continue
    const payload = await response.json()
    const found = (payload.entries ?? []).find((item: LearningSequenceEntry) => item.lexicalUnitId === lexicalUnitId)
    if (found) return found as LearningSequenceEntry
  }
  return null
}

async function loadDetail() {
  loading.value = true
  try {
    const manifestResponse = await fetch(runtimeUrl('manifest.json'))
    if (!manifestResponse.ok) throw new Error('Lexicon 运行时索引不存在')
    manifest.value = await manifestResponse.json()

    const effectiveId = manifest.value?.aliases?.[lexicalUnitId] ?? lexicalUnitId
    const prefix = sourceShardPrefix(effectiveId, manifest.value?.sourceShardPrefixLength ?? 2)
    const sourceResponse = await fetch(runtimeUrl(`sources/${prefix}.json`))
    if (!sourceResponse.ok) throw new Error(`无法加载来源分片 ${prefix}`)
    const sourcePayload = await sourceResponse.json()
    sourceRecord.value =
      (sourcePayload.records ?? []).find((item: LexiconSourceRecord) => item.lexicalUnitId === effectiveId) ?? null

    entry.value = await findLearningEntry(manifest.value as LexiconRuntimeManifest)
    if (!sourceRecord.value) throw new Error(`未找到实体来源：${effectiveId}`)
  } catch (error: any) {
    Toast.error(error?.message || '加载词汇详情失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)
useHead({ title: sourceRecord.value?.displayForm ? `${sourceRecord.value.displayForm} · Lexicon` : 'Lexicon 详情' })
</script>

<template>
  <BasePage>
    <Header title="Lexicon 实体详情" />

    <div class="mx-auto max-w-5xl space-y-5 pb-12">
      <div v-if="loading" class="py-16 text-center opacity-70">正在按需加载来源分片…</div>

      <template v-else-if="sourceRecord">
        <section class="rounded-xl border border-solid border-gray-300 p-5 dark:border-gray-700">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 class="m-0 text-3xl font-bold">{{ sourceRecord.displayForm }}</h1>
              <div v-if="sourceRecord.canonicalForm !== sourceRecord.displayForm" class="mt-1 opacity-70">
                规范形式：{{ sourceRecord.canonicalForm }}
              </div>
              <code class="mt-2 block text-sm opacity-65">{{ sourceRecord.lexicalUnitId }}</code>
            </div>
            <div v-if="entry" class="rounded-lg border border-solid border-gray-300 px-4 py-3 text-sm dark:border-gray-700">
              <div><b>{{ entry.learningStage }}</b> · {{ entry.userTier }}</div>
              <div class="mt-1">目标：{{ entry.masteryTarget }}</div>
              <div class="mt-1">优先级：{{ entry.priorityScore }}</div>
            </div>
          </div>

          <div v-if="entry" class="mt-5 grid gap-3 md:grid-cols-3">
            <div class="rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
              <div class="text-xs opacity-65">对象类型</div>
              <div class="mt-1 font-medium">{{ entry.unitType }}</div>
            </div>
            <div class="rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
              <div class="text-xs opacity-65">质量状态</div>
              <div class="mt-1 font-medium">{{ entry.qualityStatus }}</div>
            </div>
            <div class="rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
              <div class="text-xs opacity-65">独立来源规模</div>
              <div class="mt-1 font-medium">{{ entry.sourceBookCount }} 本 · {{ entry.sourceFamilyCount }} 家族</div>
            </div>
          </div>

          <div
            v-if="entry && entry.qualityStatus !== 'verified'"
            class="mt-4 rounded-lg border border-solid border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            此处展示的是来源和质量事实，不代表旧词书中的释义、例句、近义词或词源已经获得权威验证。
          </div>

          <div v-if="sourceRecord.aliases?.length" class="mt-4 text-sm">
            已纠正并合并的旧实体：<code>{{ sourceRecord.aliases.join(', ') }}</code>
          </div>
        </section>

        <section class="rounded-xl border border-solid border-gray-300 p-5 dark:border-gray-700">
          <div class="flex items-center justify-between gap-3">
            <h2 class="m-0 text-xl font-bold">具体词书来源</h2>
            <span class="text-sm opacity-70">{{ sourceRecord.sources.length }} 条原始成员关系</span>
          </div>
          <p class="text-sm opacity-70">
            同一正文被多本书复制时仍分别保留书名和原始位置，但不会被当成多份独立语言学证据。
          </p>

          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-sm">
              <thead>
                <tr class="border-b border-solid border-gray-300 text-left dark:border-gray-700">
                  <th class="p-2">词书文件</th>
                  <th class="p-2">书内位置</th>
                  <th class="p-2">原始 ID</th>
                  <th class="p-2">原始词头</th>
                  <th class="p-2">正文变体</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="source in sourceRecord.sources"
                  :key="`${source.sourceBookId}:${source.sourceIndex}:${source.evidenceVariantId}`"
                  class="border-b border-solid border-gray-200 dark:border-gray-800"
                >
                  <td class="p-2 font-medium">{{ source.filename }}</td>
                  <td class="p-2 tabular-nums">{{ source.sourceIndex }}</td>
                  <td class="p-2"><code>{{ source.sourceOriginalId ?? '—' }}</code></td>
                  <td class="p-2">{{ source.originalHeadword }}</td>
                  <td class="p-2"><code>{{ source.evidenceVariantId }}</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="entry?.prerequisiteLexicalUnitIds?.length" class="rounded-xl border border-solid border-gray-300 p-5 dark:border-gray-700">
          <h2 class="m-0 text-xl font-bold">先修实体</h2>
          <div class="mt-3 flex flex-wrap gap-2">
            <NuxtLink
              v-for="prerequisite in entry.prerequisiteLexicalUnitIds"
              :key="prerequisite"
              :to="`/lexicon/${encodeURIComponent(prerequisite)}`"
              class="rounded border border-solid border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
            >
              {{ prerequisite }}
            </NuxtLink>
          </div>
        </section>
      </template>

      <div v-else class="py-16 text-center">没有找到该规范化实体。</div>
    </div>
  </BasePage>
</template>
