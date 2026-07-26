# TypeWords 全量词书归一化、来源保留与学习顺序包 v2

## 当前结果

- 194 本 JSON 词书全部纳入。
- 277,529 条原始记录全部保留来源关系。
- 生成 31,951 个规范化语言实体，使用 31,915 个不区分大小写的搜索键。
- 28 个搜索键被拆成多个大小写敏感实体，避免把 `US` 与 `us` 之类的同形对象错误合并。
- URL 编码先解码再分类；`baggage%20claim` 现在是正常多词表达 `baggage claim`，不是异常词。
- `lie 1`、`lie 2`、`do 1` 等保留为 35 个编号同形异义候选，并链接基础词，等待义项审核，不作为独立背诵单位。
- 共享正文去重为 36,989 个 evidence variants。
- 792 个实体的高置信错误词源/词族已在安全投影中隔离；原始证据仍保留。
- 625 个异常字符串、长句、数字束和损坏形式进入清理区，不进入学习。

## 你是否需要会全部约 3.2 万个实体

不需要以同一种深度掌握，也不应该把全部实体排成一条机械背诵队列。

| 层级 | 数量 | 目标 |
|---|---:|---|
| A1 | 6,369 | 主动自动化：听、说、读、写和核心结构均能快速调用 |
| A2 | 4,281 | 主动可控：能准确产出核心义项、搭配和句法 |
| R1 | 7,804 | 流畅识别：阅读/听力中快速理解，常用者再转主动 |
| R2 | 8,249 | 语境识别：专业、考试、低频和多词表达按上下文掌握 |
| O | 4,623 | 按需：单来源、罕见、专名或目标依赖内容 |
| Q | 625 | 清理：审核前不学习 |

主动系统学习总量是 **10,650** 个实体。额外 **16,053** 个以识别为目标，而不是全部自由产出。另有 **4,623** 个只在真实阅读、工作或考试需要时学习。

这仍不是最终“词元数量”：其中包含 6,827 个多词表达、31 个缩略语和 35 个编号义项候选。词形审核已经建立 84 条高置信不规则屈折链接、1,950 条中置信规则词形候选；中置信候选不自动合并，避免误把派生词当屈折形式。

## 精细学习顺序

| 阶段 | 独立学习单位 | 目标 |
|---|---:|---|
| S0 foundation automatic | 3,759 | 最强通用支持，优先自动化 |
| S1 core automatic | 2,583 | 完成主动核心、多义基础词 |
| S2 general active | 1,988 | 通用扩展与常用多词表达 |
| S3 academic technical active | 2,281 | 学术、技术和个人工程方向主动词 |
| S4 broad receptive | 7,784 | 广泛阅读和听力识别 |
| S5 specialized contextual | 8,197 | 专业、考试和低频语境识别 |
| S6 on demand | 4,615 | 遇到任务时再学 |
| Q0 cleanup | 625 | 不进入训练 |

高置信屈折形式和编号义项候选不单独进入主队列，因此当前独立学习单位为 **31,207**；TypeWords 导入后还要用你的“已掌握”和既有 FSRS 状态进一步跳过已会内容。

## 归一化后是否仍能区分来源

可以，而且没有只保留“出现次数”。每个实体都能追到：

- 具体词书；
- 原始书内索引；
- 原始 ID；
- 原始拼写和大小写；
- URL 解码前形式；
- 原始正文哈希；
- 去重后的正文变体 ID。

数据库关系：

```text
SourceBook
   └─ BookMembership ──> LexicalUnit
             └─────────> EvidenceVariant
```

十本词书复制同一正文，只形成一个 evidence variant，不会被当成十个独立词典证据。具体书名全部保存在 `memberships` 和 `sources_by_unit.jsonl` 中；`sourceFamilyId` 只用于学习排序时削弱教材系列和同考试系列的重复膨胀。

查询 `divide` 的全部来源：

```sql
SELECT l.identity_key, l.display_form, s.filename,
       m.source_index, m.source_original_id,
       m.original_headword, m.evidence_variant_id
FROM lexical_units l
JOIN memberships m ON m.lexical_unit_id = l.lexical_unit_id
JOIN source_books s ON s.source_book_id = m.source_book_id
WHERE l.search_key = 'divide'
ORDER BY s.filename, m.source_index;
```

查询 `US` 与 `us`：

```sql
SELECT identity_key, display_form, case_profile, user_tier
FROM lexical_units
WHERE search_key = 'us';
```

## 主要文件

- `lexicon.sqlite`：规范化主库，TypeWords 接入首选。
- `learning_sequence.csv`：最终阶段、独立顺序、先修关系和词形链接。
- `learning_order.csv`：全量实体排序与完整书名来源。
- `source_books.json` / `source_books.csv`：194 本词书元数据。
- `memberships.jsonl`：277,529 条原始来源关系。
- `sources_by_unit.jsonl`：每个实体的完整来源集合。
- `lexical_units.jsonl`：实体、来源 ID、学习层级和质量状态。
- `evidence_variants.jsonl`：正文变体与复制范围。
- `validation_queue.csv`：冲突、错链、规范化和异常清理队列。
- `typewords_import/`：阶段词表、安全旧格式投影和资源目录。
- `integration/`：TypeWords 的新数据类型、卡片 ID 和迁移规则。
- `scripts/`：可重复构建脚本。

## 仍不能伪装成已完成的部分

本包已经完成数据工程层：来源归一化、身份拆分、重复去膨胀、异常隔离、学习排序、TypeWords 投影和迁移接口。

它没有把 31,951 个实体的每个义项、定义、句法配价、语用边界、词源和例句全部验证成权威内容。旧词书本身不支持这种结论。深度内容必须按 S0→S3 活跃队列增量接入独立词典、真实语料和你的个人错误记录；未经证据验证的 AI 生成内容只能标为候选，不能覆盖原始层。
