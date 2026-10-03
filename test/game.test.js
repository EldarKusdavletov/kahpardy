const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, NAME_ERROR, FULL_ERROR } = require('../src/game');

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

test('join refuses new players beyond maxPlayers but still restores known tokens', () => {
  const game = new Game(fixture(), { maxPlayers: 2 });
  const a = game.join('A');
  game.join('B');
  assert.throws(() => game.join('C'), { message: FULL_ERROR });
  assert.equal(game.join('x', a.token).id, a.id);
});

test('openCell rejects non-integer theme or value', () => {
  const { game } = setup();
  assert.equal(game.openCell('length', 100, 0), false);
  assert.equal(game.openCell(0, '100', 0), false);
  assert.equal(game.phase, 'board');
});
