import assert from 'node:assert/strict';
import { computeMetrics } from './index.js';

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

console.log('ALL ASSERTIONS PASSED');
