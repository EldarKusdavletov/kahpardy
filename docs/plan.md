# Своя Игра UNIST — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live Jeopardy-style («Своя игра») web game: board on a projector, ~60 players answer 4-option questions from their phones.

**Architecture:** One Node.js process (Express + Socket.IO). All game rules live in a pure, time-agnostic `Game` class (`src/game.js`) that the network layer (`server.js`) drives; after every change the server pushes a full role-specific state snapshot to the host and to each player. Two static pages: `/host` (projector) and `/play` (phone), plain JS with no build step.

**Tech Stack:** Node ≥ 20, express 4, socket.io 4, qrcode; `node:test` for tests, socket.io-client for integration tests and the load script.

**Spec:** `docs/spec.md`

## Global Constraints

- Node ≥ 20; runtime deps only `express`, `socket.io`, `qrcode`; dev dep only `socket.io-client`. No bundler, no frontend framework.
- Board: 4 themes × 3 questions (100 / 200 / 300), one round, no final wager, no bets.
- Every question text and every option is shown in RU and EN.
- Answer window 15 s (`QUESTION_MS = 15000`); bag intro 3 s (`BAG_INTRO_MS = 3000`).
- Scoring: correct `+value`, wrong `−value`, no answer `0`; «Мем в мешке» value ×2 both ways. Scores may go negative. No speed bonus.
- Chooser = fastest correct answerer (server receive time); none → the host picks.
- Player names 1–20 characters after trim; duplicates get suffix ` 2`, ` 3`, … (case-insensitive).
- Host actions require `HOST_KEY` in the Socket.IO handshake.
- Pages never call `alert` / `confirm` / `prompt`.
- The correct option never reaches a player before the `reveal` phase.
- Deviation from spec §4.2: instead of a separate `joined` event, `join` uses a Socket.IO acknowledgement `{ok, playerId, token, name}` / `{ok:false, error}`.

## Review Focus

- A phone locks or refreshes mid-game → it reconnects as the same player with the same score (Task 3, test "reconnect with token…").
- The same player has the page open in two tabs; closing one must not mark them offline (Task 3, same test).
- A player names themselves `<img src=x onerror=alert(1)>` → it is shown as text on the projector (Task 4, `esc` test).
- The last player who hasn't answered disconnects mid-question → the question closes now instead of waiting out the timer (Task 3, test "disconnect mid-question…").
- Other players' answers trigger state pushes while a player is tapping → the tap must not be lost to a DOM rebuild (Task 4, `paint` test: identical HTML is not re-applied).

---

## File Structure

```
svoya-igra/
  package.json, .gitignore, README.md
  questions.json            # the 12 questions (content)
  server.js                 # Express + Socket.IO; timers; broadcasts; createServer() export
  src/questions.js          # validateQuestions / loadQuestions
  src/game.js               # Game class: all rules, no I/O, no timers
  public/common.js          # esc, bi, secondsLeft, signed, paint, SHAPES (browser + node)
  public/style.css
  public/host.html, public/host.js
  public/play.html, public/play.js
  public/img/               # optional question images (.gitkeep)
  test/questions.test.js, test/game.test.js, test/server.test.js, test/common.test.js
  scripts/bots.js           # load test: N bot players
```

---

### Task 1: Scaffold, question content and validation

**Files:**
- Create: `package.json`, `.gitignore`, `public/img/.gitkeep`, `questions.json`, `src/questions.js`
- Test: `test/questions.test.js`

**Interfaces:**
- Produces: `validateQuestions(data, imgDir) → string[]` (empty = valid); `loadQuestions(file, imgDir) → data` (throws `Error` listing all problems). Data shape: `{ title, themes: [{ name:{ru,en}, questions:[{ value, text:{ru,en}, options:[{ru,en}×4], correct:0..3, image:string|null, bag:boolean }] }] }`.

- [ ] **Step 1: Check toolchain**

Run: `node -v && npm -v`
Expected: Node `v20` or newer. If older, stop and tell the user to install Node 20+ (`brew install node`).

- [ ] **Step 2: Create `package.json`, `.gitignore`, `public/img/.gitkeep`**

`package.json`:
```json
{
  "name": "svoya-igra",
  "version": "1.0.0",
  "private": true,
  "description": "Своя Игра UNIST — Jeopardy-style live quiz, players answer from phones",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test",
    "bots": "node scripts/bots.js"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "express": "^4.21.2",
    "qrcode": "^1.5.4",
    "socket.io": "^4.8.1"
  },
  "devDependencies": {
    "socket.io-client": "^4.8.1"
  }
}
```

`.gitignore`:
```
node_modules/
```

`public/img/.gitkeep`: empty file.

Run: `npm install`
Expected: installs without errors, creates `package-lock.json`.

- [ ] **Step 3: Write `questions.json`**

The 12 real questions (RU/EN, 4 options each, one `"bag": true`) — kept out of the public repository.
See `questions.json.example` for the exact format; tests run against the example file.

- [ ] **Step 4: Write the failing test `test/questions.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { validateQuestions, loadQuestions } = require('../src/questions');

const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'public', 'img');

function sample() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'questions.json'), 'utf8'));
}

test('real questions.json is valid: 4 themes x 3, exactly one bag', () => {
  const data = loadQuestions(path.join(ROOT, 'questions.json'), IMG);
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
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/questions'`.

- [ ] **Step 6: Implement `src/questions.js`**

```js
'use strict';
const fs = require('fs');
const path = require('path');

function hasLangs(obj) {
  return Boolean(obj)
    && typeof obj.ru === 'string' && obj.ru.trim() !== ''
    && typeof obj.en === 'string' && obj.en.trim() !== '';
}

function validateQuestions(data, imgDir) {
  if (!data || !Array.isArray(data.themes) || data.themes.length === 0) {
    return ['themes: must be a non-empty array'];
  }
  const errors = [];
  let bagCount = 0;
  data.themes.forEach((theme, t) => {
    const where = `themes[${t}]`;
    if (!hasLangs(theme.name)) errors.push(`${where}.name: needs ru and en`);
    if (!Array.isArray(theme.questions) || theme.questions.length === 0) {
      errors.push(`${where}.questions: must be a non-empty array`);
      return;
    }
    const values = new Set();
    theme.questions.forEach((q, i) => {
      const w = `${where}.questions[${i}]`;
      if (!Number.isInteger(q.value) || q.value <= 0) errors.push(`${w}.value: must be a positive integer`);
      else if (values.has(q.value)) errors.push(`${w}.value: duplicate ${q.value} in theme`);
      values.add(q.value);
      if (!hasLangs(q.text)) errors.push(`${w}.text: needs ru and en`);
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        errors.push(`${w}.options: must have exactly 4`);
      } else {
        q.options.forEach((o, k) => { if (!hasLangs(o)) errors.push(`${w}.options[${k}]: needs ru and en`); });
      }
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) errors.push(`${w}.correct: must be 0..3`);
      if (q.image != null && (typeof q.image !== 'string' || !fs.existsSync(path.join(imgDir, q.image)))) {
        errors.push(`${w}.image: file not found in public/img: ${q.image}`);
      }
      if (q.bag === true) bagCount += 1;
    });
  });
  if (bagCount !== 1) errors.push(`bag: exactly one question must have "bag": true (found ${bagCount})`);
  return errors;
}

function loadQuestions(file, imgDir) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateQuestions(data, imgDir);
  if (errors.length) throw new Error(`questions.json is invalid:\n  ${errors.join('\n  ')}`);
  return data;
}

module.exports = { validateQuestions, loadQuestions };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: 8 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore public/img/.gitkeep questions.json src/questions.js test/questions.test.js
git commit -m "feat: question content and validation"
```

---

### Task 2: Game rules (`src/game.js`)

**Files:**
- Create: `src/game.js`
- Test: `test/game.test.js`

**Interfaces:**
- Consumes: question data shape from Task 1.
- Produces: `class Game(questions, { questionMs = 15000, random = Math.random })` with:
  - `join(name, token?) → player {id, name, score, token, connected}` (throws `Error(NAME_ERROR)` on bad name)
  - `disconnect(playerId)`, `start() → bool`, `openCell(themeIndex, value, now) → bool`, `beginBagQuestion(now) → bool`
  - `canAnswer(playerId) → bool`, `answer(playerId, option, now) → bool`, `allAnswered() → bool`
  - `closeQuestion() → {deltas, counts, fastestId, value} | null`, `toBoard() → bool`, `end() → bool`
  - `phase`: `'lobby' | 'board' | 'bag_intro' | 'question' | 'reveal' | 'final'`
  - `hostView()` → `{ phase, title, themes:[{name, cells:[{value, played}]}], players:[name], playerCount, chooser, ranking:[{name, score, rank, delta}] (top 10), current, result:{counts, fastest}|null }`
  - `playerView(playerId)` → `{ phase, me:{name, score, rank}, playerCount, current, result:{delta, fastest}|null }` or `null` for unknown id
  - `current` (both views): `{ key, themeName, value, points, bag, bagPlayer, text, options, image, deadline, answeredCount, eligibleCount, correct }`; player views add `canAnswer, answered (option|null), isBagPlayer`. `correct` is `null` unless phase is `reveal`; `deadline` is `null` unless phase is `question`.
  - exports `{ Game, BAG_MULTIPLIER, NAME_ERROR }`

- [ ] **Step 1: Write the failing test `test/game.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, NAME_ERROR } = require('../src/game');

function fixture() {
  const q = (value, correct, bag = false) => ({
    value, correct, bag, image: null,
    text: { ru: `в${value}`, en: `q${value}` },
    options: [0, 1, 2, 3].map((i) => ({ ru: `о${i}`, en: `o${i}` })),
  });
  return {
    title: 'Test',
    themes: [
      { name: { ru: 'Т1', en: 'T1' }, questions: [q(100, 0), q(200, 1)] },
      { name: { ru: 'Т2', en: 'T2' }, questions: [q(100, 2), q(200, 3, true)] },
    ],
  };
}

function setup(names = ['Аня', 'Боря', 'Вова']) {
  const game = new Game(fixture(), { questionMs: 15000, random: () => 0 });
  const [a, b, c] = names.map((n) => game.join(n));
  game.start();
  return { game, a, b, c };
}

test('join trims names and rejects empty or longer than 20', () => {
  const game = new Game(fixture());
  assert.equal(game.join('  Аня  ').name, 'Аня');
  assert.throws(() => game.join('   '), { message: NAME_ERROR });
  assert.throws(() => game.join('x'.repeat(21)), { message: NAME_ERROR });
  assert.throws(() => game.join(undefined), { message: NAME_ERROR });
  assert.equal(game.join('x'.repeat(20)).name.length, 20);
});

test('duplicate names get numeric suffix, case-insensitive', () => {
  const game = new Game(fixture());
  assert.equal(game.join('Аня').name, 'Аня');
  assert.equal(game.join('аня').name, 'аня 2');
  assert.equal(game.join('Аня').name, 'Аня 3');
});

test('join with known token restores the same player and score', () => {
  const { game, a } = setup();
  game.openCell(0, 100, 0);
  game.answer(a.id, 0, 10);
  game.closeQuestion();
  game.disconnect(a.id);
  assert.equal(game.players.get(a.id).connected, false);
  const again = game.join('whatever', a.token);
  assert.equal(again.id, a.id);
  assert.equal(again.score, 100);
  assert.equal(again.connected, true);
});

test('start only works from lobby', () => {
  const game = new Game(fixture());
  assert.equal(game.start(), true);
  assert.equal(game.phase, 'board');
  assert.equal(game.start(), false);
});

test('scoring: +value correct, -value wrong, 0 no answer', () => {
  const { game, a, b, c } = setup();
  assert.equal(game.openCell(0, 100, 1000), true);
  assert.equal(game.phase, 'question');
  game.answer(a.id, 0, 1100);
  game.answer(b.id, 1, 1200);
  const result = game.closeQuestion();
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(result.deltas, { [a.id]: 100, [b.id]: -100 });
  assert.deepEqual(result.counts, [1, 1, 0, 0]);
  assert.equal(game.players.get(a.id).score, 100);
  assert.equal(game.players.get(b.id).score, -100);
  assert.equal(game.players.get(c.id).score, 0);
});

test('second answer, bad option, and answers outside question phase are ignored', () => {
  const { game, a, b } = setup();
  assert.equal(game.answer(a.id, 0, 0), false); // board phase
  game.openCell(0, 100, 0);
  assert.equal(game.answer(a.id, 1, 10), true);
  assert.equal(game.answer(a.id, 0, 20), false);
  assert.equal(game.answer(b.id, 4, 30), false);
  assert.equal(game.answer(b.id, '0', 30), false);
  assert.equal(game.answer('nobody', 0, 30), false);
  game.closeQuestion();
  assert.equal(game.answer(b.id, 0, 40), false);
  assert.equal(game.players.get(a.id).score, -100);
});

test('chooser is the fastest correct answerer', () => {
  const { game, a, b, c } = setup();
  game.openCell(0, 100, 0);
  game.answer(c.id, 3, 500);
  game.answer(a.id, 0, 2000);
  game.answer(b.id, 0, 1500);
  const result = game.closeQuestion();
  assert.equal(result.fastestId, b.id);
  assert.equal(game.hostView().chooser, 'Боря');
});

test('nobody correct leaves no chooser', () => {
  const { game, a } = setup();
  game.openCell(0, 100, 0);
  game.answer(a.id, 3, 10);
  game.closeQuestion();
  assert.equal(game.chooserId, null);
  assert.equal(game.hostView().chooser, null);
});

test('played cells, unknown cells and clicks outside board phase are ignored', () => {
  const { game } = setup();
  assert.equal(game.openCell(5, 100, 0), false);
  assert.equal(game.openCell(0, 999, 0), false);
  assert.equal(game.openCell(0, 100, 0), true);
  assert.equal(game.openCell(0, 200, 0), false); // during question
  game.closeQuestion();
  game.toBoard();
  assert.equal(game.openCell(0, 100, 0), false); // already played
  const cell = game.hostView().themes[0].cells.find((x) => x.value === 100);
  assert.equal(cell.played, true);
});

test('allAnswered counts only connected players', () => {
  const { game, a, b, c } = setup();
  game.openCell(0, 100, 0);
  game.answer(a.id, 0, 10);
  assert.equal(game.allAnswered(), false);
  game.disconnect(c.id);
  assert.equal(game.allAnswered(), false);
  game.answer(b.id, 0, 20);
  assert.equal(game.allAnswered(), true);
});

test('bag: chooser answers alone for double value', () => {
  const { game, a, b } = setup();
  game.openCell(0, 100, 0);
  game.answer(b.id, 0, 10); // b becomes chooser
  game.closeQuestion();
  game.toBoard();
  assert.equal(game.openCell(1, 200, 100), true);
  assert.equal(game.phase, 'bag_intro');
  assert.equal(game.answer(b.id, 3, 110), false); // not open yet
  assert.equal(game.hostView().current.bagPlayer, 'Боря');
  assert.equal(game.beginBagQuestion(3100), true);
  assert.equal(game.canAnswer(a.id), false);
  assert.equal(game.canAnswer(b.id), true);
  assert.equal(game.answer(a.id, 3, 3200), false);
  assert.equal(game.answer(b.id, 3, 3300), true);
  assert.equal(game.allAnswered(), true);
  const result = game.closeQuestion();
  assert.equal(result.value, 400);
  assert.equal(game.players.get(b.id).score, 100 + 400);
  assert.equal(game.chooserId, b.id);
});

test('bag: wrong answer costs double and clears the chooser', () => {
  const { game, b } = setup();
  game.openCell(0, 100, 0);
  game.answer(b.id, 0, 10);
  game.closeQuestion();
  game.toBoard();
  game.openCell(1, 200, 0);
  game.beginBagQuestion(0);
  game.answer(b.id, 0, 10);
  game.closeQuestion();
  assert.equal(game.players.get(b.id).score, 100 - 400);
  assert.equal(game.chooserId, null);
});

test('bag: without a connected chooser a random connected player is picked', () => {
  const { game, a, b } = setup(); // random: () => 0 picks the first connected player
  game.disconnect(a.id);
  game.openCell(1, 200, 0);
  assert.equal(game.current.bagPlayerId, b.id);
});

test('bag: disconnected addressee means nobody is eligible', () => {
  const { game, a } = setup();
  game.openCell(1, 200, 0);
  assert.equal(game.current.bagPlayerId, a.id);
  game.beginBagQuestion(0);
  game.disconnect(a.id);
  assert.equal(game.hostView().current.eligibleCount, 0);
  assert.equal(game.allAnswered(), false);
});

test('beginBagQuestion only works from bag_intro', () => {
  const { game } = setup();
  assert.equal(game.beginBagQuestion(0), false);
});

test('after all cells the game goes to final; end() works from any phase', () => {
  const { game } = setup();
  const cells = [[0, 100], [0, 200], [1, 100], [1, 200]];
  for (const [t, v] of cells) {
    game.openCell(t, v, 0);
    game.beginBagQuestion(0);
    game.closeQuestion();
    assert.equal(game.toBoard(), true);
  }
  assert.equal(game.phase, 'final');
  assert.equal(game.end(), false);

  const other = setup().game;
  other.openCell(0, 100, 0);
  assert.equal(other.end(), true);
  assert.equal(other.phase, 'final');
  assert.equal(other.current, null);
});

test('player view hides the correct answer until reveal', () => {
  const { game, a, b } = setup();
  game.openCell(0, 100, 1000);
  let v = game.playerView(a.id);
  assert.equal(v.current.correct, null);
  assert.equal(v.current.canAnswer, true);
  assert.equal(v.current.answered, null);
  assert.equal(v.current.deadline, 16000);
  assert.equal(v.result, null);
  game.answer(a.id, 2, 1100);
  v = game.playerView(a.id);
  assert.equal(v.current.canAnswer, false);
  assert.equal(v.current.answered, 2);
  assert.equal(game.hostView().current.correct, null);
  game.answer(b.id, 0, 1200);
  game.closeQuestion();
  v = game.playerView(a.id);
  assert.equal(v.current.correct, 0);
  assert.equal(v.current.deadline, null);
  assert.equal(v.result.delta, -100);
  assert.equal(v.result.fastest, 'Боря');
  assert.equal(game.playerView('nobody'), null);
});

test('ranking: ties share a rank, host top list carries deltas on reveal', () => {
  const { game, a, b, c } = setup();
  game.openCell(0, 100, 0);
  game.answer(a.id, 0, 10);
  game.answer(b.id, 0, 20);
  game.closeQuestion();
  const ranking = game.hostView().ranking;
  assert.deepEqual(ranking.map((r) => [r.name, r.rank, r.delta]), [
    ['Аня', 1, 100], ['Боря', 1, 100], ['Вова', 3, null],
  ]);
  assert.equal(game.playerView(c.id).me.rank, 3);
  game.toBoard();
  assert.equal(game.hostView().ranking[0].delta, null);
});

test('host view lists connected players and counts', () => {
  const { game, c } = setup();
  game.disconnect(c.id);
  const v = game.hostView();
  assert.deepEqual(v.players, ['Аня', 'Боря']);
  assert.equal(v.playerCount, 2);
  assert.equal(v.title, 'Test');
  assert.deepEqual(v.themes[1].cells.map((x) => x.value), [100, 200]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/game'`.

- [ ] **Step 3: Implement `src/game.js`**

```js
'use strict';
const crypto = require('crypto');

const BAG_MULTIPLIER = 2;
const NAME_ERROR = 'Имя: от 1 до 20 символов / Name: 1–20 characters';

class Game {
  constructor(questions, { questionMs = 15000, random = Math.random } = {}) {
    this.questions = questions;
    this.questionMs = questionMs;
    this.random = random;
    this.phase = 'lobby';
    this.players = new Map(); // id -> { id, name, score, token, connected }
    this.byToken = new Map();
    this.played = new Set(); // "themeIndex:value"
    this.chooserId = null;
    this.current = null; // { themeIndex, key, question, answers: Map(id -> {option, at}), openedAt, bagPlayerId }
    this.lastResult = null;
    this.nextId = 1;
  }

  join(name, token) {
    const known = token ? this.byToken.get(token) : null;
    if (known) {
      known.connected = true;
      return known;
    }
    const clean = typeof name === 'string' ? name.trim() : '';
    if (clean.length < 1 || clean.length > 20) throw new Error(NAME_ERROR);
    const player = {
      id: String(this.nextId++),
      name: this.uniqueName(clean),
      score: 0,
      token: crypto.randomUUID(),
      connected: true,
    };
    this.players.set(player.id, player);
    this.byToken.set(player.token, player);
    return player;
  }

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n += 1) {
      const candidate = `${name} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  disconnect(playerId) {
    const player = this.players.get(playerId);
    if (player) player.connected = false;
  }

  start() {
    if (this.phase !== 'lobby') return false;
    this.phase = 'board';
    return true;
  }

  openCell(themeIndex, value, now) {
    if (this.phase !== 'board') return false;
    const theme = this.questions.themes[themeIndex];
    const question = theme ? theme.questions.find((q) => q.value === value) : null;
    const key = `${themeIndex}:${value}`;
    if (!question || this.played.has(key)) return false;
    this.played.add(key);
    this.current = { themeIndex, key, question, answers: new Map(), openedAt: null, bagPlayerId: null };
    if (question.bag) {
      this.current.bagPlayerId = this.pickBagPlayer();
      this.phase = 'bag_intro';
    } else {
      this.current.openedAt = now;
      this.phase = 'question';
    }
    return true;
  }

  pickBagPlayer() {
    const chooser = this.players.get(this.chooserId);
    if (chooser && chooser.connected) return chooser.id;
    const online = this.connectedPlayers();
    if (online.length === 0) return null;
    return online[Math.floor(this.random() * online.length)].id;
  }

  beginBagQuestion(now) {
    if (this.phase !== 'bag_intro') return false;
    this.current.openedAt = now;
    this.phase = 'question';
    return true;
  }

  canAnswer(playerId) {
    if (this.phase !== 'question') return false;
    if (!this.players.has(playerId) || this.current.answers.has(playerId)) return false;
    return !this.current.question.bag || this.current.bagPlayerId === playerId;
  }

  answer(playerId, option, now) {
    if (!this.canAnswer(playerId)) return false;
    if (!Number.isInteger(option) || option < 0 || option > 3) return false;
    this.current.answers.set(playerId, { option, at: now });
    return true;
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  eligiblePlayers() {
    if (!this.current) return [];
    if (this.current.question.bag) {
      const p = this.players.get(this.current.bagPlayerId);
      return p && p.connected ? [p] : [];
    }
    return this.connectedPlayers();
  }

  allAnswered() {
    if (this.phase !== 'question') return false;
    const eligible = this.eligiblePlayers();
    return eligible.length > 0 && eligible.every((p) => this.current.answers.has(p.id));
  }

  closeQuestion() {
    if (this.phase !== 'question') return null;
    const q = this.current.question;
    const value = q.bag ? q.value * BAG_MULTIPLIER : q.value;
    const deltas = {};
    const counts = [0, 0, 0, 0];
    let fastest = null;
    for (const [id, a] of this.current.answers) {
      const player = this.players.get(id);
      const ok = a.option === q.correct;
      const delta = ok ? value : -value;
      player.score += delta;
      deltas[id] = delta;
      counts[a.option] += 1;
      if (ok && (!fastest || a.at < fastest.at)) fastest = { id, at: a.at };
    }
    this.chooserId = fastest ? fastest.id : null;
    this.lastResult = { deltas, counts, fastestId: this.chooserId, value };
    this.phase = 'reveal';
    return this.lastResult;
  }

  toBoard() {
    if (this.phase !== 'reveal') return false;
    this.current = null;
    this.phase = this.played.size >= this.totalCells() ? 'final' : 'board';
    return true;
  }

  end() {
    if (this.phase === 'final') return false;
    this.current = null;
    this.phase = 'final';
    return true;
  }

  totalCells() {
    return this.questions.themes.reduce((n, t) => n + t.questions.length, 0);
  }

  nameOf(playerId) {
    const p = this.players.get(playerId);
    return p ? p.name : null;
  }

  ranking() {
    const list = [...this.players.values()].sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    let rank = 0;
    return list.map((p, i) => {
      if (i === 0 || p.score !== list[i - 1].score) rank = i + 1;
      return { id: p.id, name: p.name, score: p.score, rank };
    });
  }

  currentView() {
    if (!this.current) return null;
    const { question: q, themeIndex, key } = this.current;
    return {
      key,
      themeName: this.questions.themes[themeIndex].name,
      value: q.value,
      points: q.bag ? q.value * BAG_MULTIPLIER : q.value,
      bag: Boolean(q.bag),
      bagPlayer: q.bag ? this.nameOf(this.current.bagPlayerId) : null,
      text: q.text,
      options: q.options,
      image: q.image || null,
      deadline: this.phase === 'question' ? this.current.openedAt + this.questionMs : null,
      answeredCount: this.current.answers.size,
      eligibleCount: this.eligiblePlayers().length,
      correct: this.phase === 'reveal' ? q.correct : null,
    };
  }

  hostView() {
    const reveal = this.phase === 'reveal';
    const deltas = reveal ? this.lastResult.deltas : {};
    const online = this.connectedPlayers();
    return {
      phase: this.phase,
      title: this.questions.title || 'Своя Игра',
      themes: this.questions.themes.map((t, ti) => ({
        name: t.name,
        cells: t.questions
          .map((q) => ({ value: q.value, played: this.played.has(`${ti}:${q.value}`) }))
          .sort((x, y) => x.value - y.value),
      })),
      players: online.map((p) => p.name),
      playerCount: online.length,
      chooser: this.nameOf(this.chooserId),
      ranking: this.ranking().slice(0, 10).map((r) => ({
        name: r.name, score: r.score, rank: r.rank, delta: r.id in deltas ? deltas[r.id] : null,
      })),
      current: this.currentView(),
      result: reveal ? { counts: this.lastResult.counts, fastest: this.nameOf(this.lastResult.fastestId) } : null,
    };
  }

  playerView(playerId) {
    const player = this.players.get(playerId);
    if (!player) return null;
    const me = this.ranking().find((r) => r.id === playerId);
    const current = this.currentView();
    if (current) {
      const a = this.current.answers.get(playerId);
      current.canAnswer = this.canAnswer(playerId);
      current.answered = a ? a.option : null;
      current.isBagPlayer = current.bag && this.current.bagPlayerId === playerId;
    }
    const reveal = this.phase === 'reveal';
    return {
      phase: this.phase,
      me: { name: player.name, score: player.score, rank: me.rank },
      playerCount: this.connectedPlayers().length,
      current,
      result: reveal
        ? { delta: this.lastResult.deltas[playerId] ?? 0, fastest: this.nameOf(this.lastResult.fastestId) }
        : null,
    };
  }
}

module.exports = { Game, BAG_MULTIPLIER, NAME_ERROR };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all questions + game tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game.js test/game.test.js
git commit -m "feat: game rules — scoring, chooser, Мем в мешке, views"
```

---

### Task 3: Server (`server.js`)

**Files:**
- Create: `server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `Game` (Task 2), `loadQuestions` (Task 1).
- Produces: `createServer({ questionsFile, hostKey, questionMs = 15000, bagIntroMs = 3000 }) → { app, httpServer, io, game }` (not yet listening). Routes: `GET /` → redirect `/play`; `GET /play`, `GET /host` → pages; `GET /qr.svg` → QR of `<proto>://<host>/play`; static `public/`; `/socket.io/socket.io.js` (served by Socket.IO).
- Socket protocol: handshake `auth: { role: 'host', key }` or `{ role: 'player' }`.
  - Host emits: `start`, `open {theme, value}`, `close`, `board`, `end`. Wrong key → server emits `auth_error` and disconnects.
  - Player emits: `join {name, token?}` with ack `{ok:true, playerId, token, name}` | `{ok:false, error}`; `answer {option}`.
  - Server emits `state` = `hostView()`/`playerView(id)` plus `serverNow` (ms epoch) after every change.

- [ ] **Step 1: Write the failing test `test/server.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');

const KEY = 'test-key';

async function boot(opts = {}) {
  const srv = createServer({
    questionsFile: path.join(__dirname, '..', 'questions.json'),
    hostKey: KEY,
    questionMs: 5000,
    bagIntroMs: 50,
    ...opts,
  });
  await new Promise((resolve) => srv.httpServer.listen(0, resolve));
  const url = `http://localhost:${srv.httpServer.address().port}`;
  const clients = [];
  const client = (auth) => {
    const s = connect(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    return s;
  };
  const close = async () => {
    clients.forEach((c) => c.disconnect());
    await new Promise((resolve) => srv.io.close(resolve));
  };
  return { srv, url, client, close };
}

function waitState(socket, pred, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('state', on); reject(new Error('timeout waiting for state')); }, ms);
    function on(s) {
      if (pred(s)) { clearTimeout(timer); socket.off('state', on); resolve(s); }
    }
    socket.on('state', on);
  });
}

const join = (s, name, token) => new Promise((resolve) => s.emit('join', { name, token }, resolve));

async function hostAndStart(client) {
  const host = client({ role: 'host', key: KEY });
  await waitState(host, (s) => s.phase === 'lobby');
  return host;
}

test('pages, QR and wrong host key', async () => {
  const { client, url, close } = await boot();
  try {
    const qr = await fetch(`${url}/qr.svg`);
    assert.equal(qr.status, 200);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(`${url}/play`)).status, 200);
    assert.equal((await fetch(`${url}/host`)).status, 200);
    const bad = client({ role: 'host', key: 'nope' });
    await new Promise((resolve) => bad.on('auth_error', resolve));
  } finally { await close(); }
});

test('invalid name is rejected via ack', async () => {
  const { client, close } = await boot();
  try {
    const p = client({ role: 'player' });
    const res = await join(p, '   ');
    assert.equal(res.ok, false);
    assert.match(res.error, /1–20/);
  } finally { await close(); }
});

test('round: answer closes early when everyone answered, reveal shows delta', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const p = client({ role: 'player' });
    assert.equal((await join(p, 'Аня')).ok, true);
    let next = waitState(host, (s) => s.phase === 'board');
    host.emit('start');
    await next;
    next = waitState(p, (s) => s.phase === 'question');
    host.emit('open', { theme: 0, value: 100 });
    const q = await next;
    assert.equal(q.current.canAnswer, true);
    assert.equal(q.current.correct, null);
    assert.equal(typeof q.serverNow, 'number');
    next = waitState(p, (s) => s.phase === 'reveal');
    const started = Date.now();
    p.emit('answer', { option: 0 }); // theme 0 / 100: correct option is 0
    const r = await next;
    assert.ok(Date.now() - started < 2000, 'closed early, not by the 5 s timer');
    assert.equal(r.result.delta, 100);
    assert.equal(r.me.score, 100);
    assert.equal(r.current.correct, 0);
  } finally { await close(); }
});

test('timer closes the question when nobody answers', async () => {
  const { client, close } = await boot({ questionMs: 300 });
  try {
    const host = await hostAndStart(client);
    const p = client({ role: 'player' });
    await join(p, 'Аня');
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    const next = waitState(p, (s) => s.phase === 'reveal');
    host.emit('open', { theme: 0, value: 200 });
    const r = await next;
    assert.equal(r.result.delta, 0);
  } finally { await close(); }
});

test('reconnect with token keeps score; closing a second tab keeps the player online', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const tab1 = client({ role: 'player' });
    const first = await join(tab1, 'Боря');
    const tab2 = client({ role: 'player' });
    const second = await join(tab2, 'ignored', first.token);
    assert.equal(second.playerId, first.playerId);
    assert.equal(second.name, 'Боря');
    tab1.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const next = waitState(host, (s) => s.phase === 'board');
    host.emit('start');
    const board = await next;
    assert.equal(board.playerCount, 1);

    const answered = waitState(tab2, (s) => s.phase === 'reveal');
    host.emit('open', { theme: 0, value: 100 });
    await waitState(tab2, (s) => s.phase === 'question');
    tab2.emit('answer', { option: 0 });
    await answered;
    tab2.disconnect();

    const tab3 = client({ role: 'player' });
    const third = await join(tab3, 'x', first.token);
    assert.equal(third.playerId, first.playerId);
    const s = await waitState(tab3, () => true);
    assert.equal(s.me.score, 100);
  } finally { await close(); }
});

test('disconnect mid-question closes it when everyone left has answered', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const a = client({ role: 'player' });
    const b = client({ role: 'player' });
    await join(a, 'Аня');
    await join(b, 'Боря');
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    const opened = waitState(a, (s) => s.phase === 'question');
    host.emit('open', { theme: 1, value: 100 });
    await opened;
    a.emit('answer', { option: 3 });
    await waitState(host, (s) => s.current && s.current.answeredCount === 1);
    const revealed = waitState(host, (s) => s.phase === 'reveal');
    b.disconnect();
    const r = await revealed;
    assert.equal(r.ranking.find((x) => x.name === 'Аня').delta, 100);
  } finally { await close(); }
});

test('bag cell: intro, then only the addressee can answer for double points', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const a = client({ role: 'player' });
    await join(a, 'Аня');
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    const intro = waitState(host, (s) => s.phase === 'bag_intro');
    const question = waitState(a, (s) => s.phase === 'question');
    host.emit('open', { theme: 3, value: 300 });
    const i = await intro;
    assert.equal(i.current.bagPlayer, 'Аня');
    const q = await question;
    assert.equal(q.current.isBagPlayer, true);
    assert.equal(q.current.points, 600);
    const reveal = waitState(a, (s) => s.phase === 'reveal');
    a.emit('answer', { option: 3 });
    const r = await reveal;
    assert.equal(r.result.delta, 600);
  } finally { await close(); }
});

test('host end goes to final from a question', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    host.emit('open', { theme: 0, value: 100 });
    await waitState(host, (s) => s.phase === 'question');
    const fin = waitState(host, (s) => s.phase === 'final');
    host.emit('end');
    await fin;
  } finally { await close(); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../server'`.

- [ ] **Step 3: Implement `server.js`**

Note: `public/host.html` and `public/play.html` are created in Tasks 4–5; for the route test in this task create them as minimal placeholders now (`<!doctype html><title>host</title>` / `<!doctype html><title>play</title>`); Tasks 4–5 overwrite them.

```js
'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game } = require('./src/game');
const { loadQuestions } = require('./src/questions');

const QUESTION_MS = 15000;
const BAG_INTRO_MS = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

function createServer({ questionsFile, hostKey, questionMs = QUESTION_MS, bagIntroMs = BAG_INTRO_MS }) {
  const questions = loadQuestions(questionsFile, path.join(PUBLIC_DIR, 'img'));
  const game = new Game(questions, { questionMs });

  const app = express();
  app.get('/', (req, res) => res.redirect('/play'));
  app.get('/play', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'play.html')));
  app.get('/host', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'host.html')));
  app.get('/qr.svg', async (req, res, next) => {
    try {
      const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
      const svg = await QRCode.toString(`${proto}://${req.get('host')}/play`, { type: 'svg', margin: 1 });
      res.type('image/svg+xml').send(svg);
    } catch (err) {
      next(err);
    }
  });
  app.use(express.static(PUBLIC_DIR));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const playerSockets = new Map(); // playerId -> Set<socket>
  let timer = null;

  function broadcast() {
    const serverNow = Date.now();
    io.to('host').emit('state', { ...game.hostView(), serverNow });
    for (const [playerId, sockets] of playerSockets) {
      const view = { ...game.playerView(playerId), serverNow };
      for (const s of sockets) s.emit('state', view);
    }
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function closeQuestion() {
    clearTimer();
    if (game.closeQuestion()) broadcast();
  }

  function startQuestionTimer() {
    clearTimer();
    timer = setTimeout(closeQuestion, questionMs);
  }

  function setupHost(socket) {
    socket.join('host');
    socket.emit('state', { ...game.hostView(), serverNow: Date.now() });
    socket.on('start', () => { if (game.start()) broadcast(); });
    socket.on('open', ({ theme, value } = {}) => {
      if (!game.openCell(theme, value, Date.now())) return;
      if (game.phase === 'bag_intro') {
        clearTimer();
        timer = setTimeout(() => {
          timer = null;
          if (game.beginBagQuestion(Date.now())) {
            startQuestionTimer();
            broadcast();
          }
        }, bagIntroMs);
      } else {
        startQuestionTimer();
      }
      broadcast();
    });
    socket.on('close', closeQuestion);
    socket.on('board', () => { if (game.toBoard()) broadcast(); });
    socket.on('end', () => {
      clearTimer();
      if (game.end()) broadcast();
    });
  }

  function setupPlayer(socket) {
    let playerId = null;

    function detach() {
      if (!playerId) return false;
      const sockets = playerSockets.get(playerId);
      sockets.delete(socket);
      if (sockets.size > 0) return false;
      playerSockets.delete(playerId);
      game.disconnect(playerId);
      return true;
    }

    socket.on('join', ({ name, token } = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      let player;
      try {
        player = game.join(name, token);
      } catch (err) {
        reply({ ok: false, error: err.message });
        return;
      }
      if (playerId !== player.id) {
        detach();
        playerId = player.id;
        if (!playerSockets.has(playerId)) playerSockets.set(playerId, new Set());
        playerSockets.get(playerId).add(socket);
      }
      reply({ ok: true, playerId: player.id, token: player.token, name: player.name });
      broadcast();
    });

    socket.on('answer', ({ option } = {}) => {
      if (!playerId || !game.answer(playerId, option, Date.now())) return;
      if (game.allAnswered()) closeQuestion();
      else broadcast();
    });

    socket.on('disconnect', () => {
      if (!detach()) return;
      if (game.allAnswered()) closeQuestion();
      else broadcast();
    });
  }

  io.on('connection', (socket) => {
    const { role, key } = socket.handshake.auth || {};
    if (role === 'host') {
      if (key !== hostKey) {
        socket.emit('auth_error');
        socket.disconnect(true);
        return;
      }
      setupHost(socket);
    } else {
      setupPlayer(socket);
    }
  });

  return { app, httpServer, io, game };
}

if (require.main === module) {
  const hostKey = process.env.HOST_KEY || crypto.randomBytes(4).toString('hex');
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createServer({ questionsFile: path.join(__dirname, 'questions.json'), hostKey });
  httpServer.listen(port, () => {
    console.log(`Игроки / players: http://localhost:${port}/play`);
    console.log(`Ведущий / host:   http://localhost:${port}/host?key=${hostKey}`);
  });
}

module.exports = { createServer, QUESTION_MS, BAG_INTRO_MS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (questions, game, server). If a server test hangs, the process will not exit — check that every test calls `close()` in `finally`.

- [ ] **Step 5: Commit**

```bash
git add server.js test/server.test.js public/host.html public/play.html
git commit -m "feat: realtime server with host auth, timers and reconnects"
```

---

### Task 4: Shared client helpers, styles and the host (projector) page

**Files:**
- Create: `public/common.js`, `public/style.css`, `public/host.js`
- Modify: `public/host.html` (replace placeholder)
- Test: `test/common.test.js`

**Interfaces:**
- Consumes: host `state` shape (Task 2 `hostView` + `serverNow`), host events (Task 3).
- Produces (globals in browser, `module.exports` in Node): `SHAPES`, `esc(s)`, `bi({ru,en})`, `secondsLeft(deadline, offset, now)`, `signed(n)`, `paint(el, html)`.

- [ ] **Step 1: Write the failing test `test/common.test.js`**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../public/common.js'`.

- [ ] **Step 3: Implement `public/common.js`**

```js
(function (root) {
  const SHAPES = ['▲', '◆', '●', '■'];
  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
  }

  function bi(t) {
    const ru = `<span class="ru">${esc(t && t.ru)}</span>`;
    return t && t.en && t.en !== t.ru ? `${ru}<span class="en">${esc(t.en)}</span>` : ru;
  }

  // offset = serverNow - clientNow at the moment the state arrived
  function secondsLeft(deadline, offset, now) {
    if (!deadline) return 0;
    return Math.max(0, Math.ceil((deadline - (now + offset)) / 1000));
  }

  function signed(n) {
    return n > 0 ? `+${n}` : String(n);
  }

  // Rebuild the DOM only when the markup changed, so taps are not lost to re-renders.
  function paint(el, html) {
    if (el._html === html) return false;
    el.innerHTML = html;
    el._html = html;
    return true;
  }

  const api = { SHAPES, esc, bi, secondsLeft, signed, paint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Write `public/style.css`**

```css
:root {
  --bg: #120a2e; --panel: #241650; --cell: #1f3fb0; --text: #fff; --muted: #b8b2d6; --gold: #ffd23f;
  --red: #e21b3c; --blue: #1368ce; --yellow: #c98f00; --green: #26890c; --up: #3ddc84; --down: #ff6b6b;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; border-radius: 12px; }
h1, h2 { margin: .3em 0; }
.ru { display: block; }
.en { display: block; color: var(--muted); font-size: .7em; }
.center { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 16px; }
.primary { background: var(--gold); color: #000; font-weight: 700; padding: 14px 32px; font-size: 1.2rem; }
.ghost { background: transparent; border: 1px solid var(--muted); color: var(--muted); padding: 8px 14px; font-size: .9rem; }
.opt0 { background: var(--red); } .opt1 { background: var(--blue); } .opt2 { background: var(--yellow); } .opt3 { background: var(--green); }
.shape { font-size: 1.3em; margin-right: .5em; }
.error { color: var(--down); }
.top { list-style: none; padding: 0; margin: 0; min-width: 260px; }
.top li { display: flex; gap: 10px; align-items: center; padding: 6px 10px; border-radius: 8px; background: var(--panel); margin-bottom: 6px; }
.top .rank { width: 2em; color: var(--muted); }
.top .name { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.top .score { font-weight: 700; }
.delta.up { color: var(--up); } .delta.down { color: var(--down); }

/* host (projector) */
.host { font-size: 22px; }
.host .join { display: flex; gap: 32px; align-items: center; }
.host .qr { width: 280px; height: 280px; background: #fff; padding: 12px; border-radius: 12px; }
.host .big { font-size: 1.6em; font-weight: 700; }
.host .names { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 90vw; }
.host .names span { background: var(--panel); padding: 4px 12px; border-radius: 999px; }
.board-wrap { display: flex; gap: 24px; padding: 24px; align-items: flex-start; justify-content: center; }
.board { border-spacing: 8px; }
.board th { background: var(--panel); padding: 12px 18px; text-align: left; min-width: 260px; border-radius: 10px; }
.board td button, .board td .played { display: block; width: 160px; height: 110px; border-radius: 10px; }
.board td button { background: var(--cell); color: var(--gold); font-size: 2.2em; font-weight: 800; }
.board td button:hover { outline: 4px solid var(--gold); }
.board td .played { border: 2px dashed var(--panel); }
.chooser { margin-bottom: 16px; font-size: 1.1em; }
.q { min-height: 100vh; display: flex; flex-direction: column; gap: 18px; padding: 24px 32px 80px; }
.q-head { display: flex; justify-content: space-between; align-items: center; color: var(--muted); }
.timer { font-size: 2.4em; font-weight: 800; color: var(--gold); min-width: 2ch; text-align: right; }
.q-text { font-size: 2em; text-align: center; }
.q-img { max-height: 32vh; max-width: 60vw; align-self: center; border-radius: 12px; }
.bag-note { text-align: center; color: var(--gold); }
.options { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.opt { display: flex; align-items: center; padding: 18px 22px; border-radius: 12px; font-size: 1.3em; text-align: left; position: relative; }
.opt.wrong { opacity: .35; }
.opt.correct { outline: 6px solid #fff; }
.opt .count { position: absolute; right: 18px; font-weight: 800; font-size: 1.4em; }
.q-foot { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.bag h1 { font-size: 4em; color: var(--gold); }
.end-controls { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 8px; align-items: center; background: var(--bg); padding: 6px; border-radius: 12px; }
.podium { display: flex; align-items: flex-end; gap: 16px; margin: 24px 0; }
.step { width: 200px; }
.step .name { font-weight: 700; }
.step .block { display: flex; align-items: center; justify-content: center; background: var(--cell); color: var(--gold); font-size: 2.5em; font-weight: 800; border-radius: 10px 10px 0 0; }
.step1 .block { height: 220px; } .step2 .block { height: 160px; } .step3 .block { height: 110px; }

/* player (phone) */
.player { font-size: 18px; }
.player main { padding-bottom: 56px; }
.player .join-form input { font-size: 1.2rem; padding: 12px; border-radius: 10px; border: 0; width: min(320px, 100%); }
.player .timer { text-align: center; padding-top: 8px; }
.answers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; height: calc(100dvh - 130px); }
.answer { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px; font-size: 1rem; color: #fff; text-align: center; }
.answer .shape { font-size: 2.2em; margin: 0 0 6px; }
.answer .en { color: rgba(255, 255, 255, .8); }
.player .opt { font-size: 1rem; }
.delta-big { font-size: 4em; font-weight: 800; }
.delta-big.up { color: var(--up); } .delta-big.down { color: var(--down); }
.place { font-size: 3em; font-weight: 800; color: var(--gold); }
.me { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; padding: 10px 16px; background: var(--panel); }
```

- [ ] **Step 6: Write `public/host.html`**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Своя Игра — ведущий</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="host">
  <main id="app"><div class="center"><h1>Подключение…</h1></div></main>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/common.js"></script>
  <script src="/host.js"></script>
</body>
</html>
```

- [ ] **Step 7: Write `public/host.js`**

```js
/* global io, SHAPES, esc, bi, secondsLeft, signed, paint */
const params = new URLSearchParams(location.search);
const socket = io({ auth: { role: 'host', key: params.get('key') || '' } });
const app = document.getElementById('app');
let state = null;
let offset = 0;
let confirmingEnd = false;

socket.on('auth_error', () => {
  paint(app, '<div class="center"><h1>Неверный ключ ведущего</h1><p class="en">Wrong host key — open /host?key=YOUR_KEY</p></div>');
});

socket.on('state', (s) => {
  offset = s.serverNow - Date.now();
  state = s;
  if (s.phase === 'final') confirmingEnd = false;
  render();
});

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'open') socket.emit('open', { theme: Number(el.dataset.theme), value: Number(el.dataset.value) });
  else if (action === 'end-ask') { confirmingEnd = true; render(); }
  else if (action === 'end-cancel') { confirmingEnd = false; render(); }
  else if (action === 'end-confirm') { confirmingEnd = false; socket.emit('end'); }
  else socket.emit(action); // start | close | board
});

function row(r) {
  const delta = r.delta == null ? '' : `<span class="delta ${r.delta > 0 ? 'up' : 'down'}">${signed(r.delta)}</span>`;
  return `<li><span class="rank">${r.rank}</span><span class="name">${esc(r.name)}</span>${delta}<span class="score">${r.score}</span></li>`;
}

function top(n) {
  if (state.ranking.length === 0) return '<p class="en">Пока никого / No players yet</p>';
  return `<ol class="top">${state.ranking.slice(0, n).map(row).join('')}</ol>`;
}

function lobby() {
  return `<div class="center lobby">
    <h1>${esc(state.title)}</h1>
    <div class="join">
      <img class="qr" src="/qr.svg" alt="QR">
      <div>
        <p class="big">${esc(location.host)}/play</p>
        <p>Игроков / Players: <b>${state.playerCount}</b></p>
      </div>
    </div>
    <div class="names">${state.players.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
    <button class="primary" data-action="start">Начать игру / Start</button>
  </div>`;
}

function board() {
  const rows = state.themes.map((t, ti) => `<tr><th>${bi(t.name)}</th>${t.cells.map((c) => `<td>${
    c.played ? '<span class="played"></span>'
      : `<button data-action="open" data-theme="${ti}" data-value="${c.value}">${c.value}</button>`
  }</td>`).join('')}</tr>`).join('');
  const chooser = state.chooser
    ? `Выбирает / Choosing: <b>${esc(state.chooser)}</b>`
    : 'Выбирает ведущий / Host chooses';
  return `<div class="board-wrap">
    <table class="board">${rows}</table>
    <aside><p class="chooser">${chooser}</p>${top(5)}</aside>
  </div>`;
}

function bagIntro() {
  const c = state.current;
  const who = c.bagPlayer ? esc(c.bagPlayer) : '—';
  return `<div class="center bag">
    <h1>Мем в мешке!</h1>
    <p class="en">Cat in the bag</p>
    <p>Отвечает / Answering: <b>${who}</b></p>
    <p>×2 = ${c.points}</p>
  </div>`;
}

function question() {
  const c = state.current;
  const reveal = state.phase === 'reveal';
  const options = c.options.map((o, i) => {
    const mark = reveal ? (i === c.correct ? 'correct' : 'wrong') : '';
    const count = reveal ? `<span class="count">${state.result.counts[i]}</span>` : '';
    return `<div class="opt opt${i} ${mark}"><span class="shape">${SHAPES[i]}</span><div>${bi(o)}</div>${count}</div>`;
  }).join('');
  const foot = reveal
    ? `<div>${state.result.fastest ? `Быстрее всех верно / Fastest correct: <b>${esc(state.result.fastest)}</b>` : 'Никто не ответил верно / Nobody got it'}</div>
       ${top(5)}
       <button class="primary" data-action="board">К табло / Board</button>`
    : `<div>Ответили / Answered: <b>${c.answeredCount}/${c.eligibleCount}</b></div>
       <button class="ghost" data-action="close">Закрыть досрочно / Close now</button>`;
  return `<div class="q">
    <div class="q-head"><div>${bi(c.themeName)} · ${c.points}${c.bag ? ' (×2)' : ''}</div><div class="timer" id="timer"></div></div>
    ${c.bag ? `<p class="bag-note">Мем в мешке — отвечает ${esc(c.bagPlayer || '—')}</p>` : ''}
    <h2 class="q-text">${bi(c.text)}</h2>
    ${c.image ? `<img class="q-img" src="/img/${encodeURIComponent(c.image)}" alt="">` : ''}
    <div class="options">${options}</div>
    <div class="q-foot">${foot}</div>
  </div>`;
}

function final() {
  const r = state.ranking;
  const podium = [[r[1], 2], [r[0], 1], [r[2], 3]].map(([p, place]) => (p
    ? `<div class="step step${place}"><div class="name">${esc(p.name)}</div><div>${p.score}</div><div class="block">${p.rank}</div></div>`
    : '<div class="step"></div>')).join('');
  return `<div class="center">
    <h1>Итоги / Results</h1>
    <div class="podium">${podium}</div>
    <ol class="top">${r.slice(3, 10).map(row).join('')}</ol>
  </div>`;
}

function endControls() {
  if (state.phase === 'final') return '';
  return confirmingEnd
    ? `<div class="end-controls">Завершить игру? / End game?
        <button class="primary" data-action="end-confirm">Да / Yes</button>
        <button class="ghost" data-action="end-cancel">Нет / No</button></div>`
    : '<div class="end-controls"><button class="ghost" data-action="end-ask">Завершить игру / End game</button></div>';
}

const VIEWS = { lobby, board, bag_intro: bagIntro, question, reveal: question, final };

function render() {
  if (!state) return;
  paint(app, VIEWS[state.phase]() + endControls());
  tick();
}

function tick() {
  const el = document.getElementById('timer');
  if (!el || !state || !state.current) return;
  el.textContent = state.current.deadline ? secondsLeft(state.current.deadline, offset, Date.now()) : '';
}

setInterval(tick, 200);
```

- [ ] **Step 8: Manual check of the host page**

Run: `HOST_KEY=dev npm start`, open `http://localhost:3000/host?key=dev`.
Expected: lobby with QR and `localhost:3000/play`. Open `http://localhost:3000/host?key=wrong` in another tab → «Неверный ключ ведущего». Open `/play` placeholder in another tab is fine for now (player UI comes in Task 5). Press «Начать игру» → 4×3 board with theme names in RU (EN below) and «Выбирает ведущий». Click «UNIST 100» → question screen with timer counting 15→0, then reveal with counts 0 and «К табло». «Завершить игру» → confirmation bar → «Да» → results screen. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add public/common.js public/style.css public/host.html public/host.js test/common.test.js
git commit -m "feat: host projector page and shared client helpers"
```

---

### Task 5: Player (phone) page

**Files:**
- Modify: `public/play.html` (replace placeholder)
- Create: `public/play.js`

**Interfaces:**
- Consumes: `common.js` globals (Task 4), player `state` shape (Task 2 `playerView` + `serverNow`), `join` ack and `answer` event (Task 3).
- Produces: nothing consumed later.

- [ ] **Step 1: Write `public/play.html`**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Своя Игра</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="player">
  <main id="app"><div class="center"><h2>Подключение…</h2></div></main>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/common.js"></script>
  <script src="/play.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/play.js`**

```js
/* global io, SHAPES, esc, bi, secondsLeft, signed, paint */
const socket = io({ auth: { role: 'player' } });
const app = document.getElementById('app');
const STORE = 'svoya-igra-player';
let me = loadMe(); // { name, token }
let state = null;
let offset = 0;
let joinError = '';
let draftName = me ? me.name : '';

function loadMe() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}

function saveMe(value) {
  try { localStorage.setItem(STORE, JSON.stringify(value)); } catch { /* private mode: no persistence */ }
}

function join(name, token) {
  socket.emit('join', { name, token }, (res) => {
    if (res && res.ok) {
      me = { name: res.name, token: res.token };
      saveMe(me);
      joinError = '';
    } else {
      joinError = (res && res.error) || 'Ошибка / Error';
    }
    render();
  });
}

socket.on('connect', () => {
  if (me) join(me.name, me.token);
  else render();
});

socket.on('state', (s) => {
  offset = s.serverNow - Date.now();
  state = s;
  render();
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  draftName = app.querySelector('input[name=name]').value;
  join(draftName);
});

app.addEventListener('click', (e) => {
  const button = e.target.closest('[data-option]');
  if (!button || !state || !state.current || !state.current.canAnswer) return;
  const option = Number(button.dataset.option);
  socket.emit('answer', { option });
  state.current.canAnswer = false; // optimistic: block double taps until the server confirms
  state.current.answered = option;
  render();
});

function joinForm() {
  return `<form class="center join-form">
    <h1>Своя Игра</h1>
    <input name="name" maxlength="20" autocomplete="off" placeholder="Твоё имя / Your name" value="${esc(draftName)}" required>
    <button class="primary">Войти / Join</button>
    ${joinError ? `<p class="error">${esc(joinError)}</p>` : ''}
  </form>`;
}

function card(html) {
  return `<div class="center">${html}</div>`;
}

function waiting() {
  return card(`<h2>Ты в игре, ${esc(state.me.name)}!</h2><p>Смотри на экран</p><p class="en">You're in — watch the big screen</p>`);
}

function watching(c) {
  const who = esc(c.bagPlayer || '—');
  return card(`<h2>Мем в мешке</h2><p>Смотрим: отвечает ${who}</p><p class="en">Watching: ${who} is answering</p>`);
}

function answerButtons(c) {
  return `<div class="timer" id="timer"></div>
    <div class="answers">${c.options.map((o, i) => `<button class="answer opt${i}" data-option="${i}">
      <span class="shape">${SHAPES[i]}</span>${bi(o)}</button>`).join('')}</div>`;
}

function questionScreen(c) {
  if (c.canAnswer) return answerButtons(c);
  if (c.answered !== null) return card('<h2>Ответ принят</h2><p class="en">Answer locked in — wait for the others</p><div class="timer" id="timer"></div>');
  if (c.bag && !c.isBagPlayer) return watching(c);
  return card('<h2>Ждём…</h2><p class="en">Waiting…</p>');
}

function result(c) {
  const d = state.result.delta;
  let ru = 'Нет ответа';
  let en = 'No answer';
  if (d > 0) { ru = 'Верно!'; en = 'Correct!'; }
  if (d < 0) { ru = 'Неверно'; en = 'Wrong'; }
  if (c.bag && !c.isBagPlayer) { ru = 'Мешок был не твой'; en = 'Not your bag'; }
  return card(`<div class="delta-big ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${signed(d)}</div>
    <p>${ru}</p><p class="en">${en}</p>
    <p>Правильный ответ / Correct answer:</p>
    <div class="opt opt${c.correct}"><span class="shape">${SHAPES[c.correct]}</span><div>${bi(c.options[c.correct])}</div></div>`);
}

function finalScreen() {
  return card(`<h1>Игра окончена</h1><p class="en">Game over</p>
    <div class="place">#${state.me.rank}</div><p>${state.me.score} очков / points</p>`);
}

function statusBar() {
  return `<footer class="me"><span>${esc(state.me.name)}</span><span>${state.me.score} · #${state.me.rank}</span></footer>`;
}

function screen() {
  const c = state.current;
  switch (state.phase) {
    case 'bag_intro':
      return c.isBagPlayer
        ? card(`<h1>Мем в мешке!</h1><p>Отвечаешь ты, ×2 = ${c.points}</p><p class="en">Cat in the bag — you answer, ×2</p>`)
        : watching(c);
    case 'question': return questionScreen(c);
    case 'reveal': return result(c);
    case 'final': return finalScreen();
    default: return waiting(); // lobby, board
  }
}

function render() {
  if (!me) { paint(app, joinForm()); return; }
  if (!state) { paint(app, card('<h2>Подключаемся…</h2><p class="en">Connecting…</p>')); return; }
  paint(app, screen() + statusBar());
  tick();
}

function tick() {
  const el = document.getElementById('timer');
  if (!el || !state || !state.current) return;
  el.textContent = state.current.deadline ? secondsLeft(state.current.deadline, offset, Date.now()) : '';
}

setInterval(tick, 200);
```

- [ ] **Step 3: Run the test suite (no regressions)**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 4: Manual end-to-end check (one laptop)**

Run: `HOST_KEY=dev npm start`. Open `/host?key=dev` in one window and `/play` in two other windows (one normal, one private, so they have separate `localStorage`); use Chrome devtools device mode (iPhone size) for the play windows.
Expected:
1. Join as «Аня» and «Аня» → second becomes «Аня 2»; host lobby shows both, count 2. Empty name → stays on the form (browser `required`); name of spaces → error text from server.
2. Start, open «UNIST 100»: both phones show 4 coloured buttons with RU+EN text and a countdown. Tap the correct option on one, a wrong one on the other → question closes immediately; phones show `+100` / `-100` and the correct answer; host shows counts, fastest name, top-5 with deltas.
3. «К табло» → board shows the cell played and «Выбирает: Аня».
4. Reload a phone window mid-game → it comes back as the same player with the same score (no join form).
5. Open «TikTok-мемы 300» → host shows «Мем в мешке!» for ~3 s naming the chooser; the chooser's phone gets buttons, the other phone shows «Смотрим». Points ×2.
6. «Завершить игру» → «Да» → host podium; phones show final place.
Stop the server.

- [ ] **Step 5: Commit**

```bash
git add public/play.html public/play.js
git commit -m "feat: player phone page"
```

---

### Task 6: Load test, README and Render deploy

**Files:**
- Create: `scripts/bots.js`, `README.md`

**Interfaces:**
- Consumes: player socket protocol (Task 3), `current.key` / `current.canAnswer` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Write `scripts/bots.js`**

```js
// Usage: node scripts/bots.js [url] [count]
// Joins `count` bot players and answers every question randomly 1–10 s after it opens.
const { io } = require('socket.io-client');

const url = process.argv[2] || 'http://localhost:3000';
const count = Number(process.argv[3] || 60);
let joined = 0;
let answered = 0;
let maxLagMs = 0;

for (let i = 0; i < count; i += 1) {
  const socket = io(url, { auth: { role: 'player' }, transports: ['websocket'] });
  let lastKey = null;
  socket.on('connect', () => {
    socket.emit('join', { name: `bot${i + 1}` }, (res) => { if (res && res.ok) joined += 1; });
  });
  socket.on('state', (s) => {
    maxLagMs = Math.max(maxLagMs, Date.now() - s.serverNow);
    const c = s.current;
    if (s.phase === 'question' && c && c.canAnswer && c.key !== lastKey) {
      lastKey = c.key;
      setTimeout(() => {
        socket.emit('answer', { option: Math.floor(Math.random() * 4) });
        answered += 1;
      }, 1000 + Math.random() * 9000);
    }
  });
}

setInterval(() => {
  console.log(`joined ${joined}/${count} · answers sent ${answered} · max state lag ${maxLagMs} ms`);
}, 2000);
```

- [ ] **Step 2: Local load run**

Run in terminal 1: `HOST_KEY=dev npm start`
Run in terminal 2: `npm run bots`
Then in the browser `/host?key=dev`: lobby shows 60 players; start; open 3 different cells.
Expected: bots print `joined 60/60`; on each question the host's «Ответили» climbs to 60/60 and the question closes early; `max state lag` stays under 1000 ms (same machine, so this is pure server latency). Stop both.

- [ ] **Step 3: Write `README.md`**

````markdown
# Своя Игра UNIST

Jeopardy-style live quiz: the board is on the projector, players answer from their phones.

## Run locally

```bash
npm install
HOST_KEY=secret npm start
```

- Projector (host): `http://localhost:3000/host?key=secret`
- Players: `http://localhost:3000/play` (the QR on the host lobby points here)

Without `HOST_KEY` a random key is generated and printed at startup.

## Tests

```bash
npm test                                   # unit + integration
npm run bots -- http://localhost:3000 60   # 60 bot players (load test)
```

## Questions

Edit `questions.json`: 4 themes × 3 questions, each with `text` and 4 `options` in `ru`/`en`,
`correct` = 0..3, optional `image` (file name in `public/img/`), exactly one question with `"bag": true`
(«Мем в мешке»). The server refuses to start and lists every problem if the file is invalid.

## Deploy to Render (free)

1. Push this repo to GitHub.
2. render.com → New → Web Service → pick the repo.
   - Runtime: Node · Build command: `npm install` · Start command: `npm start` · Instance type: Free
   - Environment → add `HOST_KEY` = a secret only the host knows.
3. Deploy. Host: `https://<name>.onrender.com/host?key=<HOST_KEY>`, players: `https://<name>.onrender.com/play`.
4. Load test once: `npm run bots -- https://<name>.onrender.com 60`.

The free instance sleeps after 15 minutes without traffic and needs ~1 minute to wake up:
**open the host page at least 2 minutes before the game.** Game state lives in memory — a restart resets it.

## Backup: run from the laptop

```bash
HOST_KEY=secret npm start
cloudflared tunnel --url http://localhost:3000   # brew install cloudflared
```

Use the printed `https://….trycloudflare.com` address (`/host?key=secret` and `/play`). The link changes on every run.

## Day-of checklist

- Open `/host?key=…` 2+ minutes early (wakes Render), projector in full screen (F11 / ⌃⌘F).
- Join from your own phone first to check the QR and the buttons.
- Keep the laptop backup ready (`npm start` + `cloudflared`).
````

- [ ] **Step 4: Commit**

```bash
git add scripts/bots.js README.md
git commit -m "chore: load-test bots, README with Render deploy"
```

- [ ] **Step 5: Deploy to Render (with the user)**

This needs the user's GitHub and Render accounts — do it together, step by step:
1. User creates an empty GitHub repo (e.g. `svoya-igra`); run `git remote add origin <url> && git push -u origin HEAD` (ask before pushing).
2. User follows README «Deploy to Render» steps 2–3 in the browser.
3. Run `npm run bots -- https://<name>.onrender.com 60` while the user watches `/host?key=…` and plays 2 questions.
Expected: 60/60 joined, questions close early when all bots answer, `max state lag` (includes clock skew) stays roughly under 1500 ms.

- [ ] **Step 6: Real-phone check**

User opens the Render `/play` URL by scanning the QR on 2–3 real phones (one on mobile data, one on campus Wi-Fi) and plays a few questions, including locking a phone mid-question and unlocking it.
Expected: buttons are large and readable, the locked phone comes back as the same player.
