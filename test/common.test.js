const test = require('node:test');
const assert = require('node:assert/strict');
const { esc, bi, secondsLeft, signed, paint, SHAPES } = require('../public/common.js');

test('esc neutralises HTML in player names', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(`a&b"c'd`), 'a&amp;b&quot;c&#39;d');
  assert.equal(esc(null), '');
});

test('bi renders ru and en, skipping en when identical', () => {
  assert.equal(bi({ ru: 'Кот', en: 'Cat' }), '<span class="ru">Кот</span><span class="en">Cat</span>');
  assert.equal(bi({ ru: 'UNIST', en: 'UNIST' }), '<span class="ru">UNIST</span>');
  assert.equal(bi({ ru: '<b>', en: 'x' }), '<span class="ru">&lt;b&gt;</span><span class="en">x</span>');
});

test('secondsLeft accounts for server clock offset and never goes negative', () => {
  assert.equal(secondsLeft(16000, 0, 1000), 15);
  assert.equal(secondsLeft(16000, 500, 1000), 15); // 14.5 s -> ceil 15
  assert.equal(secondsLeft(16000, 0, 15001), 1);
  assert.equal(secondsLeft(16000, 0, 20000), 0);
  assert.equal(secondsLeft(null, 0, 0), 0);
});

test('signed formats deltas', () => {
  assert.equal(signed(200), '+200');
  assert.equal(signed(-200), '-200');
  assert.equal(signed(0), '0');
});

test('paint does not touch the DOM when HTML is unchanged', () => {
  let writes = 0;
  const el = { _html: undefined, set innerHTML(v) { writes += 1; this._v = v; }, get innerHTML() { return this._v; } };
  assert.equal(paint(el, '<b>a</b>'), true);
  assert.equal(paint(el, '<b>a</b>'), false);
  assert.equal(paint(el, '<b>b</b>'), true);
  assert.equal(writes, 2);
});

test('four shapes', () => assert.equal(SHAPES.length, 4));
