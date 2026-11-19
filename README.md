# dsh-text-count

给 DSH 一个**确定性的字数统计工具** `count_text`：中文按字、西文按词，另给标点 / 字符 / 字素 / 行数 / UTF-8 字节，并且可以用 `min`/`max` 区间**直接判定是否达标**。

解决的问题很具体：模型估字数会系统性偏移（尤其"这段不超过 200 字""微博限 140 字""摘要 300–500 词"这类硬约束），而且中文的"字"、英文的"词"、emoji 的"字符"三套口径经常被混着算。这个插件把口径写死在代码里，让 AI 调一次工具就有准确数字和 pass/fail。

## 指标

| 指标 | 含义 |
| --- | --- |
| `wordCount` | `cjkChars + latinWords`，即 Microsoft Word 的中文口径（默认判定指标） |
| `cjkChars` | 汉字个数（不含中日韩标点） |
| `latinWords` | 西文词数，支持 `don't`、`state-of-the-art` 这类带连字符 / 撇号的词 |
| `chars` | 码点个数（`[...text].length`，emoji 的 ZWJ 序列会算多个） |
| `graphemes` | 字素簇个数（`Intl.Segmenter`），"一个看得见的字符"口径，家庭 emoji 算 1 |
| `charsNoWhitespace` | 去掉所有空白后的码点个数 |
| `cjkWithPunct` | 汉字数 + 中日韩标点数 |
| `punctuation` | `cjkPunctuation + latinPunctuation` |
| `cjkPunctuation` | 中日韩标点：`，。！？；：、「」『』（）《》〈〉…—～·` 等 |
| `latinPunctuation` | 西文标点：`, . ! ? ; : ' " ( ) [ ] { } < > / \ | @ # $ % ^ & * - _ + = ~` 等 |
| `lines` | 行数（含空行；空文本为 0） |
| `nonEmptyLines` | 非空行数 |
| `bytesUtf8` | UTF-8 字节数，用来核对"文件不超过 N KB"这类限制 |

字素与码点的区别是最常被忽略的一点：`👨‍👩‍👧` 是 5 个码点、1 个字素。平台限制通常按字素或字符算，按码点算会多报。

## 用法

文本直接给：

```json
{ "text": "你好，世界！Hello world 👨‍👩‍👧" }
```

按长度硬约束判定（不达标时 `pass: false`，附一句人话说明缺多少）：

```json
{ "text": "...", "expect": { "metric": "wordCount", "min": 300, "max": 500 } }
```

统计文件（相对路径按当前会话工作目录解析，默认上限 5 MiB，超了先截取再用 `text` 传给工具）：

```json
{ "path": "docs/summary.md", "expect": { "metric": "chars", "max": 200 } }
```

返回：

```json
{
  "metrics": { "wordCount": 6, "cjkChars": 4, "latinWords": 2, "graphemes": 19, "...": "..." },
  "expect": { "metric": "wordCount", "min": 5, "max": 10, "value": 6, "pass": true, "message": "..." }
}
```

只给 `min` 或只给 `max` 时，判定对象里**不会**出现另一个边界键（不会给 `max` 塞 `undefined`）——返回的每个字段都是可直接序列化传输的实体值。

## 安装

从插件市场安装，或直接装 Release 里的预构建包：

```powershell
dsh plugin --profile web add "https://github.com/QqiqiQ/dsh-text-count/releases/latest/download/dsh-text-count.tgz"
```

同样的文件也发布在 npm 上，包名 `dsh-text-count`（市场安装走的仍是 Release 里的 tarball，npm 只是第二个取包源）：

```powershell
dsh plugin --profile web add dsh-text-count
```

要改代码就跑 checkout：

```powershell
dsh plugin --profile web add "D:/path/to/dsh-text-count"
```

装完重启 `dsh web` 生效。

## 开发

```powershell
node test.mjs   # 纯 Node 断言，无依赖
node --check index.js
```

`test.mjs` 里三条样例覆盖了中文 + 西文混排、全角标点、撇号、破折号、空行与 ZWJ emoji —— 这些正是口径最容易算错的地方。

## 备注

- 插件只注册一个工具，不注入提示词、不改会话状态，卸载无残留。
- 统计是纯函数，同一输入永远同一结果（不依赖分词模型）。

## License

MIT
