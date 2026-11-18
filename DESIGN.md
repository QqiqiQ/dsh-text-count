# text-count:AI 字数检查插件 · 设计文档

> 状态:已实现(2026-11-19),本地与运行时均已验证;测试见 §7。
> 目标:模型自行数字数不可靠,提供一个**确定性计算**的字数统计工具,让 AI 在被要求「不少于 500 字」「800 字左右」等约束时,交付前可以自查并拿到通过/不通过的明确判定。

## 1. 形态与扩展点

- **Host-only 插件**(纯后端,无 UI)。不做 Web 界面:使用场景是 AI 在对话/写作流程中调用,不需要人工操作入口。
- 通过 `ctx.tools.register(definition)` 注册一个**全局工具**(注入 `inject = ['tools']`)。
- 依据(Host Service `tools` 契约,2026-11-13 实测):
  - `ToolDefinition extends ToolSchema { name, description, parameters, output, execute(), timeoutMs?, isConcurrencySafe?(), presentCall?/presentResult?() }`
  - 输出由 `output.schema` + `output.render(args, value)` 负责渲染为模型可见文本。
- 工具只返回**数字与判定结论,不回显原文**——天然规避了「读取任意文件导致内容泄漏」的风险,path 参数因此可接受。

## 2. 包结构(bundle)

```
text-count/                     ← 安装时的包目录,包名 dsh-text-count(以 link 方式挂进 profile)
├── package.json                ← name/version/type:module/exports/dsh.bundle.patch/files/icon
├── cordis.patch.yml            ← insert 一行: id: text-count, name: 'dsh-text-count'
├── index.js                    ← export const inject=['tools']; export function apply(ctx, config)
├── test.mjs                    ← 回归测试(计数样本 + 工具契约),node test.mjs 运行
├── DESIGN.md                   ← 本文件
├── locale/
│   ├── zh.json                 ← meta.title「字数检查」meta.description 能力描述
│   └── en.json                 ← meta.title "Text Count" ...
└── icon.svg                    ← 原创图标(「字#」计数徽章),≤256KiB
```

`package.json` 关键字段:

```json
{
  "name": "dsh-text-count",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "icon.png", "README.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: text-count
      name: 'dsh-text-count'
      config: {}
```

## 3. 工具定义

### 3.1 名称与描述

- name: `count_text`
- description(模型可见,描述行为而非实现,触发时机写清楚):

> 精确统计文本的字数/字符数/行数,并可对照目标区间判定是否达标。模型自行计数不可靠,凡被要求「不少于 N 字」「N 字左右」「压缩到 N 字以内」时,交付前必须用本工具核验。输入为 text(直接文本)或 path(读文件,只返回统计数字,不返回文件内容)。字数口径:中文每个汉字计 1,西文按单词计(与 Word 一致);另有纯字符数口径可选。

### 3.2 参数(parameters,JSON Schema)

| 参数 | 类型 | 说明 |
|---|---|---|
| `text` | string? | 要统计的文本。与 `path` 二选一;两者都给了以 `text` 为准并在结果中注明。 |
| `path` | string? | 要统计的本地文件路径(UTF-8 文本)。相对路径相对当前会话工作目录解析。只用于统计,不回显内容。超过大小上限报错并提示先截取。 |
| `expect` | object? | 达标判定。`{ metric?: string, min?: number, max?: number }`。`metric` 取值见下表,默认 `wordCount`;`min`/`max` 至少给一个,否则不判定只统计。「不少于 500 字」→ `{min:500}`;「500 字左右」→ `{min:450,max:550}`。 |

### 3.3 输出指标(全部返回,单个结果很小,无需裁剪参数)

| 字段 | 口径 | 实现要点 |
|---|---|---|
| `wordCount` | **常用「字数」口径**:CJK 每字计 1 + 西文按单词数(同 Word 字数统计) | 核心指标,expect 默认口径 |
| `cjkChars` | CJK 表意文字数 | Unicode 范围:`\u3400-\u4DBF \u4E00-\u9FFF \uF900-\uFAFF` + 扩展 B 及以后(`\u{20000}-\u{2A6DF}` 等,用带 `u` 标志的正则) |
| `latinWords` | 西文单词数 | `/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g` 匹配数 |
| `chars` | 字符数(Unicode 码点) | `Array.from(text).length`;emoji/生僻字按 1 计,**不是** `.length` |
| `graphemes` | 用户可见字素数 | `Intl.Segmenter('zh', {granularity:'grapheme'})`(Node 内置,零依赖);组合 emoji(👨‍👩‍👧)按 1 计 |
| `charsNoWhitespace` | 去掉所有空白后的字符数 | 按码点过滤 `\s` |
| `cjkWithPunct` | 中文字符 + 中文标点 | 「含标点 N 字」类要求用此口径;中文标点集合显式列出(。,、!?;:「」……—()《》等) |
| `punctuation` | 标点总数(中文 + 西文半角) | 两者之和 |
| `cjkPunctuation` | 中文(全角)标点数 | 显式集合 + Unicode 中文标点区间:`\u3000-\u303F`(CJK 标点)、`\uFF00-\uFF65` 中标点部分(全角形式)、`—…「」『』《》〈〉` 等;按码点匹配 |
| `latinPunctuation` | 西文(半角)标点数 | ASCII 标点区间 `!-/ :-@ [-` {-~` 按码点匹配 |
| `lines` / `nonEmptyLines` | 行数 / 非空行数 | 按 `\r\n|\r|\n` 切分 |
| `bytesUtf8` | UTF-8 字节数 | `Buffer.byteLength` 或 `TextEncoder` |

### 3.4 判定输出

```json
{
  "metrics": { "wordCount": 512, "cjkChars": 480, "...": "..." },
  "source": "text" ,
  "expect": { "metric": "wordCount", "min": 500, "pass": true, "value": 512, "message": "达标:wordCount=512,要求 ≥500" }
}
```

- `pass: true/false` + 一句中文结论(不达标时给差值:「还差 23 字」),让模型不用再心算。
- `output.render` 渲染为一行紧凑文本,如:`wordCount=512(中文480+西文词32),标点=37(全角31+半角6),chars=526,行数=8;✅ 达标(≥500)`。
- `expect.metric` 可取任意输出指标(含 `punctuation` 系列),例如「标点不超过 50 个」→ `{metric:"punctuation",max:50}`。

## 4. 关键设计决策(及理由)

1. **用码点而非 UTF-16 `.length`**:模型常数错的正是 emoji/生僻字场景;`Array.from` / `Intl.Segmenter` 均 Node 内置,零依赖。
2. **默认口径 = Word 式混合字数(CJK 字 + 西文词)**:用户说「字数」时绝大多数指这个口径;纯字符数、含标点口径作为可选 metric 覆盖歧义场景。
3. **判定逻辑内置在工具里(expect.min/max),返回 pass 和差值**:把「512 ≥ 500 吗?」这种二次心算也从模型手里拿掉,这正是模型容易错的第二类地方。
4. **标点单列三指标(总数/全角/半角)**:中文写作检查常要求「标点规范」(混用全半角是常见毛病),拆开统计让模型能直接回答「全角标点几个、半角几个」。emoji、数学符号、货币符号**不算**标点,不计入。
5. **零依赖、纯函数、无状态**:Host 插件只 import Node 内置模块;`isConcurrencySafe: () => true`;`timeoutMs` 设 10s 足够(计数是 O(n))。
6. **文件大小上限**:Config `maxFileBytes`,默认 5 MiB,超限报错并建议先截取/用 text 传片段。实现偏差:v1 未用 `export const Config`(cordis Schema),而是 `apply(ctx, config)` 里手动读并校验 `config?.maxFileBytes`,因此没有 Settings 可视化表单;要改值需编辑该插件行的 `config`。
7. **path 相对路径解析**:`exec` 带 `agent`,经 `ctx.get('workingDirectory').ensure(exec.agent, exec.signal)` 拿到会话工作目录后 `path.resolve`;拿不到时退回 `path.resolve(p)`(进程 cwd)。
8. **失败即报错文本**:text/path 都没给、文件读不到、超上限——抛错由工具管线物化为错误结果,无需在 description 里写这些显而易见的行为。

## 5. 展示资源清单(已完成)

- `locale/zh.json`:`{"meta":{"title":"字数检查","description":"为 AI 提供确定性的字数/字符数统计与达标判定工具。"}}`
- `locale/en.json`:对应英文。
- `icon.svg`:原创简单图标(建议:方框内「字#」字符计数徽章,单色描边,遵循 host-plugin 图标约束:SVG ≤256KiB,包内相对路径)。

## 6. 实现与验证步骤(已完成)

1. 在工作区创建包目录与上述文件;`node --check index.js` 过语法。
2. `plugin_manager install_bundle`(需用户批准)→ 返回 `application: applied`;profile `package.json` 记入 `"dsh-text-count": "link:D:/Java/dsh插件/text-count"`,bundle 列表加入 `dsh-text-count`,`node_modules/dsh-text-count` 指向源目录(改代码后重启即生效,无需重新安装)。
3. 运行时确认 `count_text` 已注册并可直接调用(见 §7.4)。
4. 实际调用验证:含 emoji/CJK/混合文本的已知样本,核对 `chars`/`wordCount`/`graphemes`;path、expect 判定、超上限报错均覆盖(§7)。
5. Plugin Manager 中标题/描述/图标显示正常(中英文)、无需任何配置项即可使用。

## 7. 测试与回归(`test.mjs`)

`node test.mjs`,零依赖、不需要运行时,当前 **全部通过**。分两层:

### 7.1 计数样本(已知答案,防计数回归)

| 样本 | 构造 | 关键断言 |
|---|---|---|
| 中英混合 + 组合家庭 emoji | `你好,世界!` + `Hello world ` + 👨‍👩‍👧(码点拼) | `wordCount=6`、`cjkPunctuation=2`、`latinPunctuation=0`、`chars=23`、`graphemes=19`、`bytesUtf8=48` |
| 全半角混排 + 空行 | `don't stop——继续!` + 空行 + `第二行:OK。` | `latinWords=3`、`cjkChars=5`、`cjkPunctuation=5`、`latinPunctuation=1`、`lines=3`、`nonEmptyLines=2` |
| 空文本 | `''` | `chars/lines/nonEmptyLines = 0` |

> 样本一律用 `String.fromCodePoint(...)` 构造:CJK 与全角标点若以字面量写入文件,某些写盘链路会把它们规范化成 ASCII,导致样本本身失真(曾因此误判实现有问题)。

### 7.2 工具契约(防返回值结构回归)

用 mock ctx 调 `apply()`,捕获注册的 `definition`,直接 `await definition.execute(args, {})`,并断言每个返回值满足 `JSON.stringify(v) === JSON.stringify(JSON.parse(JSON.stringify(v)))`(宿主对工具输出做无损 JSON 校验)。

| # | 用例 | 断言 |
|---|---|---|
| 1 | 只给 `min` | `'max' in expect === false`(不是 `max: undefined`)、`pass=true`、无损 JSON |
| 2 | 只给 `max` | `'min' in expect === false`、`pass=false`、message 非空、无损 JSON |
| 3 | `min` + `max` | 值与边界正确、`pass=true` |
| 4 | 只给 `metric` | `expect === undefined`(只统计不判定) |
| 5 | 未知指标 | 抛出错误 |
| 6 | 无 `text` 无 `path` | 抛出错误 |
| 7 | 同时给 `text` 与 `path` | 按 `text` 统计、带 `note` |
| 8 | `render` 渲染 | 达标含 ✅(U+2705),不达标含 ❌(U+274C) |
| 9 | `path` 相对路径 | 解析为绝对路径、`cjkChars`/`bytesUtf8` 正确、无损 JSON |
| 10 | 超限文件 | `maxFileBytes: 4` 时拒绝 5 字节文件 |

### 7.3 回归出来的真实 bug(已修)

只给 `min`(或只给 `max`)时,判定对象里另一侧是 `undefined` 键,宿主校验失败,整次调用返回:

```
Error: tool "count_text" returned invalid output: value is not lossless JSON
```

修复:判定对象只写入实际给出的边界(`index.js` 中 `evaluateExpect` 末尾)。这组用例 1/2 就是为此保留的回归锚点。

### 7.4 运行时验证(2026-11-19,重启后实测)

| 调用 | 结果 |
|---|---|
| `path: text-count/DESIGN.md` | 读出 `wordCount=1793(中文 1367 + 西文词 426)`、`bytesUtf8=8619`,✅ 达标 |
| 只给 `max` 且不达标 | `wordCount=9`,❌ 不达标,要求 ≤3,超出 6 |
| `expect` 只带 `metric` | 正常输出统计,无判定行 |

## 8. 后续可选增强(不在 v1)

- `Intl.Segmenter` word 粒度做中文分词计数(`segmentedWords`),更接近严格语言学「词数」。
- `compare` 模式:一次传两段文本,输出差值(「把 A 改写到与 B 同长度 ±10%」场景)。
- 批量:数组输入,一次统计多个文件/多段文本。
