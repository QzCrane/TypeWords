# TypeWords 接入状态

已完成数据包、旧 `Word` 安全投影、阶段资源目录、卡片 ID 规则、来源模型和 FSRS 迁移契约。

需要在 TypeWords fork 中实施的核心改动：

1. `Word` 增加 `lexicalUnitId`/`lexiconMeta`，并将完整详情放入独立 Lexicon Store。
2. JSON V2 导入不能继续只读取 `item.word`；应读取 `lexiconMeta` 和来源 ID。
3. `fsrsData: Record<string, Card>` 从词形键迁移到 `PracticeCard.cardId`。
4. 旧进度只继承给 spelling 卡，不能自动声明义项、搭配和句法已掌握。
5. 学习队列读取 `learning_sequence`，再叠加 known、FSRS due、个人错误和领域目标。
6. 详情页按需显示来源书目、正文变体、质量状态和验证记录。

当前已连接 GitHub 仓库中没有可写 TypeWords fork，因此没有直接提交源码或创建 PR；包内代码可作为 fork 的独立 `packages/lexicon` 起点。
