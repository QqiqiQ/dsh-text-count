import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { computeMetrics, apply } from './index.js';

// sample 1: 4 CJK + 2 full-width punct (,!) + "Hello world " + family emoji (all via code points)
const s =
  String.fromCodePoint(0x4f60, 0x597d, 0xff0c, 0x4e16, 0x754c, 0xff01) +
  'Hello world ' +
  String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
const m = computeMetrics(s);

assert.equal(m.cjkChars, 4, 'cjkChars');
assert.equal(m.latinWords, 2, 'latinWords: Hello world');
assert.equal(m.wordCount, 6, 'wordCount = 4 + 2');
assert.equal(m.cjkPunctuation, 2, 'cjkPunctuation: FF0C FF01');
assert.equal(m.latinPunctuation, 0, 'latinPunctuation');
assert.equal(m.punctuation, 2);
assert.equal(m.cjkWithPunct, 6, 'cjkWithPunct = 4 + 2');
assert.equal(m.chars, 23, 'code points');
assert.equal(m.graphemes, 19, 'graphemes');
assert.equal(m.charsNoWhitespace, 21);
assert.equal(m.lines, 1);
assert.equal(m.bytesUtf8, 48, 'UTF-8: 12+6+12+18');

// sample 2: don't stop + 2x U+2014 + 2 CJK + FF01 + blank line + 3 CJK + FF1A + OK + U+3002
const s2 =
  "don't stop" +
  String.fromCodePoint(0x2014, 0x2014, 0x7ee7, 0x7eed, 0xff01) +
  '\n\n' +
  String.fromCodePoint(0x7b2c, 0x4e8c, 0x884c, 0xff1a) +
  'OK' +
  String.fromCodePoint(0x3002);
const m2 = computeMetrics(s2);
assert.equal(m2.latinWords, 3, "don't / stop / OK");
assert.equal(m2.cjkChars, 5, 'cjkChars: 5 hanzi');
assert.equal(m2.cjkPunctuation, 5, 'cjkPunct: 2x2014 + FF01 + FF1A + 3002');
assert.equal(m2.latinPunctuation, 1, "only apostrophe '");
assert.equal(m2.punctuation, 6);
assert.equal(m2.lines, 3);
assert.equal(m2.nonEmptyLines, 2);

// sample 3: empty text
const m3 = computeMetrics('');
assert.equal(m3.chars, 0);
assert.equal(m3.lines, 0);
assert.equal(m3.nonEmptyLines, 0);

// ---------------------------------------------------------------------------
// tool contract: expect judgement, lossless JSON, path branch, error paths
// (regression for "value is not lossless JSON" when only min or max was given)
// ---------------------------------------------------------------------------

const CJK4 = String.fromCodePoint(0x4f60, 0x597d, 0x4e16, 0x754c); // 4 hanzi
const TMP_NAME = '.test-sample.txt';
const tmpAbs = path.join(process.cwd(), TMP_NAME);

function makeTool(config) {
  const defs = [];
  const ctx = {
    tools: {
      register(definition) {
        defs.push(definition);
        return () => {};
      },
    },
    effect(fn) {
      return fn();
    },
    get() {
      return undefined;
    },
  };
  apply(ctx, config);
  assert.equal(defs.length, 1, 'apply() registers exactly one tool');
  return defs[0];
}

const tool = makeTool({});
const run = (args) => tool.execute(args, {});
const lossless = (value) =>
  JSON.stringify(value) === JSON.stringify(JSON.parse(JSON.stringify(value)));

// 1) min only: the undefined `max` key used to break the host JSON check
let r = await run({ text: CJK4, expect: { metric: 'wordCount', min: 1 } });
assert.equal(r.source, 'text');
assert.equal(r.expect.pass, true);
assert.equal(r.expect.min, 1);
assert.ok(!('max' in r.expect), 'min-only judgement must not carry a max key');
assert.ok(lossless(r), 'min-only output must be lossless JSON');

// 2) max only
r = await run({ text: CJK4, expect: { metric: 'wordCount', max: 2 } });
assert.equal(r.expect.pass, false);
assert.equal(r.expect.max, 2);
assert.ok(!('min' in r.expect), 'max-only judgement must not carry a min key');
assert.ok(r.expect.message.length > 0, 'failure carries a message');
assert.ok(lossless(r), 'max-only output must be lossless JSON');

// 3) both bounds
r = await run({ text: CJK4, expect: { metric: 'cjkChars', min: 1, max: 10 } });
assert.equal(r.expect.pass, true);
assert.equal(r.expect.value, 4);
assert.equal(r.expect.min, 1);
assert.equal(r.expect.max, 10);

// 4) bounds omitted -> stats only, no judgement object
r = await run({ text: CJK4, expect: { metric: 'wordCount' } });
assert.equal(r.expect, undefined, 'no bounds means no judgement');
assert.equal(r.metrics.wordCount, 4);

// 5) unknown metric is rejected
await assert.rejects(run({ text: CJK4, expect: { metric: 'bogus', min: 1 } }));

// 6) empty input is rejected
await assert.rejects(run({}));

// 7) text wins over path, and the result says so
r = await run({ text: CJK4, path: 'this-file-does-not-exist.txt' });
assert.equal(r.source, 'text');
assert.ok(r.note && r.note.length > 0, 'text+path note is present');
assert.equal(r.metrics.cjkChars, 4);

// 8) render: pass/fail marker and file source line
r = await run({ text: CJK4, expect: { metric: 'wordCount', min: 1 } });
assert.match(tool.output.render({}, r)[0].text, /\u2705/); // check mark
r = await run({ text: CJK4, expect: { metric: 'wordCount', max: 2 } });
assert.match(tool.output.render({}, r)[0].text, /\u274c/); // cross mark

// 9) path branch: relative path resolves against cwd, stats match, JSON is lossless
await writeFile(tmpAbs, CJK4, 'utf8');
try {
  r = await run({ path: TMP_NAME, expect: { metric: 'cjkChars', min: 1 } });
  assert.equal(r.source, 'path');
  assert.equal(r.path, tmpAbs);
  assert.equal(r.metrics.cjkChars, 4);
  assert.equal(r.metrics.bytesUtf8, 12); // 4 hanzi * 3 bytes
  assert.ok(lossless(r), 'path output must be lossless JSON');
  assert.match(tool.output.render({}, r)[0].text, /^.{0,20}/);
} finally {
  await unlink(tmpAbs);
}

// 10) oversized file is rejected by config.maxFileBytes
await writeFile(tmpAbs, 'abcde', 'utf8');
try {
  const tiny = makeTool({ maxFileBytes: 4 });
  await assert.rejects(tiny.execute({ path: TMP_NAME }, {}));
} finally {
  await unlink(tmpAbs);
}

console.log('ALL ASSERTIONS PASSED');
