const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { validateQuestions, loadQuestions } = require('../src/questions');

const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'public', 'img');
const EXAMPLE = path.join(ROOT, 'questions.json.example');

function sample() {
  return JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
}

test('questions.json.example is valid: 4 themes x 3, exactly one bag', () => {
  const data = loadQuestions(EXAMPLE, IMG);
  assert.equal(data.themes.length, 4);
  for (const t of data.themes) assert.equal(t.questions.length, 3);
  const bags = data.themes.flatMap((t) => t.questions).filter((q) => q.bag);
  assert.equal(bags.length, 1);
});

test('reports wrong option count', () => {
  const d = sample();
  d.themes[0].questions[0].options.pop();
  assert.match(validateQuestions(d, IMG).join('\n'), /themes\[0\]\.questions\[0\]\.options: must have exactly 4/);
});

test('reports correct index out of range', () => {
  const d = sample();
  d.themes[1].questions[2].correct = 4;
  assert.match(validateQuestions(d, IMG).join('\n'), /themes\[1\]\.questions\[2\]\.correct/);
});

test('reports missing english text', () => {
  const d = sample();
  delete d.themes[2].questions[1].text.en;
  assert.match(validateQuestions(d, IMG).join('\n'), /themes\[2\]\.questions\[1\]\.text: needs ru and en/);
});

test('reports zero or two bags', () => {
  const d = sample();
  d.themes[0].questions[0].bag = true;
  assert.match(validateQuestions(d, IMG).join('\n'), /found 2/);
  const e = sample();
  e.themes[3].questions[2].bag = false;
  assert.match(validateQuestions(e, IMG).join('\n'), /found 0/);
});

test('reports duplicate value inside a theme', () => {
  const d = sample();
  d.themes[0].questions[1].value = 100;
  assert.match(validateQuestions(d, IMG).join('\n'), /duplicate 100/);
});

test('reports missing image file', () => {
  const d = sample();
  d.themes[0].questions[0].image = 'nope.png';
  assert.match(validateQuestions(d, IMG).join('\n'), /image: file not found/);
});

test('loadQuestions throws with all problems listed', () => {
  const tmp = path.join(require('os').tmpdir(), `bad-questions-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ themes: [] }));
  assert.throws(() => loadQuestions(tmp, IMG), /questions\.json is invalid/);
  fs.unlinkSync(tmp);
});

test('local questions.json, when present, is valid too', (t) => {
  const real = path.join(ROOT, 'questions.json');
  if (!fs.existsSync(real)) return t.skip('no local questions.json');
  loadQuestions(real, IMG);
});
