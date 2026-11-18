import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

// CJK 统一表意文字:基本区、扩展 A、兼容表意、扩展 B–I
const CJK_CHARS =
  /[㐀-䶿一-鿿豈-﫿𠀀-𪛟𪜀-𫜿𫝀-𫠟𫠠-𬺯𬺰-𮯯𰀀-𱍏𱍐-𲎯]/gu;

// 西文单词:字母/数字串,允许内部连字符与撇号(don't, state-of-the-art)
const LATIN_WORDS = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

// 中文(全角)标点:CJK 标点区、全角 ASCII 标点部分,以及中文常用的 — … ‘’ “”
const CJK_PUNCT =
  /[　-〿！-／：-＠［-｀｛-･—…‘’“”]/gu;

// 西文(半角)标点:ASCII 可打印字符中的标点区间
const LATIN_PUNCT = /[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/g;

export const METRIC_NAMES = [
  'wordCount',
  'cjkChars',
  'latinWords',
  'chars',
  'graphemes',
  'charsNoWhitespace',
  'cjkWithPunct',
  'punctuation',
  'cjkPunctuation',
  'latinPunctuation',
  'lines',
  'nonEmptyLines',
  'bytesUtf8',
];

function countMatches(text, re) {
  return (text.match(re) || []).length;
}

export function computeMetrics(text) {
  const cjkChars = countMatches(text, CJK_CHARS);
  const latinWords = countMatches(text, LATIN_WORDS);
  const cjkPunctuation = countMatches(text, CJK_PUNCT);
  const latinPunctuation = countMatches(text, LATIN_PUNCT);
  const chars = Array.from(text).length;
  let graphemes = 0;
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  for (const _ of segmenter.segment(text)) graphemes += 1;
  const charsNoWhitespace = Array.from(text.replace(/\s/gu, '')).length;
  const lineList = text.length === 0 ? [] : text.split(/\r\n|\r|\n/);
  return {
    wordCount: cjkChars + latinWords,
    cjkChars,
    latinWords,
    chars,
    graphemes,
    charsNoWhitespace,
    cjkWithPunct: cjkChars + cjkPunctuation,
    punctuation: cjkPunctuation + latinPunctuation,
    cjkPunctuation,
    latinPunctuation,
    lines: lineList.length,
    nonEmptyLines: lineList.filter((l) => l.trim().length > 0).length,
    bytesUtf8: new TextEncoder().encode(text).length,
  };
}

function evaluateExpect(metrics, expect) {
  const metric = expect.metric ?? 'wordCount';
  const { min, max } = expect;
  if (!METRIC_NAMES.includes(metric)) {
    throw new Error(`未知指标 "${metric}"。可选:${METRIC_NAMES.join(', ')}`);
  }
  if (min === undefined && max === undefined) return undefined;
  const value = metrics[metric];
  const pass =
    (min === undefined || value >= min) && (max === undefined || value <= max);
  const req =
    min !== undefined && max !== undefined
      ? `${min}–${max}`
      : min !== undefined
        ? `≥${min}`
        : `≤${max}`;
  let message;
  if (pass) {
    message = `达标:${metric}=${value},要求 ${req}`;
  } else if (min !== undefined && value < min) {
    message = `不达标:${metric}=${value},要求 ${req},还差 ${min - value}`;
  } else {
    message = `不达标:${metric}=${value},要求 ${req},超出 ${value - max}`;
  }
  return { metric, min, max, value, pass, message };
}

export const inject = ['tools'];

export function apply(ctx, config) {
  const maxFileBytes =
    Number.isFinite(config?.maxFileBytes) && config.maxFileBytes > 0
      ? config.maxFileBytes
      : DEFAULT_MAX_FILE_BYTES;

  async function resolvePath(p, exec) {
    if (path.isAbsolute(p)) return p;
    const wd = ctx.get('workingDirectory');
    if (wd && exec?.agent) {
      try {
        const base = await wd.ensure(exec.agent, exec.signal);
        if (typeof base === 'string' && base) return path.resolve(base, p);
      } catch {
        // 退回进程工作目录
      }
    }
    return path.resolve(p);
  }

  const definition = {
    name: 'count_text',
    description:
      '精确统计文本的字数、字符数、标点与行数,并可按 min/max 区间判定是否达标。模型自行计数不可靠:凡被要求「不少于 N 字」「N 字左右」「压缩到 N 字以内」「标点不超过 N 个」时,交付前必须用本工具核验。默认字数口径与 Word 一致:中文每个汉字计 1,西文按单词计。输入用 text(直接文本)或 path(读取本地文件,仅返回统计数字,不返回文件内容)。',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要统计的文本内容。与 path 二选一;同时提供时使用 text。',
        },
        path: {
          type: 'string',
          description: `要统计的 UTF-8 文本文件路径(相对路径基于当前会话工作目录)。超过大小上限(默认 ${DEFAULT_MAX_FILE_BYTES / 1024 / 1024} MiB)会报错,请先截取片段后用 text 传入。`,
        },
        expect: {
          type: 'object',
          description:
            '达标判定(可选)。「不少于 500 字」→ {"min":500};「500 字左右」→ {"min":450,"max":550};「标点不超过 50 个」→ {"metric":"punctuation","max":50}。',
          properties: {
            metric: {
              type: 'string',
              description: `参与判定的指标名,默认 wordCount。可选:${METRIC_NAMES.join(' / ')}`,
            },
            min: {
              type: 'number',
              description: '最小值(含)。与 max 至少给一个,否则只统计不判定。',
            },
            max: {
              type: 'number',
              description: '最大值(含)。与 min 至少给一个,否则只统计不判定。',
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        description: `统计结果:metrics 含 ${METRIC_NAMES.join('/')};给了 expect 时附 expect:{metric,min,max,value,pass,message}。`,
      },
      render(_args, value) {
        const m = value.metrics;
        const parts = [
          `字数 wordCount=${m.wordCount}(中文 ${m.cjkChars} + 西文词 ${m.latinWords})`,
          `标点=${m.punctuation}(全角 ${m.cjkPunctuation} + 半角 ${m.latinPunctuation})`,
          `字符=${m.chars}(去空白 ${m.charsNoWhitespace},字素 ${m.graphemes})`,
          `含标点字数=${m.cjkWithPunct}`,
          `行数=${m.lines}(非空 ${m.nonEmptyLines})`,
          `UTF-8 字节=${m.bytesUtf8}`,
        ];
        if (value.source === 'path') parts.unshift(`来源:文件 ${value.path}`);
        if (value.note) parts.push(value.note);
        if (value.expect) {
          parts.push(`${value.expect.pass ? '✅' : '❌'} ${value.expect.message}`);
        }
        return [{ type: 'text', text: parts.join(';') }];
      },
    },
    timeoutMs: 10000,
    isConcurrencySafe: () => true,
    presentCall(args) {
      const a = args ?? {};
      const what =
        typeof a.text === 'string'
          ? `text(${Array.from(a.text).length} 字符)`
          : String(a.path ?? '');
      return {
        card: 'generic',
        title: '字数统计',
        kind: 'other',
        content: [
          {
            type: 'text',
            text: `统计 ${what}${a.expect ? `,判定 ${JSON.stringify(a.expect)}` : ''}`,
          },
        ],
      };
    },
    async execute(args, exec) {
      const a = args ?? {};
      let text;
      let source;
      let resolvedPath;
      if (typeof a.text === 'string') {
        text = a.text;
        source = 'text';
      } else if (typeof a.path === 'string' && a.path.length > 0) {
        resolvedPath = await resolvePath(a.path, exec);
        const st = await stat(resolvedPath);
        if (st.size > maxFileBytes) {
          throw new Error(
            `文件 ${resolvedPath} 为 ${st.size} 字节,超过上限 ${maxFileBytes} 字节。请先截取片段后用 text 参数传入。`,
          );
        }
        text = await readFile(resolvedPath, 'utf8');
        source = 'path';
      } else {
        throw new Error('缺少参数:请提供 text(直接文本)或 path(文件路径)。');
      }
      const result = { source, metrics: computeMetrics(text) };
      if (resolvedPath) result.path = resolvedPath;
      if (typeof a.text === 'string' && typeof a.path === 'string' && a.path) {
        result.note = '同时提供了 text 与 path,已按 text 统计。';
      }
      if (a.expect && typeof a.expect === 'object') {
        const judgement = evaluateExpect(result.metrics, a.expect);
        if (judgement) result.expect = judgement;
      }
      return result;
    },
  };

  return ctx.effect(() => ctx.tools.register(definition));
}
