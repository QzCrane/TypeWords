# 学习策略和卡片粒度

## 掌握对象

FSRS 不再只按字符串 `word` 调度，而按 `PracticeCard.cardId` 调度：

- recognition：识别词或表达；
- listening：声音到词形/义项；
- spelling：拼写；
- pronunciation：音位、重音和弱读；
- sense-discrimination：义项选择；
- construction：句法框架、补语和介词；
- collocation：搭配；
- zh-to-en-production：中文意图到英语；
- error-correction：个人错误模式。

A1 需要核心技能全面自动化；A2 重点做到核心义项和常用结构主动可用；R1/R2 默认不要求逐词拼写和自由产出。

## 顺序控制

1. 同一个语言实体跨多本书只建立一套学习状态。
2. 多词表达读取 `prerequisiteLexicalUnitIds`，原则上在组成词之后学习。
3. 编号同形异义候选先合并到基础词的 sense 层，审核前不独立背。
4. 高置信屈折形式继承 lemma 的学习，不重复进入主队列。
5. IT/工程来源最多提升一个层级，不能仅凭领域标签进入 A1。
6. 质量问题按字段隔离：错误词源不会导致整个常用词被删除。
7. TypeWords 导入后，结合用户 known、错词和既有 FSRS 再动态重排。
