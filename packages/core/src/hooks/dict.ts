import type { Article, Dict, TaskWords, Word } from '../types'
import { DictType, getDefaultDict, getDefaultWord } from '../types'
import { useBaseStore } from '../stores/base.ts'
import { useSettingStore } from '../stores/setting.ts'
import { _getDictDataByUrl, cloneDeep, getRandomN, isDictIdMatch, resourceWrap, shuffle, splitIntoN } from '../utils'
import { onMounted, watch } from 'vue'
import { AppEnv, DICT_LIST, DictId } from '../config/env.ts'
import { addDict, detail } from '../apis'
import { useRuntimeStore } from '../stores/runtime.ts'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { computed } from 'vue'
import { hasFsrsCard, practiceEntityKey, resolveFsrsCardEntry } from '../lexicon'

export function useWordOptions() {
  const store = useBaseStore()
  const sameWordEntity = (left: Word, right: Word) => practiceEntityKey(left) === practiceEntityKey(right)

  function isWordCollect(val: Word) {
    return !!store.collectWord.words.find(v => sameWordEntity(v, val))
  }

  function toggleWordCollect(val: Word) {
    let rIndex = store.collectWord.words.findIndex(v => sameWordEntity(v, val))
    if (rIndex > -1) {
      store.collectWord.words.splice(rIndex, 1)
    } else {
      store.collectWord.words.push(val)
    }
    store.collectWord.length = store.collectWord.words.length
  }

  function isWordSimple(val: Word) {
    return store.knownEntityKeysSet.has(practiceEntityKey(val))
  }

  function toggleWordSimple(val: Word) {
    let rIndex = store.known.words.findIndex(v => sameWordEntity(v, val))
    if (rIndex > -1) {
      store.known.words.splice(rIndex, 1)
    } else {
      store.known.words.push(val)
    }
    store.known.length = store.known.words.length
  }

  function delWrongWord(val: Word) {
    let rIndex = store.wrong.words.findIndex(v => sameWordEntity(v, val))
    if (rIndex > -1) {
      store.wrong.words.splice(rIndex, 1)
    }
    store.wrong.length = store.wrong.words.length
  }

  function delSimpleWord(val: Word) {
    let rIndex = store.known.words.findIndex(v => sameWordEntity(v, val))
    if (rIndex > -1) {
      store.known.words.splice(rIndex, 1)
    }
    store.known.length = store.known.words.length
  }

  function getCollectibleDicts(excludeDictId?: string) {
    return store.word.bookList.filter(dict => {
      if (dict.id !== DictId.wordCollect && !dict.custom) return false
      if (excludeDictId && isDictIdMatch(dict, excludeDictId)) return false
      return true
    })
  }

  function resolveDictInBookList(dict: Dict) {
    return store.word.bookList.find(d => isDictIdMatch(d, dict.id)) ?? dict
  }

  function addWordToDict(val: Word, dict: Dict): { ok: boolean } {
    const target = resolveDictInBookList(dict)
    const rIndex = target.words.findIndex(v => sameWordEntity(v, val))
    if (rIndex > -1) return { ok: false }
    target.words.push(val)
    target.length = target.words.length
    return { ok: true }
  }

  async function createCustomDict(name: string): Promise<{ ok: true; dict: Dict } | { ok: false; reason: 'empty' | 'duplicate' | 'api' }> {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, reason: 'empty' }
    if (store.word.bookList.find(v => v.name === trimmed)) {
      return { ok: false, reason: 'duplicate' }
    }
    let data: Dict = getDefaultDict({
      name: trimmed,
      id: 'custom-dict-' + Date.now(),
      custom: true,
    })
    data.type = DictType.word
    if (AppEnv.CAN_REQUEST) {
      const res = await addDict(null, data)
      if (!res.success) return { ok: false, reason: 'api' }
      data = getDefaultDict(res.data)
    }
    store.word.bookList.push(cloneDeep(data))
    return { ok: true, dict: data }
  }

  return {
    isWordCollect,
    toggleWordCollect,
    getCollectibleDicts,
    addWordToDict,
    createCustomDict,
    isWordSimple,
    toggleWordSimple,
    delWrongWord,
    delSimpleWord,
  }
}

export function useArticleOptions() {
  const store = useBaseStore()

  function isArticleCollect(val: Article) {
    return !!store.collectArticle?.articles?.find(v => v.id === val.id)
  }

  //todo 这里先收藏，再修改。收藏里面的未同步。单词也是一样的
  function toggleArticleCollect(val: Article) {
    let rIndex = store.collectArticle.articles.findIndex(v => v.id === val.id)
    if (rIndex > -1) {
      store.collectArticle.articles.splice(rIndex, 1)
    } else {
      store.collectArticle.articles.push(val)
    }
    store.collectArticle.length = store.collectArticle.articles.length
  }

  return {
    isArticleCollect,
    toggleArticleCollect,
  }
}

export function getCurrentStudyWord(): TaskWords {
  const store = useBaseStore()
  let data: TaskWords = { new: [], review: [] }
  let dict = store.sdict
  let isTest = false
  let words = dict.words.slice()
  if (isTest) {
    words = Array.from({ length: 10 }).map((v, i) => {
      return getDefaultWord({ word: String(i) })
    })
  }

  if (words?.length) {
    const settingStore = useSettingStore()
    // Ignoring and mastery now use stable entity identity when available.
    const ignoreSet = [store.allIgnoreEntityKeysSet, store.knownEntityKeysSet][settingStore.ignoreSimpleWord ? 0 : 1]
    const isIgnored = (item: Word) => ignoreSet.has(practiceEntityKey(item))
    const perDay = dict.perDayStudyNumber
    const start = isTest ? 1 : dict.lastLearnIndex
    const complete = isTest ? true : dict.complete
    const isEnd = start >= dict.length - 1 && dict.length !== 1
    const reviewRatio = settingStore.wordReviewRatio

    let end = start
    if (!isEnd) {
      //从start往后取perDay个单词，作为新词
      for (let i = start; i < words.length; i++) {
        let item = words[i]
        if (data.new.length >= perDay) break
        if (!isIgnored(item)) {
          data.new.push(item)
        }
        end++
      }
    }

    //如果复习比大于等于1，或者已完成，才生成复习词
    if (reviewRatio >= 1 || complete || isEnd) {
      const totalNeed = perDay * (isEnd ? reviewRatio || 1 : reviewRatio)
      const now = Date.now()
      const newEntityKeys = new Set(data.new.map(practiceEntityKey))
      const due: Array<{ word: Word; cardKey: string; due: number; legacy: boolean }> = []

      for (const item of words) {
        const entityKey = practiceEntityKey(item)
        const cardEntry = resolveFsrsCardEntry(store.fsrsData, item, store.fsrsMigration)
        if (!cardEntry) continue

        if (isIgnored(item)) {
          // Stable cards belong to this entity and may be removed after mastery.
          // Legacy keys remain for rollback and old non-lexicon dictionaries.
          if (!cardEntry.legacy) delete store.fsrsData[cardEntry.key]
          continue
        }
        if (newEntityKeys.has(entityKey)) continue

        const dueAt = dayjs(cardEntry.card.due).valueOf()
        if (dueAt <= now) {
          due.push({ word: item, cardKey: cardEntry.key, due: dueAt, legacy: cardEntry.legacy })
        }
      }

      due.sort((a, b) => a.due - b.due)
      data.review = shuffle(due.slice(0, totalNeed).map(item => item.word))

      //如果数量不够再填充
      if (data.review.length < totalNeed) {
        let list = words.slice(0, start).reverse()
        if (complete) list = list.concat(words.slice(end).reverse())
        const reviewEntityKeys = new Set(data.review.map(practiceEntityKey))
        list = list.filter(item => {
          const entityKey = practiceEntityKey(item)
          return (
            !ignoreSet.has(entityKey) &&
            !newEntityKeys.has(entityKey) &&
            !reviewEntityKeys.has(entityKey) &&
            !hasFsrsCard(store.fsrsData, item, store.fsrsMigration)
          )
        })
        data.review = data.review.concat(list.slice(0, totalNeed - data.review.length))
      }
    }
  }
  return data
}

export function useGetDict() {
  const store = useBaseStore()
  const runtimeStore = useRuntimeStore()
  let waiting = $ref(false)
  let fetching = $ref(false)
  const route = useRoute()
  const router = useRouter()

  watch(
    [() => store.load, () => waiting],
    ([a, b]) => {
      if (a && b) {
        loadDict()
      }
    },
    { immediate: true }
  )

  onMounted(() => {
    // console.log('onMounted')
    if (route.query?.isAdd) {
      runtimeStore.editDict = getDefaultDict()
    } else {
      if (!runtimeStore.editDict?.id) {
        let dictId = route.params?.id
        if (!dictId) {
          return router.push('/articles')
        }
        waiting = true
      } else {
        loadDict(runtimeStore.editDict)
      }
    }
  })

  async function loadDict(dict?: Dict) {
    if (!dict) {
      dict = getDefaultDict()
      let dictId = route.params.id
      //先在自己的词典列表里面找，如果没有再在资源列表里面找
      dict = store.article.bookList.find(v => isDictIdMatch(v, dictId))
      let r = await fetch(resourceWrap(DICT_LIST.ARTICLE.ALL))
      let dict_list = await r.json()
      if (!dict) dict = dict_list.flat().find(v => isDictIdMatch(v, dictId)) as Dict
    }
    if (dict && dict.id) {
      if (!dict?.articles?.length && !dict?.custom && !dict?.system && !dict?.is_default) {
        fetching = true
        let r = await _getDictDataByUrl(dict, DictType.article)
        runtimeStore.editDict = r
      }
      if (store.article.bookList.find(book => book.id === runtimeStore.editDict.id)) {
        if (AppEnv.CAN_REQUEST) {
          let res = await detail({ id: runtimeStore.editDict.id })
          if (res.success) {
            runtimeStore.editDict.statistics = res.data.statistics
            if (res.data.articles.length) {
              runtimeStore.editDict.articles = res.data.articles
            }
          }
        }
      }
    } else {
      router.push('/articles')
    }

    waiting = false
    fetching = false
  }

  const loading = computed(() => waiting || fetching)

  return { loading }
}
