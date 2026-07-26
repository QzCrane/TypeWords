# 来源和证据模型

`SourceBook` 是具体文件；`BookMembership` 是原始书内记录；`LexicalUnit` 是规范化语言对象；`EvidenceVariant` 是去重正文。

- 具体书名永不因归一化消失。
- 搜索键不区分大小写，但实体 ID 可以区分大小写语义。
- `sourceFamilyId` 根据文件名推断，用于学习排序去膨胀，不代表官方来源认证。
- 相同正文被多本书复制只算一个 evidence variant。
- 未来接入独立词典、语料和考试原文时，应另建 `SourceDocument` 与字段级 `Assertion`，不能把词书文件名直接当作释义出处。
